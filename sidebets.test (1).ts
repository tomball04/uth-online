import { describe, expect, it } from 'vitest';
import { cardToInt } from '../../src/shared/cards';
import { evaluate, handName } from '../../src/shared/evaluator';
import { settleCards, settlePairs, validateInitialBet } from '../../src/shared/rules';
import { PAIRS_VARIANTS, BAD_BEAT_VARIANTS, evaluatePairs, previewPairs } from '../../src/shared/sidebets';

const C = (s: string) => s.split(' ').map(cardToInt);
const $ = (d: number) => d * 100;
const B4 = PAIRS_VARIANTS['up-bonus4'];
const B2 = PAIRS_VARIANTS['up-bonus2'];
const NOT_ACES = C('7c 8d');
const up = (hole: string, v = B4, dealer = NOT_ACES) => evaluatePairs(v, C(hole), dealer);

describe('Ultimate Pairs — Bonus 4 (default)', () => {
  it('A♥ A♦ pays 100:1', () => expect(up('Ah Ad').payout).toBe(100));
  it('A♦ A♥ in either order pays 100:1', () => expect(up('Ad Ah').payout).toBe(100));
  it('other pocket aces pay 30:1', () => {
    for (const h of ['As Ac', 'Ah As', 'Ad Ac', 'Ah Ac']) expect(up(h).payout, h).toBe(30);
  });
  it('suited ace-face pays 20:1', () => {
    for (const h of ['As Ks', 'Qh Ah', 'Ad Jd']) expect(up(h).payout, h).toBe(20);
  });
  it('unsuited ace-face pays 10:1', () => {
    for (const h of ['As Kd', 'Qh Ac', 'Ad Js']) expect(up(h).payout, h).toBe(10);
  });
  it('pocket 2s through Kings pay 4:1', () => {
    for (const h of ['2c 2d', '7h 7s', 'Tc Td', 'Kh Kc']) expect(up(h).payout, h).toBe(4);
  });
  it('non-qualifying hands lose', () => {
    for (const h of ['Kc Qc', 'As 9s', 'Ah Tc', '7c 2d', 'Kd Jd']) expect(up(h).won, h).toBe(false);
  });
  it('only the highest payout applies (A♥A♦ = 100, not 100 + 30)', () => {
    const r = up('Ah Ad');
    expect(r.payout).toBe(100);
    expect(r.label).toBe('A♥ A♦');
  });
  it('ignores the dealer’s cards: no 1,000:1 row exists in this variant', () => {
    expect(up('As Ac', B4, C('Ah Ad')).payout).toBe(30);
  });
});

describe('Ultimate Pairs — Bonus 2 (alternate, complete table)', () => {
  it('player and dealer both holding aces pays 1,000:1', () => expect(up('As Ac', B2, C('Ah Ad')).payout).toBe(1000));
  it('player aces without dealer aces pay 30:1', () => expect(up('As Ac', B2).payout).toBe(30));
  it('A♥A♦ has no special row in Bonus 2', () => expect(up('Ah Ad', B2).payout).toBe(30));
  it('pays its own rows, never Bonus 4’s', () => {
    expect(up('As Ks', B2).payout).toBe(25);
    expect(up('As Qs', B2).payout).toBe(20);
    expect(up('As Kd', B2).payout).toBe(15);
    expect(up('Jh Jc', B2).payout).toBe(10);
    expect(up('As Jd', B2).payout).toBe(5);
    expect(up('Th Tc', B2).payout).toBe(3);
    expect(up('2h 2c', B2).payout).toBe(3);
  });
  it('the in-hand preview never confirms a dealer-dependent payout', () => {
    const p = previewPairs(B2, C('As Ac'));
    expect(p.payout).toBe(30);
    expect(p.pendingUpgrade).toEqual({ label: 'Player and dealer both hold aces', payout: 1000 });
    expect(previewPairs(B2, C('Ks Kc')).pendingUpgrade).toBeNull();
  });
});

