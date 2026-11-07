import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc } from 'socket.io-client';
import { $, FAST, aid, rigDeck, startServer, type TC } from './harness';
import { intToCard } from '../../src/shared/cards';

type S = Awaited<ReturnType<typeof startServer>>;
const BOARD = 'Kh 7s 2d 9c 4h';

describe('six-player table on PostgreSQL', () => {
  let s: S; let code: string; let p: TC[];
  const holes = ['As Kd', 'Jc Jh', '7c 6c', '9d 8d', '3s 5d', 'Th Ts'];

  beforeAll(async () => {
    s = await startServer();
    p = [];
    for (const n of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) p.push(await s.player(n));
    code = await s.createTable(p[0].token, { name: 'Friday Night', isPublic: true });
    s.server.manager.tables.get(code)!.config.decisionSeconds = 2; // shorten the clock for the timeout seat
  });
  afterAll(() => s.stop());

  it('seats all six players at the same table and rejects a seventh', async () => {
    for (let i = 0; i < 6; i++) expect((await p[i].join(code)).seat).toBe(i);
    const seventh = await s.player('Gus');
    const r = await seventh.join(code);
    expect(r.ok).toBe(true);          // admitted as a spectator
    expect(r.seat).toBeNull();
    const v = await p[0].waitState((x) => x.seats.filter(Boolean).length === 6);
    expect(v.seats.map((x) => x!.name)).toEqual(['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']);
    expect((await s.api('/api/tables', p[0].token)).body.tables[0]).toMatchObject({ code, seated: 6, maxSeats: 6 });
  });

  it('plays a full hand with independent decisions and correct independent settlement', async () => {
    s.decks.push(rigDeck(holes, 'Qc Qd', BOARD));
    // Bets: everyone $10 ante; Ben and Eli add $5 Trips+
    for (let i = 0; i < 6; i++) expect((await p[i].bet($(10), i === 1 || i === 4 ? $(5) : 0)).ok).toBe(true);
    await Promise.all(p.map((c) => c.ready()));
    await p[0].waitState((v) => v.phase === 'preflop');

    // Every player sees only their own hole cards; same hidden board
    for (let i = 0; i < 6; i++) {
      const v = await p[i].waitState((x) => x.phase === 'preflop');
      expect(v.seats[i]!.cards).toEqual(holes[i].split(' '));
      for (let j = 0; j < 6; j++) if (j !== i) expect(v.seats[j]!.cards).toEqual([null, null]);
      expect(v.dealer.cards).toEqual([null, null]);
      expect(v.community).toEqual([null, null, null, null, null]);
    }

    // Pre-flop: Ava 4x, Ben 3x, the rest check; Fay never acts (timeout)
    expect((await p[0].decide('preflop', 'play4')).ok).toBe(true);
    expect((await p[1].decide('preflop', 'play3')).ok).toBe(true);
    for (const i of [2, 3, 4]) expect((await p[i].decide('preflop', 'check')).ok).toBe(true);

    // Others see Ava's visible Play wager, but not her cards
    const mid = await p[3].waitState((v) => v.seats[0]!.bet.play === $(40));
    expect(mid.seats[0]!.cards).toEqual([null, null]);
    expect(mid.seats[0]!.acted).toBe(true);

    // Flop (after Fay's timeout): everyone sees the same three cards
    const flops = await Promise.all(p.map((c) => c.waitState((v) => v.phase === 'flop', 6000)));
    for (const f of flops) expect(f.community).toEqual(['Kh', '7s', '2d', null, null]);
    expect(flops[0].you.legal).toEqual([]);            // already raised: no decision
    expect(flops[2].you.legal).toEqual(['play2', 'check']);
    expect((await p[2].decide('flop', 'play2')).ok).toBe(true);
    for (const i of [3, 4]) expect((await p[i].decide('flop', 'check')).ok).toBe(true);

    const rivers = await Promise.all(p.map((c) => c.waitState((v) => v.phase === 'river', 6000)));
    for (const r of rivers) expect(r.community).toEqual(BOARD.split(' '));
    expect((await p[3].decide('river', 'play1')).ok).toBe(true);
    expect((await p[4].decide('river', 'fold')).ok).toBe(true);

    const done = await p[0].waitState((v) => v.phase === 'settled', 8000);
    expect(done.dealer.cards).toEqual(['Qc', 'Qd']);
    expect(done.dealer.qualifies).toBe(true);
    const nets = done.seats.map((x) => x!.result!.net);
    //          Ava  Ben   Cal   Dee   Eli   Fay
    expect(nets).toEqual([$(50), -$(55), -$(40), -$(30), -$(25), -$(20)]);
    expect(done.seats.map((x) => x!.bet.play)).toEqual([$(40), $(30), $(20), $(10), 0, 0]);
    expect(done.seats[5]!.status).toBe('folded');      // river timeout -> fold

    // Showdown policy: after settlement every hand is face up, folded ones included
    expect(done.seats[0]!.cards).toEqual(['As', 'Kd']);
    expect(done.seats[4]!.cards).toEqual(['3s', '5d']);
    expect(done.seats[4]!.result!.handName).toBe('High Card');
    expect(done.seats[4]!.result!.outcome).toBe('fold');
    const eliOwn = p[4].state.seats[4]!;
    expect(eliOwn.cards).toEqual(['3s', '5d']);

    // Balances persisted and reconcile with the ledger
    for (let i = 0; i < 6; i++) {
      expect(done.seats[i]!.balance).toBe($(1000) + nets[i]);
      expect(await s.store.ledgerSum(p[i].id, code)).toBe(done.seats[i]!.balance);
    }
  });

  it('never sent hidden cards to anyone before showdown', () => {
    const dealerSecrets = ['"Qc"', '"Qd"'];
    for (let i = 0; i < 6; i++) {
      const before = p[i].raw.slice(0, p[i].raw.findIndex((r) => r.includes('"phase":"settled"')));
      const text = before.join('\n');
      for (const sec of dealerSecrets) expect(text.includes(sec)).toBe(false);
      for (let j = 0; j < 6; j++) if (j !== i) for (const c of holes[j].split(' ')) expect(text.includes(`"${c}"`)).toBe(false);
      // River cards never appear before the river
      const preRiver = p[i].raw.slice(0, p[i].raw.findIndex((r) => r.includes('"phase":"river"'))).join('\n');
      expect(preRiver.includes('"9c"')).toBe(false);
    }
  });

  it('records strategy decisions, timeouts and post-hand analysis', async () => {
    await p[1].waitState(() => p[1].analysis.length > 0, 8000, 'analysis');
    const ben = p[1].analysis[0].decisions;
    expect(ben[0]).toMatchObject({ phase: 'preflop', action: 'play3', recommended: 'play4', correct: false });
    expect(ben[0].evCost).toBeGreaterThan(0);
    await p[5].waitState(() => p[5].analysis.length > 0, 8000, 'analysis');
    expect(p[5].analysis[0].decisions.every((d) => d.timedOut)).toBe(true);
    // Fay's timed-out river fold with pocket tens was a mistake: the record carries the dealer's outs.
    const fayRiver = p[5].analysis[0].decisions.find((d) => d.phase === 'river')!;
    expect(fayRiver).toMatchObject({ action: 'fold', recommended: 'play1', correct: false });
    expect(fayRiver.outs).toMatchObject({ kind: 'dealer', combos: 990 });
    expect(fayRiver.outs!.count).toBeGreaterThan(0);
    const fayFlop = p[5].analysis[0].decisions.find((d) => d.phase === 'flop')!;
    expect(fayFlop.outs?.kind).toBe('improve');
    const stats = (await s.api('/api/stats/me', p[1].token)).body.stats;
    expect(stats.hands).toBe(1);
    expect(stats.trips.bets).toBe(1);
    expect(stats.handsWithFriends).toBe(1);
  });

  it('serves a replay that matches the saved hand, folded hands included', async () => {
    const handId = p[0].state.handId ?? p[0].states.findLast((v) => v.handId)!.handId!;
    const r = await s.api(`/api/hands/${handId}`, p[0].token);
    expect(r.status).toBe(200);
    expect(r.body.hand.community).toEqual(BOARD.split(' '));
    expect(r.body.hand.dealer).toEqual(['Qc', 'Qd']);
    const eli = r.body.hand.players.find((x: any) => x.name === 'Eli');
    expect(eli.hole).toEqual(['3s', '5d']);
    const outsider = await s.player('Outsider');
    expect((await s.api(`/api/hands/${handId}`, outsider.token)).status).toBe(404);
  });
});

