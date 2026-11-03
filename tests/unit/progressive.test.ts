import { describe, expect, it } from 'vitest';
import { cardToInt } from '../../src/shared/cards';
import { PROGRESSIVE, progressiveHand, resolveProgressive } from '../../src/shared/progressive';
import { NO_BETS, settle, validateInitialBet } from '../../src/shared/rules';
import { evaluate } from '../../src/shared/evaluator';

const c = (s: string) => s.split(' ').map(cardToInt);
const LIMITS = { minAnte: 500, maxAnte: 10_000, maxTrips: 2_500, maxPairs: 2_500, maxBadBeat: 2_500 };

describe('Five Card Progressive', () => {
  it('scores hole cards + flop only, ignoring turn and river', () => {
    expect(progressiveHand(c('As Ks'), c('Qs Js Ts 2d 3c'))).toBe('Royal Flush');
    expect(progressiveHand(c('As Kd'), c('2s 7h 9c As Ah'))).toBe('High Card');   // turn/river aces don't count
    expect(progressiveHand(c('9h 9d'), c('9s 4c 4d'))).toBe('Full House');
  });

  it('pays the fixed table and nothing below trips', () => {
    const hands = ['Four of a Kind', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair'] as const;
    const r = resolveProgressive(hands.map((hand, seat) => ({ playerId: `p${seat}`, seat, hand })), 2_000_000);
    expect(hands.map((_, i) => r.awards.get(`p${i}`)!.amount)).toEqual([150_000, 25_000, 20_000, 15_000, 4_500, 0]);
    expect(r.meterAfter).toBe(2_000_000);
    expect(r.hits).toEqual([]);
  });

  it('royal takes the whole meter and resets it; straight flush takes 10% rounded down; envy goes to the others', () => {
    const r = resolveProgressive([
      { playerId: 'sf', seat: 0, hand: 'Straight Flush' },
      { playerId: 'royal', seat: 2, hand: 'Royal Flush' },
      { playerId: 'none', seat: 4, hand: 'One Pair' },
    ], 1_234_567);
    // Seat order: the straight flush is paid first, 10% of $12,345.67 = $1,234.56, rounded down to $1,234.
    expect(r.awards.get('sf')!.base).toBe(123_400);
    expect(r.awards.get('royal')!.base).toBe(1_111_100);             // $11,111.67 left, paid as $11,111
    expect(r.meterAfter).toBe(PROGRESSIVE.seed + 67);                // the 67¢ carries into the reset meter
    expect(r.awards.get('sf')!.envy).toBe(500_000);                  // from the royal
    expect(r.awards.get('royal')!.envy).toBe(150_000);               // from the straight flush
    expect(r.awards.get('none')!.amount).toBe(650_000);              // both envies, no hand award
    expect(r.hits.map((h) => h.hand)).toEqual(['Straight Flush', 'Royal Flush']);
  });

  it('never lets a straight flush drain the meter below the seed', () => {
    const r = resolveProgressive([{ playerId: 'a', seat: 0, hand: 'Straight Flush' }], PROGRESSIVE.seed + 5_000);
    expect(r.awards.get('a')!.base).toBe(100_500);
    expect(r.meterAfter).toBe(PROGRESSIVE.seed);
  });

  it('settles as a non-returned wager that survives a fold', () => {
    const award = resolveProgressive([{ playerId: 'x', seat: 0, hand: 'Flush' }], PROGRESSIVE.seed).awards.get('x')!;
    const hole = c('2h 7h'), board = c('9h Jh Kh 3c 4d'), dealer = c('Ac Ad');
    const st = settle({ ante: 1000, blind: 1000, play: 0, trips: 0, folded: true, progressive: 500, progressiveAward: award,
      playerScore: evaluate([...hole, ...board]), dealerScore: evaluate([...dealer, ...board]), playerHole: hole, dealerHole: dealer });
    expect(st.progressive).toMatchObject({ stake: 500, credit: 20_000, net: 19_500, result: 'win' });
    expect(st.net).toBe(-2000 + 19_500);
    const lose = settle({ ante: 1000, blind: 1000, play: 1000, trips: 0, folded: false, progressive: 500, progressiveAward: null,
      playerScore: evaluate([...hole, ...board]), dealerScore: evaluate([...dealer, ...board]), playerHole: hole, dealerHole: dealer });
    expect(lose.progressive).toMatchObject({ stake: 500, credit: 0, net: -500 });
  });

  it('accepts exactly $5 or nothing, and only where the table offers it', () => {
    const base = { ...NO_BETS, ante: 1000 };
    expect(validateInitialBet({ ...base, progressive: 500 }, 100_000, LIMITS)).toBeNull();
    expect(validateInitialBet({ ...base, progressive: 1000 }, 100_000, LIMITS)).toMatch(/\$5/);
    expect(validateInitialBet({ ...base, progressive: 500 }, 100_000, { ...LIMITS, progressiveEnabled: false })).toMatch(/not offered|progressive/i);
    expect(validateInitialBet({ ...base, progressive: 500 }, 3_499, LIMITS)).not.toBeNull();   // 3× ante + $5 = $35
    expect(validateInitialBet({ ...base, progressive: 500 }, 3_500, LIMITS)).toBeNull();
  });
});
