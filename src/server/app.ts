import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Server, type Socket } from 'socket.io';
import type {
  Ack, ChatMessage, ClientToServer, PublicTableListing, Reaction, ServerToClient,
} from '../shared/protocol.js';
import { REACTIONS } from '../shared/protocol.js';
import { buildConfig } from './config.js';
import { DEFAULT_TIMING, EngineError, TableEngine, cleanName, type Timing } from './engine.js';
import { newId, newToken, roomCode, secureShuffle, sha256 } from './rng.js';
import { buildRecap } from '../shared/recap.js';
import type { PlayerRow, Store } from './store.js';
import { Cosmetics, CosmeticError, type CosmeticsConfig } from './cosmetics.js';
import { COLLECTIONS, REACTION_SETS, randomAvatar, DEFAULT_AVATAR } from '../shared/cosmetics.js';

type IO = Server<ClientToServer, ServerToClient, object, SocketData>;
type Sock = Socket<ClientToServer, ServerToClient, object, SocketData>;
interface SocketData { player: PlayerRow; code: string | null }

export interface AppOptions {
  store: Store;
  shuffle?: () => number[];
  timing?: Timing;
  staticDir?: string;
  allowedOrigins?: string[];
  trustProxy?: boolean;
  log?: boolean;
  /** Multiplier for per-IP REST rate limits (tests use a large value). */
  rateLimitScale?: number;
  /** §24 price and reward overrides. */
  cosmetics?: CosmeticsConfig;
}

const AVATARS = ['♠', '♥', '♦', '♣', '★', '♛', '♞', '⚜'];

// ---------------------------------------------------------------- tiny rate limiter
class Bucket {
  private tokens: number; private last = Date.now();
  constructor(private cap: number, private perSec: number) { this.tokens = cap; }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
function makeIpLimit(scale: number) {
  const ipBuckets = new Map<string, Bucket>();
  setInterval(() => ipBuckets.clear(), 10 * 60_000).unref();
  return (cap0: number, perSec0: number) => {
   const cap = cap0 * scale, perSec = perSec0 * scale;
   return (req: Request, res: Response, next: NextFunction) => {
    const key = (req.ip ?? 'x') + req.path;
    let b = ipBuckets.get(key);
    if (!b) { b = new Bucket(cap, perSec); ipBuckets.set(key, b); }
    if (!b.take()) { res.status(429).json({ error: 'Too many requests — slow down.' }); return; }
    next();
   };
  };
}

// ---------------------------------------------------------------- table manager
export class TableManager {
  tables = new Map<string, TableEngine>();
  sockets = new Map<string, Set<Sock>>();
  chat = new Map<string, ChatMessage[]>();
  private loading = new Map<string, Promise<TableEngine | null>>();
  private pendingBroadcast = new Set<string>();
  /** Linked progressive meter, shared by every table on this server. Seeded from the store at startup. */
  jackpot = 0;
  /** Set by createApp: runs after every settled hand (cosmetic rewards only). */
  onSettled: (code: string, handId: string, nightId: string | null, pids: string[]) => void = () => {};

  constructor(private io: IO, private store: Store, private shuffle: () => number[], private timing: Timing) {}

  async create(host: PlayerRow, input: unknown) {
    const config = buildConfig(input, host.name);
    let code = '';
    for (let tries = 0; tries < 5; tries++) {
      code = roomCode(config.isPublic ? 6 : 8);
      if (!(await this.store.loadTable(code))) break;
    }
    await this.store.createTable(code, host.id, config);
    this.attach(new TableEngine(code, config, host.id, 0, this.store, this.hooks(code), this.shuffle, this.timing));
    return code;
  }

  private attach(e: TableEngine) { this.tables.set(e.code, e); return e; }

  async get(code: string): Promise<TableEngine | null> {
    const live = this.tables.get(code);
    if (live) return live.closed ? null : live;
    if (!this.loading.has(code)) {
      this.loading.set(code, (async () => {
        const row = await this.store.loadTable(code);
        if (!row || row.closed) return null;
        return this.tables.get(code) ?? this.attach(new TableEngine(code, row.config, row.hostId, row.handCounter, this.store, this.hooks(code), this.shuffle, this.timing));
      })().finally(() => this.loading.delete(code)));
    }
    return this.loading.get(code)!;
  }