describe('rules at the table', () => {
  let s: S;
  beforeAll(async () => { s = await startServer(); });
  afterAll(() => s.stop());

  it('dealer non-qualification only pushes the Ante; Trips+ still pays on a fold', async () => {
    const [a, b, c] = [await s.player('Al'), await s.player('Bo'), await s.player('Cy')];
    const code = await s.createTable(a.token);
    for (const x of [a, b, c]) await x.join(code);
    s.decks.push(rigDeck(['Ac Qd', 'Td 3s', '9h 9s'], 'Jc 5c', BOARD));
    await a.bet($(10)); await b.bet($(10)); await c.bet($(10), $(5));
    await Promise.all([a.ready(), b.ready(), c.ready()]);
    await a.decide('preflop', 'play4');
    await b.decide('preflop', 'check'); await c.decide('preflop', 'check');
    await b.decide('flop', 'check'); await c.decide('flop', 'check');
    await b.decide('river', 'play1'); await c.decide('river', 'fold');
    const v = await a.waitState((x) => x.phase === 'settled');
    expect(v.dealer.qualifies).toBe(false);
    const [ra, rb, rc] = v.seats.slice(0, 3).map((x) => x!.result!);
    expect(ra.net).toBe($(40));                                   // ante push, play +40, blind push
    expect(rb.net).toBe(-$(20));                                  // dealer's unqualified hand still beats B: play & blind lose
    expect(rb.lines.find((l) => l.wager === 'ante')!.result).toBe('push');
    expect(c.state.seats[2]!.result!.lines.find((l) => l.wager === 'trips')!.net).toBe($(15));
    expect(rc.net).toBe(-$(5));                                   // −10 ante −10 blind +15 trips
    expect(v.seats[2]!.balance).toBe($(995));
  });

  it('enforces affordability including the reserved 1x Play', async () => {
    const x = await s.player('Shorty');
    const code = await s.createTable(x.token, { startingBankroll: $(60), minAnte: $(5) });
    await x.join(code);
    expect((await x.bet($(20))).ok).toBe(true);                    // needs 60
    const r = await x.bet($(20), $(5));                           // needs 65
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/need \$65/);
    await x.bet($(20)); await x.ready();                           // $40 debited, $20 left = the 1x reserve
    const v = await x.waitState((s) => s.phase === 'preflop');
    expect(v.you.legal).toEqual(['check']);                        // cannot afford 3x/4x
    await x.decide('preflop', 'check');
    const f = await x.waitState((s) => s.phase === 'flop');
    expect(f.you.legal).toEqual(['check']);
    await x.decide('flop', 'check');
    const rv = await x.waitState((s) => s.phase === 'river');
    expect(rv.you.legal).toEqual(['play1', 'fold']);
  });
});

