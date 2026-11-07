// Audit of the $5 Five Card Progressive under load: a six-player hand with several winners and
// Envy, and jackpot claims that race each other from separate tables against one PostgreSQL meter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, rigDeck, startServer, type TC } from './harness';
import { PROGRESSIVE, resolveProgressive } from '../../src/shared/progressive';
import type { PlayerSettlementRow } from '../../src/server/store';

type S = Awaited<ReturnType<typeof startServer>>;
const C = PROGRESSIVE.contribution, SEED = PROGRESSIVE.seed;

describe('Progressive audit: six players, several winners, Envy eligibility', () => {
  let s: S; let code: string; let p: TC[]; let outsider: TC;
  beforeAll(async () => {
    s = await startServer();
    p = [];
    for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo']) p.push(await s.player(n));
    outsider = await s.player('Gus');
    code = await s.createTable(p[0].token);
    for (const c of p) await c.join(code);
    const other = await s.createTable(outsider.token);
    await outsider.join(other);
    await p[0].waitState((v) => v.seats.filter(Boolean).length === 6);
  });
  afterAll(() => s.stop());

  it('pays every award once, Envy only to other $5 bettors at the same table, folded included', async () => {
    // Flop Q♠ J♠ 10♠.  Ann royal · Bo straight flush · Cy trips · Di straight · Ed two pair (folds) · Flo no progressive (folds)
    s.decks.push(rigDeck(['As Ks', '9s 8s', 'Qh Qc', 'Ah Kh', 'Jh Th', '2c 3d'], '4h 4d', 'Qs Js Ts 5c 7c'));
    const meter0 = await s.store.getJackpot();
    for (let i = 0; i < 6; i++) expect((await p[i].bet($(10), 0, 0, 0, i < 5 ? $(5) : 0)).ok).toBe(true);
    await Promise.all(p.map((c) => c.ready()));
    await p[0].waitState((v) => v.phase === 'preflop');
    expect(await s.store.getJackpot()).toBe(meter0 + 5 * C);
    // Everyone decides at once.
    await Promise.all([p[0].decide('preflop', 'play4'), p[1].decide('preflop', 'play4'), p[2].decide('preflop', 'play3'),
      p[3].decide('preflop', 'play4'), p[4].decide('preflop', 'check'), p[5].decide('preflop', 'check')]);
    await Promise.all([p[4].decide('flop', 'check'), p[5].decide('flop', 'check')]);
    await Promise.all([p[4].decide('river', 'fold'), p[5].decide('river', 'fold')]);
    const v = await p[0].waitState((x) => x.phase === 'settled', 10000);

    const m = meter0 + 5 * C;
    const royal = Math.floor(m / 100) * 100;
    const afterRoyal = SEED + (m - royal);
    const sf = Math.floor(afterRoyal / 1000) * 100;                 // 10%, whole dollars
    const want = [royal + 150_000, sf + 500_000, 4_500 + 650_000, 15_000 + 650_000, 650_000];
    for (let i = 0; i < 5; i++) {
      const line = v.seats[i]!.result!.lines.find((l) => l.wager === 'progressive')!;
      expect(line.credit, `seat ${i}`).toBe(want[i]);
      expect(line.stake).toBe(500);
    }
    expect(v.seats[5]!.result!.lines.find((l) => l.wager === 'progressive')).toBeUndefined();   // no bet, no Envy
    expect(v.seats[4]!.result!.net).toBe(-$(20) - 500 + 650_000);                                 // folded, still paid Envy
    expect(await s.store.getJackpot()).toBe(Math.max(SEED, afterRoyal - sf));
    for (let i = 0; i < 6; i++) expect(await s.store.ledgerSum(p[i].id, code)).toBe(v.seats[i]!.balance);
    // The other table's player bet nothing on this table and is untouched.
    expect(outsider.state.seats[0]!.balance).toBe($(1000));
    const pool = (s.store as any).pool;
    const hits = (await pool.query('SELECT player_id, hand_name, amount, meter_before FROM progressive_hits WHERE hand_id=$1 ORDER BY meter_before DESC', [v.handId])).rows;
    expect(hits.map((h: any) => [h.player_id, h.hand_name, h.amount, h.meter_before]))
      .toEqual([[p[0].id, 'Royal Flush', royal, m], [p[1].id, 'Straight Flush', sf, afterRoyal]]);
    // Envy is never taken from the meter: the meter only lost the two meter-paid awards.
    const credited = (await pool.query(`SELECT COALESCE(SUM(amount),0)::bigint s FROM ledger WHERE hand_id=$1 AND kind='payout'`, [v.handId])).rows[0].s;
    expect(Number(credited)).toBeGreaterThan(0);
  });
});