  private hooks(code: string) {
    return {
      changed: () => this.broadcast(code),
      chat: (m: ChatMessage) => this.pushChat(code, m),
      analysis: (pid: string, p: { handId: string; decisions: import('../shared/protocol.js').DecisionRecord[] }) => {
        for (const s of this.sockets.get(code) ?? []) if (s.data.player.id === pid) s.emit('hand:analysis', p);
      },
      kicked: (pid: string, reason: string) => {
        for (const s of [...(this.sockets.get(code) ?? [])]) if (s.data.player.id === pid) { s.emit('kicked', { reason }); this.detach(s); }
      },
      jackpot: (amount: number) => {
        if (amount === this.jackpot) return;
        this.jackpot = amount;
        for (const c of this.tables.keys()) if (c !== code) this.broadcast(c);
      },
      jackpotAmount: () => this.jackpot,
      settled: (handId: string, nightId: string | null, pids: string[]) => this.onSettled(code, handId, nightId, pids),
      nightEnded: (nightId: string) => { for (const s of this.sockets.get(code) ?? []) s.emit('night:ended', { nightId }); },
      jackpotHit: (p: { tableName: string; playerName: string; hand: string; amount: number }) => {
        // Every table hears about a linked jackpot hit, like the sign over a casino pit.
        for (const [c, set] of this.sockets) for (const s of set) s.emit('jackpot:hit', { ...p, same: c === code });
      },
      closed: (reason: string) => {
        for (const s of [...(this.sockets.get(code) ?? [])]) { s.emit('table:closed', { reason }); s.data.code = null; }
        this.sockets.delete(code);
        this.tables.delete(code);
        this.chat.delete(code);
      },
    };
  }

  pushChat(code: string, m: ChatMessage) {
    const list = this.chat.get(code) ?? [];
    list.push(m);
    if (list.length > 60) list.shift();
    this.chat.set(code, list);
    for (const s of this.sockets.get(code) ?? []) s.emit('chat:message', m);
  }

  /** Coalesce bursts of changes into one personalised view per socket. */
  broadcast(code: string) {
    if (this.pendingBroadcast.has(code)) return;
    this.pendingBroadcast.add(code);
    setImmediate(() => {
      this.pendingBroadcast.delete(code);
      const e = this.tables.get(code);
      if (!e) return;
      for (const s of this.sockets.get(code) ?? []) s.emit('table:state', e.viewFor(s.data.player.id));
    });
  }

  register(s: Sock, code: string) {
    if (s.data.code && s.data.code !== code) this.detach(s);
    s.data.code = code;
    let set = this.sockets.get(code);
    if (!set) { set = new Set(); this.sockets.set(code, set); }
    set.add(s);
  }

  connectionsFor(code: string, pid: string) {
    let n = 0;
    for (const s of this.sockets.get(code) ?? []) if (s.data.player.id === pid) n++;
    return n;
  }

  detach(s: Sock) {
    const code = s.data.code;
    if (!code) return;
    this.sockets.get(code)?.delete(s);
    s.data.code = null;
    const e = this.tables.get(code);
    if (e && this.connectionsFor(code, s.data.player.id) === 0) {
      e.run(() => {
        if (e.seatOf(s.data.player.id)) e.setConnected(s.data.player.id, false);
        else e.removeSpectator(s.data.player.id);
      }).catch(() => {});
    }
  }

