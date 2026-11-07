// Three Card Poker at a multiplayer table (scope addendum §23), against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, aid, rigDeck, rigTcp, startServer, type TC } from './harness';

type S = Awaited<ReturnType<typeof startServer>>;
const tcpBet = (c: TC, ante: number, pairPlus = 0, sixCard = 0) => c.emit('bet:place', { actionId: aid(), ante, trips: 0, pairPlus, sixCard });

describe('Three Card Poker: switching, dealing, settlement, isolation from Hold’em', () => {
  let s: S; let code: string; let host: TC; let a: TC; let b: TC;
  beforeAll(async () => {
    s = await startServer();
    host = await s.player('Tom'); a = await s.player('Ann'); b = await s.player('Bo');
    code = await s.createTable(host.token, { decisionSeconds: 5 });
    for (const c of [host, a, b]) await c.join(code);
    await host.waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 3);
  });
  afterAll(() => s.stop());

  it('only the host can switch; a switch during a hand is queued until it settles; seats and chips are kept', async () => {
    expect((await a.emit('host:game', { game: 'tcp' })).ok).toBe(false);
    expect((await host.emit('host:game', { game: 'poker' })).ok).toBe(false);
    // Play one Hold'em hand with a progressive bet so there is jackpot history to preserve.
    s.decks.push(rigDeck(['As Ad', '2c 7d', '3h 8s'], 'Kh Qd', 'Ac 9s 5h 3d Jc'));
    await host.bet($(10), 0, 0, 0, $(5)); await a.bet($(10)); await b.bet($(10));
    await Promise.all([host.ready(), a.ready(), b.ready()]);
    await host.waitState((v) => v.phase === 'preflop');
    const r = await host.emit('host:game', { game: 'tcp' });
    expect(r).toMatchObject({ ok: true, queued: true });
    expect((await host.emit('host:game', { game: 'tcp' })).ok).toBe(false);          // no conflicting second switch
    await host.waitState((v) => v.pendingGame === 'tcp');
    expect(host.state.config.game).toBe('uth');                                         // not mid-hand
    for (const c of [host, a, b]) await c.decide('preflop', 'check');
    for (const c of [host, a, b]) await c.decide('flop', 'check');
    for (const c of [host, a, b]) await c.decide('river', 'fold');
    const settled = await host.waitState((v) => v.phase === 'settled');
    const balances = settled.seats.filter(Boolean).map((x) => x!.balance);
    const meter = await s.store.getJackpot();
    const v = await a.waitState((x) => x.config.game === 'tcp' && x.phase === 'betting', 8000, 'switched');
    expect(v.pendingGame).toBeNull();
    expect(v.seats.filter(Boolean).map((x) => x!.name)).toEqual(['Tom', 'Ann', 'Bo']);
    expect(v.seats.filter(Boolean).map((x) => x!.balance)).toEqual(balances);           // no new bankroll
    expect(v.you.lastBet).toBeNull();                                                  // Hold'em presets cleared
    await a.waitState(() => a.chat.some((m) => m.text === 'Tom changed the table to Three Card Poker.'), 2000);
    expect(await s.store.getJackpot()).toBe(meter);
  });

  it('rejects Hold’em side bets, deals three unique cards each, hides others until settlement', async () => {
    expect((await host.bet($(10), $(5))).error).toMatch(/Ultimate Texas Hold’em bets/);
    expect((await host.bet($(10), 0, 0, 0, $(5))).error).toMatch(/Ultimate Texas Hold’em bets/);
    const meter0 = await s.store.getJackpot();
    // Tom: straight (Ante Bonus) loses to dealer trips; Ann: Q-6-4 plays and loses; Bo folds a pair with Pair Plus + Six Card.
    s.decks.push(rigTcp(['4c 5d 6s', 'Qh 6c 4d', '9h 9c 2s'], '7h 7d 7c'));
    expect((await tcpBet(host, $(10))).ok).toBe(true);
    expect((await tcpBet(a, $(10))).ok).toBe(true);
    expect((await tcpBet(b, $(10), $(5), $(5))).ok).toBe(true);
    await Promise.all([host.ready(), a.ready(), b.ready()]);
    const v = await host.waitState((x) => x.phase === 'decide');
    expect(v.community).toEqual([]);
    expect(v.dealer.cards).toEqual([null, null, null]);
    expect(v.seats[0]!.cards).toEqual(['4c', '5d', '6s']);
    expect(v.seats[1]!.cards).toEqual([null, null, null]);
    expect(v.you.legal.sort()).toEqual(['fold', 'play1']);
    expect(v.seats[0]!.handName).toBe('Straight');
    expect((await host.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'preflop', decision: 'check' })).ok).toBe(false);   // no Hold'em streets
    expect((await host.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'decide', decision: 'play4' })).ok).toBe(false);
    await host.decide('decide', 'play1'); await a.decide('decide', 'play1'); await b.decide('decide', 'fold');
    const done = await host.waitState((x) => x.phase === 'settled');
    const line = (i: number, k: string) => done.seats[i]!.result!.lines.find((l) => l.wager === k);
    // Tom: dealer trips beat his straight (Ante + Play lose), but the Ante Bonus pays 1:1 anyway.
    expect(done.seats[0]!.result!.outcome).toBe('lose');
    expect(line(0, 'anteBonus')).toMatchObject({ result: 'win', net: $(10) });
    expect(done.seats[0]!.result!.net).toBe(-$(20) + $(10));
    expect(line(1, 'anteBonus')).toBeUndefined();
    expect(done.seats[1]!.result!.net).toBe(-$(20));
    // Bo folded: Ante lost, no Ante Bonus, Pair Plus pays 1:1 on the pair, Six Card pays on 9-9-9... with dealer 7s: full house 20:1.
    expect(line(2, 'pairPlus')).toMatchObject({ result: 'win', net: $(5) });
    expect(line(2, 'sixCard')).toMatchObject({ result: 'win', net: $(100), combo: 'Full House' });
    expect(line(2, 'anteBonus')).toBeUndefined();
    expect(done.seats[2]!.result!.net).toBe(-$(10) + $(5) + $(100));
    expect(done.dealer).toMatchObject({ cards: ['7h', '7d', '7c'], handName: 'Three Sevens', qualifies: true });
    expect(done.seats[1]!.cards).toEqual(['Qh', '6c', '4d']);                         // face up after the round
    for (const c of [host, a, b]) expect(await s.store.ledgerSum(c.id, code)).toBe(done.seats.find((x) => x?.playerId === c.id)!.balance);
    expect(await s.store.getJackpot()).toBe(meter0);                                    // the Hold'em jackpot is untouched
    const pool = (s.store as any).pool;
    const row = (await pool.query(`SELECT game, rules_version FROM hands WHERE id=$1`, [done.handId])).rows[0];
    expect(row).toEqual({ game: 'tcp', rules_version: 'tcp-2026.11' });
  });

  it('dealer Jack high does not qualify: Ante pays, Play pushes; the trainer grades Q-6-4', async () => {
    s.decks.push(rigTcp(['2c 5d 9s', 'Qh 6c 4d', 'Kh 8c 3s'], 'Jh Td 8d'));
    await host.waitState((x) => x.phase === 'betting', 8000);
    for (const c of [host, a, b]) expect((await tcpBet(c, $(10))).ok).toBe(true);
    await Promise.all([host.ready(), a.ready(), b.ready()]);
    await host.waitState((x) => x.phase === 'decide');
    await host.decide('decide', 'play1');                                                // 9-5-2: should fold
    await a.decide('decide', 'fold');                                                    // Q-6-4: should play
    await b.decide('decide', 'play1');
    const done = await host.waitState((x) => x.phase === 'settled');
    expect(done.dealer.qualifies).toBe(false);
    for (const i of [0, 2]) {
      const r = done.seats[i]!.result!;
      expect(r.lines.find((l) => l.wager === 'ante')).toMatchObject({ result: 'win', net: $(10) });
      expect(r.lines.find((l) => l.wager === 'play')).toMatchObject({ result: 'push', net: 0 });
    }
    const forHand = (c: TC) => c.analysis.find((x) => x.handId === done.handId);
    await a.waitState(() => !!forHand(a) && !!forHand(host), 3000, 'analysis');
    const d = forHand(a)!.decisions[0];
    expect(d).toMatchObject({ phase: 'decide', action: 'fold', recommended: 'play1', correct: false, evExact: true });
    expect(d.evCost).toBeGreaterThan(0);
    const hd = forHand(host)!.decisions[0];
    expect(hd).toMatchObject({ action: 'play1', recommended: 'fold', correct: false });
  });

  it('times out to Fold; a reconnecting player keeps their wager and cards', async () => {
    s.decks.push(rigTcp(['Ac Ad As', '2h 3h 5c', 'Kd Qs 9c'], 'Jc 4h 2d'));
    await host.waitState((x) => x.phase === 'betting', 8000);
    for (const c of [host, a, b]) expect((await tcpBet(c, $(10), c === a ? $(5) : 0)).ok).toBe(true);
    await Promise.all([host.ready(), a.ready(), b.ready()]);
    await host.waitState((x) => x.phase === 'decide');
    a.socket.disconnect();
    await host.waitState((x) => !x.seats[1]!.connected);
    a.socket.connect();
    await a.join(code);
    const back = await a.waitState((x) => x.phase === 'decide' && x.seats[1]!.cards[0] !== null);
    expect(back.seats[1]!.cards).toEqual(['2h', '3h', '5c']);
    expect(back.seats[1]!.bet).toMatchObject({ ante: $(10), pairPlus: $(5) });
    await host.decide('decide', 'play1');                                                 // Ann and Bo never act
    const done = await host.waitState((x) => x.phase === 'settled', 12000, 'timeout');
    expect(done.seats[1]!.result!.outcome).toBe('fold');
    expect(done.seats[2]!.result!.outcome).toBe('fold');
    expect(done.seats[1]!.result!.lines.find((l) => l.wager === 'pairPlus')).toMatchObject({ result: 'lose' });   // 2-3-5 high card
    expect(done.seats[0]!.result!.lines.find((l) => l.wager === 'anteBonus')).toMatchObject({ net: $(40) });   // trips 4:1
  });

  it('switching back to Hold’em: UTH bets work again, TCP bets are refused, jackpot intact, stats split by game', async () => {
    const meter = await s.store.getJackpot();
    await host.waitState((x) => x.phase === 'betting', 8000);
    await tcpBet(a, $(10), $(5));                                                        // uncommitted bet is released by the switch
    expect(await host.emit('host:game', { game: 'uth' })).toMatchObject({ ok: true, queued: false });
    const v = await a.waitState((x) => x.config.game === 'uth');
    expect(v.seats[1]!.bet.ante).toBe(0);
    expect((await tcpBet(a, $(10), $(5))).error).toMatch(/Three Card Poker bets/);
    expect((await a.bet($(10), $(5))).ok).toBe(true);
    expect(await s.store.getJackpot()).toBe(meter);
    const tcp = (await s.api('/api/stats/me?game=tcp', host.token)).body.stats;
    const uth = (await s.api('/api/stats/me?game=uth', host.token)).body.stats;
    const all = (await s.api('/api/stats/me', host.token)).body.stats;
    expect([uth.hands, tcp.hands, all.hands]).toEqual([1, 3, 4]);
    expect(uth.net + tcp.net).toBe(all.net);
    expect(tcp.byPhase.every((p: any) => p.phase === 'decide')).toBe(true);
    expect(uth.side.progressive.bets).toBe(1);
    expect(tcp.side.progressive.bets).toBe(0);
    expect(all.series).toHaveLength(4);                                                   // one combined balance history
    const ledger = await s.store.ledgerSum(host.id, code);
    expect(ledger).toBe((await s.store.getStack(host.id, code))!.balance);
    // History of both games is kept and replays read their own rules.
    const replays = await Promise.all((await s.store.recentHands(code, 10)).map((h) => s.store.handReplay(h.handId)));
    expect(replays.map((r) => r!.game).sort()).toEqual(['tcp', 'tcp', 'tcp', 'uth']);
    expect(replays.find((r) => r!.game === 'tcp')!.community).toEqual([]);
  });
});