describe('Progressive audit: jackpot claims racing from separate tables', () => {
  let s: S;
  beforeAll(async () => { s = await startServer(); });
  afterAll(() => s.stop());

  it('two tables settling royals at the same moment: paid once each, in order, meter exact', async () => {
    const store = s.store;
    const ids: string[] = [];
    const codes: string[] = [];
    for (const n of ['Hal', 'Ivy', 'Jo', 'Kai']) {
      const g = await s.guest(n);
      const code = await s.createTable(g.token);
      await store.createStack(g.player.id, code, $(1000));
      ids.push(g.player.id); codes.push(code);
    }
    const hole = ['As', 'Ks'], community = ['Qs', 'Js', 'Ts', '2h', '3c'];
    const meter0 = await store.getJackpot();
    // Four hands on four tables, each with one $5 progressive bettor holding a royal.
    await Promise.all(ids.map((pid, i) => store.startHand({
      id: `race-${i}`, tableCode: codes[i], handNumber: 1, nightId: '', rulesVersion: '2026.11', deckCommitment: 'x', dealerCards: [], community, pairsVariant: 'up-bonus4', badBeatVariant: 'bb-01',
      players: [{ playerId: pid, seat: 0, name: 'p', hole, ante: 1000, blind: 1000, trips: 0, pairs: 0, badBeat: 0, progressive: 500 }],
    })));
    expect(await store.getJackpot()).toBe(meter0 + 4 * C);
    const settleOne = (i: number) => store.settleHand(`race-${i}`, codes[i], { hand: 'Pair', qualifies: true }, (meter) => {
      const r = resolveProgressive([{ playerId: ids[i], seat: 0, hand: 'Royal Flush' }], meter);
      const award = r.awards.get(ids[i])!.amount;
      const row: PlayerSettlementRow = { playerId: ids[i], credit: award, net: award - 2500, outcome: 'loss', handName: 'Royal Flush', handRank: 9,
        tripsNet: 0, play: 0, folded: true, settlement: {}, pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null,
        badBeatMultiplier: null, pairsVariant: null, badBeatVariant: null, baseNet: -2000, progressiveNet: award - 500, progressiveHand: 'Royal Flush' };
      return { rows: [row], jackpotAfter: r.meterAfter, hits: r.hits.map((h) => ({ ...h, hand: h.hand as string })) };
    });
    // Fire all four settlements at once, twice each (a retry must never pay again).
    const results = await Promise.all([0, 1, 2, 3, 0, 1, 2, 3].map(settleOne));
    expect(results.filter((r) => r.applied)).toHaveLength(4);
    const pool = (store as any).pool;
    const hits = (await pool.query(`SELECT amount, meter_before FROM progressive_hits WHERE hand_id LIKE 'race-%' ORDER BY created_at, meter_before DESC`)).rows;
    expect(hits).toHaveLength(4);
    // Serialized on the meter row: the first claim takes the whole meter, each later one takes the reseeded meter.
    const before = hits.map((h: any) => h.meter_before).sort((a: number, b: number) => b - a);
    expect(before[0]).toBe(meter0 + 4 * C);
    const paid = hits.reduce((t: number, h: any) => t + h.amount, 0);
    const final = await store.getJackpot();
    // Conservation: everything on the meter plus every reseed was either paid out or is still on the meter.
    expect(paid + final).toBe(meter0 + 4 * C + 4 * SEED);              // each royal reseeds once
    expect(final).toBeGreaterThanOrEqual(SEED);
    for (let i = 0; i < 4; i++) {
      const bal = (await store.getStack(ids[i], codes[i]))!.balance;
      expect(await store.ledgerSum(ids[i], codes[i])).toBe(bal);
    }
  });
});