describe('abuse, duplicates and stale messages', () => {
  let s: S; let a: TC; let b: TC; let code: string;
  beforeAll(async () => {
    s = await startServer();
    a = await s.player('Alice'); b = await s.player('Bob');
    code = await s.createTable(a.token);
    await a.join(code); await b.join(code);
  });
  afterAll(() => s.stop());

  it('rejects malformed and impossible bets', async () => {
    for (const ante of [-500, 0, 150, 1e12, NaN, '500' as any, null as any, 99]) expect((await a.bet(ante)).ok).toBe(false);
    expect((await a.emit('bet:place', { actionId: 'short', ante: $(5), trips: 0 })).ok).toBe(false);
    expect((await a.emit('player:decide', { actionId: aid(), handId: 'x', phase: 'preflop', decision: 'play4' })).ok).toBe(false);
    expect((await a.ready()).ok).toBe(false);                   // no ante placed
  });

  it('applies a duplicated Play message once and rejects stale phase / wrong hand', async () => {
    await a.bet($(10)); await b.bet($(10));
    await Promise.all([a.ready(), b.ready()]);
    const v = await a.waitState((x) => x.phase === 'preflop');
    const id = aid();
    const msg = { actionId: id, handId: v.handId, phase: 'preflop', decision: 'play4' };
    const [r1, r2, r3] = await Promise.all([a.emit('player:decide', msg), a.emit('player:decide', msg), a.emit('player:decide', msg)]);
    expect([r1, r2, r3].every((r) => r.ok)).toBe(true);           // idempotent ack
    expect((await a.emit('player:decide', { ...msg, actionId: aid() })).ok).toBe(false); // already acted
    const ledger = (s.store as any).pool.query(`SELECT COUNT(*)::int n FROM ledger WHERE player_id=$1 AND kind='wager'`, [a.id]);
    expect((await ledger).rows[0].n).toBe(2);                     // initial + one play
    expect((await b.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'flop', decision: 'play2' })).error).toMatch(/Stale/);
    expect((await b.emit('player:decide', { actionId: aid(), handId: 'not-the-hand', phase: 'preflop', decision: 'check' })).ok).toBe(false);
    expect((await b.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'preflop', decision: 'play1' })).ok).toBe(false); // illegal in phase
    expect((await b.bet($(20))).ok).toBe(false);                    // betting locked mid-hand
    await b.decide('preflop', 'check'); await b.decide('flop', 'check'); await b.decide('river', 'fold');
    await a.waitState((x) => x.phase === 'settled');
    expect(await s.store.ledgerSum(a.id, code)).toBe(a.state.seats[0]!.balance);
  });

  it('prevents double settlement at the store level', async () => {
    const handId = a.state.handId!;
    const before = await s.store.ledgerSum(a.id, code);
    const r = await s.store.settleHand(handId, code, { hand: 'x', qualifies: true },
      (jp) => ({ jackpotAfter: jp + $(999), hits: [], rows: [{ playerId: a.id, credit: $(999), net: 0, outcome: 'win', handName: 'x', handRank: 0, tripsNet: 0, play: 0, folded: false, settlement: {},
        pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null, badBeatMultiplier: null, pairsVariant: null, badBeatVariant: null, baseNet: 0,
        progressiveNet: 0, progressiveHand: null }] }));
    expect(r.applied).toBe(false);
    expect(await s.store.ledgerSum(a.id, code)).toBe(before);
    expect(r.jackpot).toBe(await s.store.getJackpot());   // the meter is untouched by a rejected settlement
  });

  it('rejects unauthenticated sockets, non-host moderation and spoofed seats', async () => {
    const anon = ioc(s.url, { auth: { token: 'x'.repeat(43) }, transports: ['websocket'], forceNew: true, reconnection: false });
    const err = await new Promise<string>((r) => anon.on('connect_error', (e) => r(e.message)));
    expect(err).toBe('unauthorized');
    expect((await b.emit('host:kick', { playerId: a.id })).ok).toBe(false);
    expect((await b.emit('host:settings', { minAnte: $(1) })).ok).toBe(false);
    const spec = await s.player('Watcher');
    await spec.join(code, true);
    expect((await spec.emit('table:sit', { seat: 0 })).ok).toBe(false);   // occupied seat
    expect((await spec.emit('table:sit', { seat: 9 })).ok).toBe(false);   // nonexistent seat
    expect((await spec.bet($(10))).ok).toBe(false);                      // spectators cannot wager
  });

  it('sanitises and rate-limits chat; reactions are a fixed set', async () => {
    expect((await a.emit('chat:send', { text: '<script>alert(1)</script>hi\u0000' })).ok).toBe(true);
    const m = await a.waitState(() => a.chat.some((c) => c.kind === 'player'), 2000).then(() => a.chat.find((c) => c.kind === 'player')!);
    expect(m.text).toBe('scriptalert(1)/scripthi');
    const results = [];
    for (let i = 0; i < 8; i++) results.push((await a.emit('chat:send', { text: 'spam ' + i })).ok);
    expect(results.filter((x) => !x).length).toBeGreaterThan(0);
    expect((await a.emit('chat:react', { reaction: 'You suck' })).ok).toBe(false);
    expect((await b.emit('chat:react', { reaction: 'Nice hand!' })).ok).toBe(true);
  });

  it('host can change settings between hands and remove a player', async () => {
    await a.waitState((x) => x.phase === 'betting', 5000);
    expect((await a.emit('host:settings', { minAnte: $(10), maxAnte: $(50), decisionSeconds: 15 })).ok).toBe(true);
    expect(a.state.config.minAnte).toBe($(10));
    expect((await a.emit('host:settings', { minAnte: $(100), maxAnte: $(50) })).ok).toBe(false);
    const kicked = new Promise((r) => b.socket.once('kicked', r));
    expect((await a.emit('host:kick', { playerId: b.id })).ok).toBe(true);
    await kicked;
    const v = await a.waitState((x) => !x.seats[1]);
    expect(v.seats[1]).toBeNull();
    expect((await b.join(code)).ok).toBe(false);
  });
});

