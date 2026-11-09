import pg from 'pg';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { createApp } from '../../src/server/app';
import { PgStore } from '../../src/server/pgStore';
import { MemoryStore } from '../../src/server/memoryStore';
import { secureShuffle } from '../../src/server/rng';
import { cardToInt } from '../../src/shared/cards';
import type { Timing } from '../../src/server/engine';
import type { ChatMessage, DecisionRecord, TableView } from '../../src/shared/protocol';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/uth_test';
export const FAST: Timing = { dealMs: 0, revealMs: 30, resultsMs: 400, graceMs: 60_000 };

export async function resetDb() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

export async function startServer(opts: { memory?: boolean; reset?: boolean; timing?: Timing } = {}) {
  if (!opts.memory && opts.reset !== false) await resetDb();
  const store = opts.memory ? new MemoryStore() : new PgStore(TEST_DB, join(__dirname, '..', '..', 'migrations'));
  const decks: number[][] = [];
  const shoes: number[][] = [];
  const server = await createApp({ store, shuffle: () => decks.shift() ?? secureShuffle(), timing: opts.timing ?? FAST, log: false, rateLimitScale: 1000 });
  server.manager.shoeShuffle = () => shoes.shift() ?? secureShoe();
  await new Promise<void>((r) => server.http.listen(0, r));
  const url = `http://localhost:${(server.http.address() as AddressInfo).port}`;
  const clients: TC[] = [];
  return {
    url, server, store, decks, shoes, clients,
    /** Queue a rigged blackjack shoe and make the table use it for its next round. */
    rigShoe(code: string, shoe: number[]) { shoes.push(shoe); server.manager.tables.get(code)!.resetShoe(); },
    async guest(name: string) {
      const r = await fetch(url + '/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      return (await r.json()) as { token: string; player: { id: string; name: string } };
    },
    async api(path: string, token: string, init: RequestInit = {}) {
      const r = await fetch(url + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
      return { status: r.status, body: await r.json() };
    },
    async player(name: string) {
      const g = await this.guest(name);
      const c = new TC(url, g.token, g.player.id, name);
      clients.push(c);
      await c.connected();
      return c;
    },
    async createTable(token: string, config: object = {}) {
      const r = await this.api('/api/tables', token, { method: 'POST', body: JSON.stringify(config) });
      if (!r.body.code) throw new Error(JSON.stringify(r.body));
      return r.body.code as string;
    },
    async stop() {
      for (const c of clients) c.socket.disconnect();
      await server.close();
      await store.close();
    },
  };
}

let nonce = 0;
export const aid = () => `act-${Date.now()}-${++nonce}-${Math.random().toString(36).slice(2, 8)}`;

export class TC {
  socket: Socket;
  states: TableView[] = [];
  raw: string[] = [];
  chat: ChatMessage[] = [];
  analysis: { handId: string; decisions: DecisionRecord[] }[] = [];
  events: { ev: string; args: unknown[] }[] = [];
  constructor(public url: string, public token: string, public id: string, public name: string) {
    this.socket = ioc(url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.onAny((ev, ...args) => {
      this.raw.push(ev + ' ' + JSON.stringify(args));
      this.events.push({ ev, args });
      if (ev === 'table:state') this.states.push(args[0] as TableView);
      if (ev === 'chat:message') this.chat.push(args[0] as ChatMessage);
      if (ev === 'hand:analysis') this.analysis.push(args[0] as never);
    });
  }
  connected() {
    return new Promise<void>((res, rej) => {
      if (this.socket.connected) return res();
      this.socket.once('connect', () => res());
      this.socket.once('connect_error', rej);
    });
  }
  get state() { return this.states[this.states.length - 1]; }
  emit<T = any>(ev: string, payload?: unknown): Promise<T> {
    return new Promise((res) => (payload === undefined ? this.socket.emit(ev, res) : this.socket.emit(ev, payload, res)));
  }
  async waitState(pred: (v: TableView) => boolean, ms = 8000, label = 'state'): Promise<TableView> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const s = this.state;
      if (s && pred(s)) return s;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`${this.name}: timed out waiting for ${label}; last phase=${this.state?.phase}`);
  }
  /** Blackjack: act on your turn (waits until it is your turn or insurance is offered). */
  async bj(action: string, extra: { amount?: number; hand?: number } = {}) {
    const v = await this.waitState((s) => !!s.bj && s.bj.actions.includes(action as never), 8000, `bj ${action}`);
    return this.emit('bj:act', { actionId: aid(), handId: v.handId, action, ...extra });
  }
  join(code: string, asSpectator = false) { return this.emit('table:join', { code, asSpectator }); }
  bet(ante: number, trips = 0, pairs = 0, badBeat = 0, progressive = 0) { return this.emit('bet:place', { actionId: aid(), ante, trips, pairs, badBeat, progressive }); }
  ready() { return this.emit('player:ready', { actionId: aid(), ready: true }); }
  async decide(phase: string, decision: string, actionId = aid()) {
    const v = await this.waitState((s) => s.phase === phase && s.you.legal.length > 0, 8000, `${phase} legal`);
    return this.emit('player:decide', { actionId, handId: v.handId, phase, decision });
  }
}

/**
 * Build a 52-card deck in the engine's deal order:
 * one card to each player in seat order, dealer, second card to each player, dealer,
 * burn, flop×3, burn, turn, burn, river.
 */
export function rigDeck(players: string[], dealer: string, community: string): number[] {
  const P = players.map((p) => p.split(' ').map(cardToInt));
  const D = dealer.split(' ').map(cardToInt);
  const B = community.split(' ').map(cardToInt);
  const used = new Set([...P.flat(), ...D, ...B]);
  if (used.size !== P.length * 2 + 7) throw new Error('rigDeck: duplicate cards');
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const deck = [
    ...P.map((p) => p[0]), D[0], ...P.map((p) => p[1]), D[1],
    filler.pop()!, B[0], B[1], B[2], filler.pop()!, B[3], filler.pop()!, B[4],
  ];
  return [...deck, ...filler];
}

export const $ = (d: number) => d * 100;

/** Three Card Poker deal order: one card each to every player then the dealer, three times. */
export function rigTcp(players: string[], dealer: string): number[] {
  const P = players.map((p) => p.split(' ').map(cardToInt));
  const D = dealer.split(' ').map(cardToInt);
  const used = new Set([...P.flat(), ...D]);
  if (used.size !== P.length * 3 + 3) throw new Error('rigTcp: duplicate cards');
  const filler = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const deck: number[] = [];
  for (let r = 0; r < 3; r++) { deck.push(...P.map((p) => p[r]), D[r]); }
  return [...deck, ...filler];
}

/** A secure-ish shuffled six-deck shoe for tests that don't rig one. */
export function secureShoe(): number[] {
  const d: number[] = [];
  for (let k = 0; k < 6; k++) for (let i = 0; i < 52; i++) d.push(i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
/**
 * A six-deck shoe in blackjack deal order: first card to each player in seat order, dealer upcard, second card to
 * each player, dealer hole card, then `draws` in the order they'll be taken (hits, doubles, split cards, dealer).
 */
export function rigShoe(players: string[], dealer: string, draws = ''): number[] {
  const P = players.map((p) => p.split(' ').map(cardToInt));
  const D = dealer.split(' ').map(cardToInt);
  const X = draws.trim() ? draws.trim().split(/\s+/).map(cardToInt) : [];
  const head: number[] = [];
  for (let r = 0; r < 2; r++) { head.push(...P.map((p) => p[r]), D[r]); }
  head.push(...X);
  const left = new Map<number, number>();
  for (let i = 0; i < 52; i++) left.set(i, 6);
  for (const c of head) { const n = left.get(c)! - 1; if (n < 0) throw new Error('rigShoe: more than six of a card'); left.set(c, n); }
  // Filler keeps the shoe a legal six-deck multiset; low cards last so tests that over-draw see small cards first.
  const filler: number[] = [];
  for (const [c, n] of left) for (let k = 0; k < n; k++) filler.push(c);
  return [...head, ...filler.sort((a, b) => a - b)];
}