describe('Ultimate Pairs settlement', () => {
  it('returns the stake separately from the profit', () => {
    const w = settlePairs($(5), 'up-bonus4', C('Ah Ad'), NOT_ACES);
    expect(w).toMatchObject({ stake: $(5), net: $(500), credit: $(505), multiplier: 100, result: 'win', variant: 'up-bonus4' });
  });
  it('still pays after the player folds the main game', () => {
    const s = settleCards(C('As Ac'), C('Kh Kd'), C('2c 7d 9h Js 4c'), { ante: $(10), play: 0, folded: true, pairs: $(5) });
    expect(s.outcome).toBe('fold');
    expect(s.pairs.net).toBe($(150));
    expect(s.net).toBe(-$(20) + $(150));
  });
  it('refuses to settle without the hole cards', () => {
    expect(() => settlePairs($(5), 'up-bonus4', undefined, undefined)).toThrow();
  });
});

describe('Bad Beat — Bonus 01 (default)', () => {
  const bb = (player: string, dealer: string, board: string, extra: { folded?: boolean; badBeatVariant?: 'bb-01' | 'bb-02'; stake?: number } = {}) =>
    settleCards(C(player), C(dealer), C(board), { ante: $(10), play: extra.folded ? 0 : $(10), trips: $(5), badBeat: extra.stake ?? $(5), folded: extra.folded, badBeatVariant: extra.badBeatVariant });

  it('player loses with Three of a Kind → 9:1', () => {
    const s = bb('9c 3d', 'Kd Kc', '9h 9s 2c 5d Kh');
    expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Three of a Kind', 'Full House', 'lose']);
    expect(s.badBeat).toMatchObject({ result: 'win', multiplier: 9, net: $(45), combo: 'Player Three of a Kind' });
  });
  it('player loses with a Straight → 20:1', () => {
    const s = bb('8s 4d', 'Ah 3c', '5h 6h 7c Kh 2h');
    expect([s.playerHand, s.dealerHand]).toEqual(['Straight', 'Flush']);
    expect(s.badBeat.multiplier).toBe(20);
  });
  it('player loses with a Full House → 40:1', () => {
    const s = bb('9c 3d', 'Kh 4s', '9h 9s Kc Kd 2c');
    expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Full House', 'Full House', 'lose']);
    expect(s.badBeat.multiplier).toBe(40);
  });
  it('dealer loses with Three of a Kind → 9:1', () => {
    const s = bb('Kd Kc', '9c 3d', '9h 9s 2c 5d Kh');
    expect(s.outcome).toBe('win');
    expect(s.badBeat).toMatchObject({ result: 'win', multiplier: 9, combo: 'Dealer Three of a Kind' });
  });
  it('dealer loses with Four of a Kind → 500:1', () => {
    const s = bb('Kh Ks', '9c 9d', '9h 9s Kc Kd 2c');
    expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Four of a Kind', 'Four of a Kind', 'win']);
    expect(s.badBeat.multiplier).toBe(500);
  });
  it('a tie between qualifying hands pays nothing', () => {
    const s = bb('2c 3d', '4c 5d', '9h 9s 9c Kd Kh');
    expect([s.playerHand, s.outcome]).toEqual(['Full House', 'push']);
    expect(s.badBeat.result).toBe('lose');
    expect(s.badBeat.note).toBe('Tied hands');
  });
  it('a losing hand below Three of a Kind pays nothing', () => {
    const s = bb('Kd 3c', '9c 4d', '9h 9s 2c 5d Kh');
    expect([s.playerHand, s.dealerHand]).toEqual(['Two Pair', 'Three of a Kind']);
    expect(s.badBeat.result).toBe('lose');
  });
  it('stays live after a fold and compares the real seven-card hands', () => {
    const folded = bb('9c 3d', 'Kd Kc', '9h 9s 2c 5d Kh', { folded: true }); // folded trips, dealer full house
    expect(folded.outcome).toBe('fold');
    expect(folded.badBeat.multiplier).toBe(9);
    const foldedBetter = bb('Kd Kc', '9c 3d', '9h 9s 2c 5d Kh', { folded: true }); // folded full house beats dealer trips
    expect(foldedBetter.badBeat).toMatchObject({ result: 'win', combo: 'Dealer Three of a Kind' });
    const foldedWeak = bb('3c 4d', 'Kd Kc', '9h 9s 2c 5d Kh', { folded: true });
    expect(foldedWeak.badBeat.result).toBe('lose'); // a fold is not a bad beat by itself
  });
  it('dealer non-qualification does not decide the bet', () => {
    const s = bb('9c 9d', '3h 5s', '2c 7d 9h Js 4c');
    expect(s.dealerQualifies).toBe(false);
    expect(s.ante.result).toBe('push');
    expect(s.badBeat.result).toBe('lose'); // loser is a high-card hand
    expect(s.trips.net).toBe($(15));
  });
  it('enforces the Trips+ companion wager', () => {
    const limits = { minAnte: $(5), maxAnte: $(100), maxTrips: $(25), maxPairs: $(25), maxBadBeat: $(25), badBeatVariant: 'bb-01' as const };
    expect(validateInitialBet({ ante: $(10), trips: 0, pairs: 0, badBeat: $(5) }, $(1000), limits)).toMatch(/Trips\+/);
    expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: 0, badBeat: $(5) }, $(1000), limits)).toBeNull();
    expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) }, $(44), limits)).toMatch(/\$45/);
    expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: 0, badBeat: $(30) }, $(1000), limits)).toMatch(/Bad Beat/);
  });
  it('settles a straight-flush bad beat exactly: $25 × 10,000 = $250,000', () => {
    const s = bb('4h 2c', '9h 2d', '5h 6h 7h 8h Kc', { stake: $(25) });
    expect([s.playerHand, s.dealerHand]).toEqual(['Straight Flush', 'Straight Flush']);
    expect(s.badBeat).toMatchObject({ net: $(250_000), credit: $(250_025), multiplier: 10000 });
    expect(Number.isSafeInteger(s.net)).toBe(true);
    expect(bb('4h 2c', '9h 2d', '5h 6h 7h 8h Kc', { stake: $(25), badBeatVariant: 'bb-02' }).badBeat.net).toBe($(187_500));
  });
});