describe('connections, mid-hand joins and multiple tables', () => {
  let s: S;
  beforeAll(async () => { s = await startServer(); });
  afterAll(() => s.stop());

  it('a disconnected player keeps their seat; the table continues on the timer; reconnect restores everything', async () => {
    const a = await s.player('Host'); const b = await s.player('Flaky');
    const code = await s.createTable(a.token);
    s.server.manager.tables.get(code)!.config.decisionSeconds = 2;
    await a.join(code); await b.join(code);
    await a.bet($(10)); await b.bet($(10), $(5));
    await Promise.all([a.ready(), b.ready()]);
    const v0 = await b.waitState((x) => x.phase === 'preflop');
    const myCards = v0.seats[1]!.cards;
    await b.decide('preflop', 'play4');
    b.socket.disconnect();
    const seen = await a.waitState((x) => x.seats[1]!.connected === false);
    expect(seen.seats[1]!.status).toBe('in-hand');

    // Reconnect mid-hand with the same token (e.g. page refresh)
    const b2 = new (b.constructor as any)(s.url, b.token, b.id, 'Flaky2') as TC;
    s.clients.push(b2);
    await b2.connected();
    expect((await b2.join(code)).seat).toBe(1);
    const r = await b2.waitState((x) => !!x.handId);
    expect(r.seats[1]!.cards).toEqual(myCards);
    expect(r.seats[1]!.bet).toEqual({ ante: $(10), blind: $(10), trips: $(5), play: $(40), pairs: 0, badBeat: 0, progressive: 0, pairPlus: 0, sixCard: 0 });
    expect(r.seats[1]!.connected).toBe(true);
    expect(r.seats[1]!.balance).toBe($(1000) - $(65));

    // Host never acts — the server clock (not a browser) advances the table
    await a.waitState((x) => x.phase === 'settled', 12000);
    expect(await s.store.ledgerSum(b.id, code)).toBe(a.state.seats[1]!.balance);
  });

  it('players who join mid-hand wait for the next round', async () => {
    const a = await s.player('P1'); const late = await s.player('Late');
    const code = await s.createTable(a.token);
    await a.join(code);
    await a.bet($(5)); await a.ready();
    await a.waitState((x) => x.phase === 'preflop');
    expect((await late.join(code)).seat).toBe(1);
    const lv = await late.waitState((x) => x.phase === 'preflop' && !!x.seats[1]);
    expect(lv.seats[1]!.status).toBe('waiting-next');
    expect(lv.seats[1]!.cards).toEqual([]);
    expect(lv.you.legal).toEqual([]);
    expect((await late.bet($(5))).ok).toBe(false);
    await a.decide('preflop', 'check'); await a.decide('flop', 'check'); await a.decide('river', 'fold');
    await late.waitState((x) => x.phase === 'betting', 5000);
    expect((await late.bet($(5))).ok).toBe(true);
  });

  it('runs two tables concurrently with no shared cards or data', async () => {
    const [a1, a2, b1, b2] = [await s.player('A1'), await s.player('A2'), await s.player('B1'), await s.player('B2')];
    const t1 = await s.createTable(a1.token); const t2 = await s.createTable(b1.token);
    for (const [c, t] of [[a1, t1], [a2, t1], [b1, t2], [b2, t2]] as const) await c.join(t);
    for (const c of [a1, a2, b1, b2]) await c.bet($(5));
    await Promise.all([a1, a2, b1, b2].map((c) => c.ready()));
    await Promise.all([a1, a2, b1, b2].map((c) => c.waitState((x) => x.phase === 'preflop')));
    expect(a1.state.code).toBe(t1); expect(b1.state.code).toBe(t2);
    for (const ph of ['preflop', 'flop', 'river'])
      await Promise.all([a1, a2, b1, b2].map((c) => c.decide(ph, ph === 'river' ? 'play1' : 'check')));
    const [va, vb] = await Promise.all([a1.waitState((x) => x.phase === 'settled'), b1.waitState((x) => x.phase === 'settled')]);
    expect(va.handId).not.toBe(vb.handId);
    expect(a1.raw.some((r) => r.includes(t2))).toBe(false);
    expect(b2.raw.some((r) => r.includes(t1))).toBe(false);
    for (const v of [va, vb]) {
      const cards = [...v.community, ...v.dealer.cards, ...v.seats.flatMap((x) => x?.cards ?? [])].filter(Boolean);
      expect(new Set(cards).size).toBe(cards.length);
    }
  });

  it('spectators never receive hole cards before showdown', async () => {
    const a = await s.player('Seated'); const w = await s.player('Spectator');
    const code = await s.createTable(a.token);
    await a.join(code); await w.join(code, true);
    await a.bet($(5)); await a.ready();
    const v = await w.waitState((x) => x.phase === 'preflop');
    expect(v.you.role).toBe('spectator');
    expect(v.seats[0]!.cards).toEqual([null, null]);
    await a.decide('preflop', 'play4');
    await w.waitState((x) => x.phase === 'settled');
    const pre = w.raw.slice(0, w.raw.findIndex((r) => r.includes('"phase":"settled"'))).join('');
    const mine = a.states.find((x) => x.phase === 'preflop')!.seats[0]!.cards as string[];
    for (const c of mine) expect(pre.includes(`"${c}"`)).toBe(false);
  });
});

