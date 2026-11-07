import { describe, expect, it } from 'vitest';
import { buildRecap, type NightHand, type NightHandPlayer } from '../../src/shared/recap';

const P = (id: string, net: number, x: Partial<NightHandPlayer> = {}): NightHandPlayer => ({
  playerId: id, name: id.toUpperCase(), seat: 0, hole: ['2c', '3d'], folded: false, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
  handName: 'High Card', handRank: 0, tripsNet: 0, pairsNet: 0, badBeatNet: 0, progressiveNet: 0, pairsCombo: null, badBeatCombo: null,
  progressiveHand: null, pairsMultiplier: null, badBeatMultiplier: null, ...x,
});
const H = (n: number, players: NightHandPlayer[], decisions: NightHand['decisions'] = []): NightHand =>
  ({ handId: `h${n}`, handNumber: n, startedAt: n * 1000, settledAt: n * 1000 + 500, community: ['As', 'Kd', '9h', '5c', '2s'], dealerHand: 'Pair', players, decisions });

describe('night recap', () => {
  const hands = [
    H(1, [P('a', 2000), P('b', -1500, { folded: true })], [{ playerId: 'a', phase: 'preflop', correct: true }]),
    H(2, [P('a', 4000, { handName: 'Full House', handRank: 6, hole: ['Ks', 'Kc'], tripsNet: 4000 }), P('b', -3000)]),
    H(3, [P('a', -1000), P('b', 500, { handName: 'Flush', handRank: 5, pairsNet: 2500, pairsCombo: 'Suited', pairsMultiplier: 5 })]),
    H(4, [P('a', 0), P('b', 0, { folded: true, handName: 'Four of a Kind', handRank: 7 })]),
  ];
  const r = buildRecap({ nightId: 'n', tableName: 'T', startedAt: 0, endedAt: null }, hands, new Map([['b', 300_000]]));

  it('totals, ordering and records', () => {
    expect(r.hands).toBe(4);
    expect(r.players.map((p) => [p.name, p.net, `${p.wins}-${p.losses}-${p.pushes}`, p.folds])).toEqual([['A', 5000, '2-1-1', 0], ['B', -4000, '1-2-1', 2]]);
    expect(r.biggestWin).toMatchObject({ name: 'A', amount: 4000, handNumber: 2, hole: ['Ks', 'Kc'] });
    expect(r.biggestLoss).toMatchObject({ name: 'B', amount: -3000 });
    expect(r.lastHandAt).toBe(4500);
  });
  it('best hands skip folded hands; bonus hits are sorted by amount', () => {
    expect(r.bestHands.map((b) => b.handName)).toEqual(['Full House', 'Flush']);   // folded quads don't count
    expect(r.players[1].bestHand).toBe('Flush');
    expect(r.bonusHits.map((b) => [b.bet, b.amount, b.detail])).toEqual([['Trips+', 4000, 'Full House'], ['Ultimate Pairs', 2500, 'Suited 5:1']]);
  });
  it('awards: streak, folds, debt with a pawn item', () => {
    const fun = Object.fromEntries(r.fun.map((f) => [f.label, f.text]));
    expect(fun['Hottest streak']).toBe('A — 2 wins in a row');
    expect(fun['Most folds']).toMatch(/^B — 2 folds/);
    expect(fun['Deepest in debt']).toMatch(/^B — \$3,000 in markers\. Time to pawn/);
    expect(fun['Sharpest player']).toBeUndefined();                                 // needs 5+ decisions
  });
});