describe('main game loses while side bets win', () => {
  it('nets each wager independently and keeps base and side results separate', () => {
    const board = C('9h 2s Kc Kd 2c');
    expect(handName(evaluate([...C('9c 9d'), ...board]))).toBe('Full House');
    const s = settleCards(C('9c 9d'), C('Kh 4s'), board, { ante: $(10), play: $(10), trips: $(5), pairs: $(5), badBeat: $(5) });
    expect(s.outcome).toBe('lose');
    expect(s.baseNet).toBe(-$(30));
    expect(s.trips.net).toBe($(40));     // full house 8:1
    expect(s.pairs.net).toBe($(20));     // pocket 9s 4:1
    expect(s.badBeat.net).toBe($(200));  // losing full house 40:1
    expect(s.sideNet).toBe($(260));
    expect(s.net).toBe($(230));
    expect(s.net).toBe(s.totalCredit - s.totalStake);
  });
});

describe('variant registry', () => {
  it('every variant documents its source, companions and fold handling', () => {
    for (const v of [...Object.values(PAIRS_VARIANTS), ...Object.values(BAD_BEAT_VARIANTS)]) {
      expect(v.source.url).toMatch(/^https:\/\//);
      expect(v.requires).toContain('ante');
      expect(v.foldHandling).toBe('stays-live');
      expect(v.rows.length).toBeGreaterThan(3);
    }
    expect(BAD_BEAT_VARIANTS['bb-01'].requires).toContain('trips');
  });
});
