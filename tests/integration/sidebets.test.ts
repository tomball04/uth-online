import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, aid, rigDeck, startServer, type TC } from './harness';

type S = Awaited<ReturnType<typeof startServer>>;

describe('Ultimate Pairs and Bad Beat at a multiplayer table (PostgreSQL)', () => {
  let s: S; let code: string; let p: TC[]; let ace2: TC;
  const BOARD = '9h 9s 2c 5d Kh';

  beforeAll(async () => {
    s = await startServer();
    p = [await s.player('Kim'), await s.player('Ace'), await s.player('Jo')];
    code = await s.createTable(p[0].token);
    for (const c of p) await c.join(code);
  });
  afterAll(() => s.stop());

  it('shows the selected pay tables before betting', async () => {
    const v = await p[0].waitState((x) => x.phase === 'betting');
    expect(v.config.pairsVariant).toBe('up-bonus4');
    expect(v.config.badBeatVariant).toBe('bb-01');
  });

  it('rejects ineligible and malformed side bets', async () => {
    expect((await p[0].bet($(10), 0, 0, $(5))).error).toMatch(/Trips\+/);
    expect((await p[0].bet($(10), $(5), -$(5), 0)).ok).toBe(false);
    expect((await p[0].emit('bet:place', { actionId: aid(), ante: $(10), trips: $(5), pairs: '500', badBeat: 0 })).ok).toBe(false);
    expect((await p[0].bet($(10), $(5), 250, 0)).error).toMatch(/whole dollars/);
    expect((await p[0].bet($(10), $(5), $(500), 0)).error).toMatch(/Ultimate Pairs/);
  });

  it('settles every player’s side bets independently against one dealer', async () => {
    s.decks.push(rigDeck(['Kd Kc', 'Ah Ad', 'Js 4h'], '9c 3d', BOARD));
    // Kim: everything. Ace: Ultimate Pairs only. Jo: Trips+ and Bad Beat.
    const dup = { actionId: aid(), ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) };
    expect((await p[0].emit('bet:place', dup)).ok).toBe(true);
    expect((await p[0].emit('bet:place', dup)).ok).toBe(true);            // duplicate message: idempotent
    expect((await p[1].bet($(10), 0, $(5), 0)).ok).toBe(true);
    expect((await p[2].bet($(10), $(5), 0, $(5))).ok).toBe(true);
    const betting = await p[1].waitState((v) => v.seats[0]!.bet.badBeat === $(5) && v.seats[2]!.bet.badBeat === $(5));
    expect(betting.seats[0]!.bet).toMatchObject({ ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) });
    await Promise.all(p.map((c) => c.ready()));

    const pre = await p[1].waitState((v) => v.phase === 'preflop');
    expect(pre.seats[1]!.cards).toEqual(['Ah', 'Ad']);
    expect(pre.seats[0]!.cards).toEqual([null, null]);
    expect((await p[0].bet($(20), $(5), $(5), $(5))).ok).toBe(false);     // side bets locked after the deal
    expect(pre.seats[0]!.balance).toBe($(1000) - $(35));                  // ante+blind+trips+pairs+bad beat debited once

    await p[0].decide('preflop', 'play4');
    await p[1].decide('preflop', 'check'); await p[2].decide('preflop', 'check');
    // Ace drops and reconnects mid-hand; payouts must still happen exactly once.
    p[1].socket.disconnect();
    await p[2].decide('flop', 'check');
    const { TC: TCc } = await import('./harness');
    ace2 = new TCc(s.url, p[1].token, p[1].id, 'Ace2');
    s.clients.push(ace2);
    await ace2.connected();
    await ace2.join(code);
    await ace2.decide('flop', 'check');
    await ace2.decide('river', 'fold');
    await p[2].decide('river', 'play1');

    const done = await p[0].waitState((v) => v.phase === 'settled', 10000);
    const [kim, ace, jo] = done.seats.slice(0, 3).map((x) => x!.result!);
    const line = (r: typeof kim, w: string) => r.lines.find((l) => l.wager === w)!;

    // Kim: full house beats dealer trips. Base +80 (ante 10, play 40, blind FH 3:1 = 30). Trips FH 8:1, Pairs KK 4:1, Bad Beat 9:1.
    expect(kim.baseNet).toBe($(80));
    expect(line(kim, 'trips').net).toBe($(40));
    expect(line(kim, 'pairs')).toMatchObject({ net: $(20), multiplier: 4, credit: $(25) });
    expect(line(kim, 'badBeat')).toMatchObject({ net: $(45), multiplier: 9, combo: 'Dealer Three of a Kind' });
    expect(kim.net).toBe($(185));

    // Ace folded, but Ultimate Pairs (A♥ A♦, 100:1) still pays. After settlement everyone sees the folded hand.
    expect(ace.net).toBe(-$(20) + $(500));
    expect(line(ace, 'pairs').combo).toBe('A♥ A♦');            // Kim's view of a folded seat
    expect(done.seats[1]!.cards).toEqual(['Ah', 'Ad']);
    const aceOwn = (await ace2.waitState((v) => v.phase === 'settled' && !!v.seats[1]!.result)).seats[1]!.result!;
    expect(aceOwn.lines.find((l) => l.wager === 'pairs')).toMatchObject({ combo: 'A♥ A♦', multiplier: 100, net: $(500) });

    // Jo: one pair loses to trips; Bad Beat needs the losing hand to be trips+.
    expect(line(jo, 'badBeat').result).toBe('lose');
    expect(jo.net).toBe(-$(30) - $(10));

    // Ledger reconciles, and each player got exactly one payout row.
    const pool = (s.store as any).pool;
    for (let i = 0; i < 3; i++) {
      expect(await s.store.ledgerSum(p[i].id, code)).toBe(done.seats[i]!.balance);
      const n = await pool.query(`SELECT COUNT(*)::int n FROM ledger WHERE player_id=$1 AND hand_id=$2 AND kind='payout'`, [p[i].id, done.handId]);
      expect(n.rows[0].n).toBeLessThanOrEqual(1);
    }
    expect(done.seats[1]!.balance).toBe($(1000) + $(480));

    // Hand history records pay tables, stakes, combinations and multipliers.
    const row = (await pool.query(`SELECT pairs, bad_beat, pairs_combo, pairs_multiplier, pairs_net, bad_beat_combo, bad_beat_multiplier,
      bad_beat_net, pairs_variant, bad_beat_variant, base_net FROM hand_players WHERE hand_id=$1 AND player_id=$2`, [done.handId, p[0].id])).rows[0];
    expect(row).toMatchObject({ pairs: $(5), bad_beat: $(5), pairs_combo: 'Pair of 2s through Kings', pairs_multiplier: 4, pairs_net: $(20),
      bad_beat_combo: 'Dealer Three of a Kind', bad_beat_multiplier: 9, bad_beat_net: $(45), pairs_variant: 'up-bonus4', bad_beat_variant: 'bb-01', base_net: $(80) });
    const hand = (await pool.query('SELECT pairs_variant, bad_beat_variant FROM hands WHERE id=$1', [done.handId])).rows[0];
    expect(hand).toEqual({ pairs_variant: 'up-bonus4', bad_beat_variant: 'bb-01' });
  });

  it('announces side-bet hits after the round, including for folded hands', () => {
    const texts = p[2].chat.map((m) => m.text);
    expect(texts.some((t) => /Bad Beat! Dealer’s Three of a Kind beaten — 9:1 for Kim/.test(t))).toBe(true);
    expect(texts.some((t) => /Ace: Ultimate Pairs — A♥ A♦ — 100:1/.test(t))).toBe(true);
  });

  it('reports each side bet separately in statistics', async () => {
    const st = (await s.api('/api/stats/me', p[1].token)).body.stats;
    expect(st.side.pairs).toMatchObject({ bets: 1, wins: 1, wagered: $(5), returned: $(505), net: $(500), biggestPayout: $(500) });
    expect(st.side.pairs.combos).toEqual([{ combo: 'A♥ A♦', count: 1 }]);
    expect(st.side.badBeat.bets).toBe(0);
    expect(st.baseNet).toBe(-$(20));
    const kim = (await s.api('/api/stats/me', p[0].token)).body.stats;
    expect(kim.side.badBeat).toMatchObject({ bets: 1, wins: 1, net: $(45) });
    expect(kim.side.trips).toMatchObject({ bets: 1, wins: 1, net: $(40) });
    expect(kim.baseNet).toBe($(80));
  });

  it('host can switch pay tables only between hands, and the change is announced', async () => {
    await p[0].waitState((v) => v.phase === 'betting', 6000);
    expect((await p[0].emit('host:settings', { pairsVariant: 'nope' })).ok).toBe(false);
    expect((await p[0].emit('host:settings', { pairsVariant: 'up-bonus2', badBeatVariant: 'bb-02' })).ok).toBe(true);
    const v = await p[2].waitState((x) => x.config.pairsVariant === 'up-bonus2');
    expect(v.config.badBeatVariant).toBe('bb-02');
    await p[2].waitState(() => p[2].chat.some((m) => /Ultimate Pairs is now Ultimate Pairs Bonus 2/.test(m.text)), 3000);
    expect(p[2].chat.some((m) => /Bad Beat is now Bad Beat Bonus 02/.test(m.text))).toBe(true);
    // During a hand: refused
    await p[0].bet($(10)); await p[2].bet($(10)); await ace2.bet($(10));
    await Promise.all([p[0].ready(), p[2].ready(), ace2.ready()]);
    await p[0].waitState((x) => x.phase === 'preflop');
    expect((await p[0].emit('host:settings', { pairsVariant: 'up-bonus4' })).error).toMatch(/between hands/);
  });

  it('pays the 1,000:1 Bonus 2 combination when player and dealer both hold aces', async () => {
    const s2 = await startServer();
    try {
      const a = await s2.player('Pocket');
      const t = await s2.createTable(a.token, { pairsVariant: 'up-bonus2', maxPairs: $(5) });
      await a.join(t);
      s2.decks.push(rigDeck(['As Ac'], 'Ah Ad', '2c 7d 9h Js 4c'));
      await a.bet($(5), 0, $(5), 0); await a.ready();
      const pre = await a.waitState((x) => x.phase === 'preflop');
      expect(pre.dealer.cards).toEqual([null, null]);             // dealer's aces stay hidden
      await a.decide('preflop', 'check'); await a.decide('flop', 'check'); await a.decide('river', 'fold');
      const done = await a.waitState((x) => x.phase === 'settled');
      const pairs = done.seats[0]!.result!.lines.find((l) => l.wager === 'pairs')!;
      expect(pairs).toMatchObject({ multiplier: 1000, net: $(5000), credit: $(5005) });
      expect(done.seats[0]!.balance).toBe($(1000) - $(10) + $(5000));
      expect(await s2.store.ledgerSum(a.id, t)).toBe(done.seats[0]!.balance);
    } finally { await s2.stop(); }
  });
});