describe('persistence and crash recovery', () => {
  it('survives a server restart: balances persist and an interrupted hand is refunded exactly once', async () => {
    // Long reveal pause so the hand is genuinely mid-flight when the server "crashes".
    let s = await startServer({ timing: { ...FAST, revealMs: 60_000 } });
    const a = await s.player('Persist');
    const code = await s.createTable(a.token);
    await a.join(code);
    const meter0 = await s.store.getJackpot();
    await a.bet($(10), $(5), 0, 0, $(5)); await a.ready();
    await a.decide('preflop', 'play4');                               // $70 committed (incl. $5 progressive), hand in progress
    await a.waitState((x) => x.phase === 'flop');
    const token = a.token;
    // "Crash": tear the server down mid-hand without settling. Kill engine timers first.
    for (const t of s.server.manager.tables.values()) t.dispose();
    const midBalance = (await s.store.getStack(a.id, code))!.balance;
    const handId = a.state.handId!;
    const hand = await (s.store as any).pool.query('SELECT status FROM hands WHERE id=$1', [handId]);
    expect(hand.rows[0].status).toBe('active');
    expect(midBalance).toBe($(1000) - $(70));
    expect(await s.store.getJackpot()).toBe(meter0 + 350);            // contribution added at the deal
    await s.stop();

    s = await startServer({ reset: false });
    const status = (await (s.store as any).pool.query('SELECT status FROM hands WHERE id=$1', [handId])).rows[0].status;
    expect(status).toBe('voided');
    expect(await s.store.getJackpot()).toBe(meter0);                  // voided hand's contribution reversed
    const stack = (await s.store.getStack(a.id, code))!;
    expect(stack.balance).toBe($(1000));
    expect(await s.store.ledgerSum(a.id, code)).toBe(stack.balance);
    // Second recovery pass is a no-op
    expect((await s.store.voidActiveHands()).refunds).toBe(0);

    // Same identity + table code works after the restart
    const { TC } = await import('./harness');
    const back = new TC(s.url, token, a.id, 'Persist');
    s.clients.push(back);
    await back.connected();
    expect((await back.join(code)).seat).toBe(0);
    expect(back.state.seats[0]!.balance).toBe(stack.balance);
    await s.stop();
  });
});

describe('solo mode uses the same engine', () => {
  it('plays a practice hand without a clock on the in-memory store', async () => {
    const s = await startServer({ memory: true });
    const me = await s.player('Solo');
    const code = await s.createTable(me.token, { solo: true });
    await me.join(code);
    const v0 = await me.waitState((x) => x.config.solo);
    expect(v0.config.maxSeats).toBe(1);
    expect(v0.seats.length).toBe(1);
    await me.bet($(5)); await me.ready();
    const v = await me.waitState((x) => x.phase === 'preflop');
    expect(v.deadline).toBeNull();
    await me.decide('preflop', 'play4');
    const done = await me.waitState((x) => x.phase === 'settled');
    expect(done.seats[0]!.balance).toBe($(500) + done.seats[0]!.result!.net);
    void intToCard;
    await s.stop();
  });
});