  listings(): PublicTableListing[] {
    return [...this.tables.values()].filter((t) => t.config.isPublic && !t.closed && !t.closing).map((t) => t.listing());
  }
}

// ---------------------------------------------------------------- app
export async function createApp(opts: AppOptions) {
  const { store } = opts;
  const timing = opts.timing ?? DEFAULT_TIMING;
  await store.init();
  const recovered = await store.voidActiveHands();
  if (opts.log !== false && recovered.hands)
    console.log(`[recovery] voided ${recovered.hands} interrupted hand(s), refunded ${recovered.refunds} stake(s)`);

  const ipLimit = makeIpLimit(opts.rateLimitScale ?? 1);
  const app = express();
  if (opts.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  const http: HttpServer = createServer(app);
  const io: IO = new Server(http, {
    cors: opts.allowedOrigins?.length ? { origin: opts.allowedOrigins } : undefined,
    maxHttpBufferSize: 16_000,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    connectionStateRecovery: undefined,
  });
  const manager = new TableManager(io, store, opts.shuffle ?? secureShuffle, timing);
  const cosmetics = new Cosmetics(store, opts.cosmetics);
  const toPlayer = (pid: string, fn: (s: Sock) => void) => { for (const set of manager.sockets.values()) for (const s of set) if (s.data.player.id === pid) fn(s); };
  const announceEarned = (pid: string, rewards: string[]) => {
    if (!rewards.length) return;
    store.getCosmetics(pid).then((st) => toPlayer(pid, (s) => s.emit('style:earned', { rewards, balance: st.balance }))).catch(() => {});
  };
  manager.onSettled = (_code, _handId, nightId, pids) => {
    for (const pid of pids) cosmetics.afterHand(pid, nightId).then((got) => announceEarned(pid, got)).catch((e) => opts.log !== false && console.error('[cosmetics]', e));
  };
  /** Push a player's new look to every table they're at. */
  const refreshLook = (pid: string, look: { appearance: unknown; equipped: unknown }) => {
    for (const [code, e] of manager.tables) {
      if (!e.seatOf(pid) && !e.spectators.has(pid)) continue;
      e.looks.set(pid, look as never);
      manager.broadcast(code);
    }
  };
  manager.jackpot = await store.getJackpot();

  const auth = async (token: unknown): Promise<PlayerRow | null> =>
    typeof token === 'string' && token.length >= 20 && token.length <= 100 ? store.playerByTokenHash(sha256(token)) : null;

  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? '';
    const p = await auth(h.startsWith('Bearer ') ? h.slice(7) : undefined);
    if (!p) { res.status(401).json({ error: 'Not signed in.' }); return; }
    res.locals.player = p;
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => res.status(400).json({ error: e instanceof Error ? e.message : 'Request failed' }));

  // ---- REST
  app.get('/api/health', (_req, res) => { res.json({ ok: true, tables: manager.tables.size }); });

  app.post('/api/guest', ipLimit(10, 0.2), wrap(async (req, res) => {
    const name = cleanName(String(req.body?.name ?? ''), 20);
    if (name.length < 2) throw new Error('Choose a display name of at least 2 characters.');
    const token = newToken();
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const p = await store.createPlayer(newId(), name, avatar, sha256(token));
    // Every new guest starts with a distinct free look and the welcome allowance of Style Credits.
    const r = randomAvatar();
    await store.saveAvatar(p.id, { ...DEFAULT_AVATAR, appearance: r.appearance, equipped: r.equipped, preset: 'casual', outfits: { casual: r.equipped } });
    await cosmetics.welcome(p.id);
    res.json({ player: p, token });
  }));

  app.get('/api/me', requireAuth, (_req, res) => { res.json({ player: res.locals.player }); });
  app.patch('/api/me', requireAuth, wrap(async (req, res) => {
    const name = req.body?.name !== undefined ? cleanName(String(req.body.name), 20) : undefined;
    if (name !== undefined && name.length < 2) throw new Error('Display name too short.');
    const avatar = AVATARS.includes(req.body?.avatar) ? req.body.avatar : undefined;
    await store.updatePlayer(res.locals.player.id, { name, avatar });
    res.json({ ok: true });
  }));

  // ---- §24 avatars, Style Credits and the Boutique (never chips)
  const cwrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req, res).catch((e) => res.status(e instanceof CosmeticError ? 400 : 500).json({ error: e instanceof CosmeticError ? e.message : 'Request failed' }));
  app.get('/api/catalog', (_req, res) => { res.json({ items: cosmetics.catalog(), rewards: cosmetics.rewards(), collections: COLLECTIONS }); });
  app.get('/api/me/cosmetics', requireAuth, cwrap(async (_req, res) => {
    const pid = res.locals.player.id as string;
    await cosmetics.welcome(pid);
    const st = await store.getCosmetics(pid);
    res.json({ ...st, avatar: st.avatar ?? DEFAULT_AVATAR, history: await store.styleHistory(pid, 50) });
  }));
  app.put('/api/me/avatar', ipLimit(20, 0.5), requireAuth, cwrap(async (req, res) => {
    const pid = res.locals.player.id as string;
    const data = await cosmetics.save(pid, req.body);
    refreshLook(pid, { appearance: data.appearance, equipped: data.equipped });
    res.json({ avatar: data, balance: (await store.getCosmetics(pid)).balance });
  }));
  app.post('/api/me/outfit', ipLimit(20, 0.5), requireAuth, cwrap(async (req, res) => {
    const pid = res.locals.player.id as string;
    const data = await cosmetics.wear(pid, req.body?.preset);
    refreshLook(pid, { appearance: data.appearance, equipped: data.equipped });
    res.json({ avatar: data });
  }));
  app.post('/api/me/purchase', ipLimit(20, 0.5), requireAuth, cwrap(async (req, res) => {
    const pid = res.locals.player.id as string;
    const r = await cosmetics.buy(pid, req.body?.itemId, req.body?.key);
    res.json(r);
  }));
  app.post('/api/me/event', ipLimit(10, 0.2), requireAuth, cwrap(async (req, res) => {
    const pid = res.locals.player.id as string;
    const ev = req.body?.event;
    const applied = await cosmetics.event(pid, ev);
    const st = await store.getCosmetics(pid);
    res.json({ applied, balance: st.balance });
  }));
  app.get('/api/players/:id/profile', ipLimit(60, 2), requireAuth, cwrap(async (req, res) => {
    const id = String(req.params.id);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new CosmeticError('Invalid player.');
    res.json({ profile: await cosmetics.profile(id) });
  }));
  app.get('/api/looks', ipLimit(60, 2), requireAuth, cwrap(async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').filter((x) => /^[A-Za-z0-9_-]{6,64}$/.test(x)).slice(0, 24);
    res.json({ looks: Object.fromEntries(await store.publicLooks(ids)) });
  }));

  app.get('/api/tables', (_req, res) => { res.json({ tables: manager.listings() }); });
  app.post('/api/tables', ipLimit(10, 0.1), requireAuth, wrap(async (req, res) => {
    const code = await manager.create(res.locals.player, req.body ?? {});
    res.json({ code });
  }));
  app.get('/api/tables/:code', ipLimit(30, 1), wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!/^[A-Z0-9]{6,8}$/.test(code)) throw new Error('Invalid table code.');
    const t = await manager.get(code);
    if (!t) { res.status(404).json({ error: 'Table not found or closed.' }); return; }
    res.json({ table: { ...t.listing(), solo: t.config.solo } });
  }));
  app.get('/api/stats/me', requireAuth, wrap(async (req, res) => {
    const g = req.query.game === 'uth' || req.query.game === 'tcp' ? req.query.game : undefined;
    res.json({ stats: await store.playerStats(res.locals.player.id, g) });
  }));
  // ---- table nights: running tab and recaps
  const nightAccess = async (code: string, me: string) => {
    const t = await store.loadTable(code);
    if (!t) return null;
    if (t.hostId === me || (await store.getStack(me, code)) || t.config.allowSpectators || t.config.isPublic) return t;
    return null;
  };
  app.get('/api/tables/:code/nights', requireAuth, wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!(await nightAccess(code, res.locals.player.id))) { res.status(404).json({ error: 'Table not found.' }); return; }
    res.json({ nights: await store.listNights(code, 30) });
  }));
  app.get('/api/tables/:code/pawns', requireAuth, wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!(await nightAccess(code, res.locals.player.id))) { res.status(404).json({ error: 'Table not found.' }); return; }
    res.json({ events: await store.debtEvents(code, 50) });
  }));
  app.get('/api/tables/:code/night', requireAuth, wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const t = await nightAccess(code, res.locals.player.id);
    if (!t) { res.status(404).json({ error: 'Table not found.' }); return; }
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    const night = id ? await store.getNight(id) : (await store.listNights(code, 1))[0] ?? null;
    if (!night || night.tableCode !== code) { res.json({ recap: null }); return; }
    const hands = await store.nightHands(night.id);
    const debts = new Map<string, number>();
    for (const pid of new Set(hands.flatMap((h) => h.players.map((p) => p.playerId)))) debts.set(pid, (await store.getStack(pid, code))?.debt ?? 0);
    res.json({ recap: buildRecap({ nightId: night.id, tableName: t.config.name, startedAt: night.startedAt, endedAt: night.endedAt }, hands, debts) });
  }));

  // Your chips at one table, straight from the ledger: start + reloads − wagers + payouts + refunds = stack.
  app.get('/api/tables/:code/chips', requireAuth, wrap(async (req, res) => {
    const code = String(req.params.code).toUpperCase(), me = res.locals.player.id as string;
    const stack = await store.getStack(me, code);
    if (!stack) { res.status(404).json({ error: 'You have no chips at this table.' }); return; }
    const k = await store.ledgerSummary(me, code);
    const total = Object.values(k).reduce((a, b) => a + b, 0);
    res.json({ chips: { start: k.buyin ?? 0, reloads: k.reload ?? 0, wagered: -(k.wager ?? 0), paid: k.payout ?? 0, refunded: k.refund ?? 0,
      ledgerTotal: total, balance: stack.balance, debt: stack.debt, balanced: total === stack.balance } });
  }));

  app.get('/api/hands/:id', requireAuth, wrap(async (req, res) => {
    const r = await store.handReplay(String(req.params.id));
    const me = res.locals.player.id as string;
    // Players in the hand, and anyone who has played at that table (cards are all face up once a hand settles).
    if (!r || (!r.players.some((p) => p.playerId === me) && !(await store.getStack(me, r.tableCode)))) { res.status(404).json({ error: 'Hand not found.' }); return; }
    if (r.status === 'active') { res.status(409).json({ error: 'Hand still in progress.' }); return; }
    // Settled hands are fully face up (folded hands included), matching the table's showdown policy.
    r.decisions = r.decisions.filter((d) => d.playerId === me);
    res.json({ hand: r, you: me });
  }));

  // ---- static client
  const staticDir = opts.staticDir;
  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  // ---- sockets
  io.use(async (socket, next) => {
    const p = await auth(socket.handshake.auth?.token).catch(() => null);
    if (!p) return next(new Error('unauthorized'));
    socket.data = { player: p, code: null };
    next();
  });

  io.on('connection', (socket: Sock) => {
    const bucket = new Bucket(25, 6);
    const chatBucket = new Bucket(5, 0.5);
    const reactBucket = new Bucket(2, 0.7);

    // Wrap a handler: rate limit, find table, run inside the table mutex, convert errors to acks.
    const on = <K extends keyof ClientToServer>(ev: K, handler: (e: TableEngine, ...args: any[]) => Promise<object | void>) => {
      socket.on(ev, (async (...args: any[]) => {
        const ack = typeof args[args.length - 1] === 'function' ? args.pop() as (r: Ack) => void : () => {};
        try {
          if (!bucket.take()) throw new EngineError('Too many actions — slow down.');
          const code = socket.data.code;
          const e = code ? manager.tables.get(code) : null;
          if (!e) throw new EngineError('Join a table first.');
          const r = await e.run(() => handler(e, ...args));
          ack({ ok: true, ...(r ?? {}) });
        } catch (err) {
          ack({ ok: false, error: err instanceof EngineError ? err.message : (err as Error)?.message?.includes('Insufficient') ? 'Insufficient balance.' : 'Action failed.' });
          if (!(err instanceof EngineError) && opts.log !== false) console.error(`[socket ${ev}]`, err);
        }
      }) as any);
    };
    const obj = (x: unknown) => (typeof x === 'object' && x ? x as Record<string, any> : {});

    socket.on('table:join', async (p, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!bucket.take(3)) throw new EngineError('Too many requests.');
        const code = String(obj(p).code ?? '').toUpperCase();
        if (!/^[A-Z0-9]{6,8}$/.test(code)) throw new EngineError('Invalid table code.');
        const e = await manager.get(code);
        if (!e) throw new EngineError('Table not found or closed.');
        const me = socket.data.player;
        const av = await cosmetics.look(me.id);
        const seat = await e.run(async () => {
          e.looks.set(me.id, { appearance: av.appearance, equipped: av.equipped });
          if (e.banned.has(me.id)) throw new EngineError('You were removed from this table.');
          const existing = e.seatOf(me.id);
          if (existing) { e.setConnected(me.id, true); return existing.seat; }
          const free = e.seats.slice(0, e.config.maxSeats).some((s) => !s);
          if (!obj(p).asSpectator && free) return e.sit(me);
          e.addSpectator(me);
          return null;
        });
        manager.register(socket, code);
        socket.emit('table:state', e.viewFor(me.id));
        socket.emit('chat:history', manager.chat.get(code) ?? []);
        reply({ ok: true, seat });
      } catch (err) {
        reply({ ok: false, error: err instanceof EngineError ? err.message : 'Could not join table.' });
      }
    });

    on('table:sit', async (e, p) => ({ seat: await e.sit(socket.data.player, obj(p).seat === undefined ? undefined : Number(obj(p).seat)) }));
    on('table:leave', async (e) => {
      await e.leave(socket.data.player.id);
      setImmediate(() => manager.detach(socket));
    });
    on('bet:place', async (e, p) => {
      const x = obj(p);
      // Raw values go to the engine; validateInitialBet rejects anything that isn't a whole, non-negative number.
      await e.placeBet(socket.data.player.id, x.actionId, { ante: x.ante, trips: x.trips ?? 0, pairs: x.pairs ?? 0, badBeat: x.badBeat ?? 0, progressive: x.progressive ?? 0, pairPlus: x.pairPlus ?? 0, sixCard: x.sixCard ?? 0 });
    });
    on('bet:clear', async (e, p) => e.clearBet(socket.data.player.id, obj(p).actionId));
    on('player:ready', async (e, p) => e.setReady(socket.data.player.id, obj(p).actionId, obj(p).ready !== false));
    on('player:decide', async (e, p) => {
      const x = obj(p);
      await e.decide(socket.data.player.id, x.actionId, String(x.handId), x.phase, x.decision);
    });
    on('player:reload', async (e) => e.reload(socket.data.player.id));
    on('player:payDebt', async (e, p) => e.payDebt(socket.data.player.id, Number(obj(p).amount)));
    on('player:prefs', async (e, p) => e.setPrefs(socket.data.player.id, obj(p)));
    on('host:kick', async (e, p) => e.kick(socket.data.player.id, String(obj(p).playerId)));
    on('host:close', async (e) => e.close(socket.data.player.id));
    on('host:theme', async (e, p) => e.setTheme(socket.data.player.id, obj(p)));
    on('host:away', async (e, p) => e.setAway(socket.data.player.id, String(obj(p).playerId), obj(p).away !== false));
    on('host:endNight', async (e) => e.endNight(socket.data.player.id));
    on('host:game', async (e, p) => e.setGame(socket.data.player.id, obj(p).game));
    on('host:standUp', async (e, p) => e.standUp(socket.data.player.id, String(obj(p).playerId)));
    on('host:settings', async (e, p) => e.updateSettings(socket.data.player.id, obj(p)));

    socket.on('chat:send', (p, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const code = socket.data.code;
      if (!code) return reply({ ok: false, error: 'Join a table first.' });
      if (!chatBucket.take()) return reply({ ok: false, error: 'You are sending messages too quickly.' });
      const text = cleanName(String(obj(p).text ?? ''), 240);
      if (!text) return reply({ ok: false, error: 'Empty message.' });
      const me = socket.data.player;
      manager.pushChat(code, { id: newId(), at: Date.now(), kind: 'player', playerId: me.id, name: me.name, text });
      cosmetics.tableTalk(me.id).then((ok) => ok && announceEarned(me.id, ['table-talk'])).catch(() => {});
      reply({ ok: true });
    });
    socket.on('chat:react', (p, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const code = socket.data.code;
      const reaction = String(obj(p).reaction ?? '') as Reaction;
      const e = code ? manager.tables.get(code) : undefined;
      const pack = REACTION_SETS[e?.looks.get(socket.data.player.id)?.equipped.emotes ?? 'emotes-classic'] ?? [];
      if (!code || !((REACTIONS as readonly string[]).includes(reaction) || pack.includes(reaction))) return reply({ ok: false, error: 'Invalid reaction.' });
      if (!reactBucket.take()) return reply({ ok: false, error: 'Slow down.' });
      const seat = e?.seatOf(socket.data.player.id)?.seat ?? null;
      for (const s of manager.sockets.get(code) ?? []) s.emit('chat:reaction', { playerId: socket.data.player.id, seat, reaction });
      reply({ ok: true });
    });

    socket.on('disconnect', () => manager.detach(socket));
  });

  return {
    app, http, io, manager, store, cosmetics,
    async close() {
      for (const t of manager.tables.values()) t.dispose();
      io.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
