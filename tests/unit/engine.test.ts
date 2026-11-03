import { describe, expect, it } from 'vitest';
import { cardToInt, intToCard } from '../../src/shared/cards';
import { evaluate, handName, bestFive, categoryOf } from '../../src/shared/evaluator';
import { settle, settleCards, validateInitialBet, requiredToStart, formatMoney } from '../../src/shared/rules';
import { preflopAdvice, flopAdvice, riverAdvice, flopEV, preflopEV, mistakeCost } from '../../src/shared/strategy';

const C = (s: string) => s.split(' ').filter(Boolean).map(cardToInt);
const $ = (d: number) => d * 100;

// ---------- Independent reference evaluator (naive, 5 cards) to cross-check the fast one ----------
function ref5(cards: number[]): number[] {
  const r = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const flush = cards.every((c) => (c & 3) === (cards[0] & 3));
  const uniq = [...new Set(r)];
  let straightHi = -1;
  if (uniq.length === 5 && r[0] - r[4] === 4) straightHi = r[0];
  if (uniq.length === 5 && r[0] === 12 && r[1] === 3) straightHi = 3;
  const cnt = new Map<number, number>();
  r.forEach((x) => cnt.set(x, (cnt.get(x) || 0) + 1));
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordered = groups.flatMap(([rank, n]) => Array(n).fill(rank));
  const shape = groups.map((g) => g[1]).join('');
  if (flush && straightHi >= 0) return [8, straightHi];
  if (shape === '41') return [7, ...ordered];
  if (shape === '32') return [6, ...ordered];
  if (flush) return [5, ...r];
  if (straightHi >= 0) return [4, straightHi];
  if (shape === '311') return [3, ...ordered];
  if (shape === '221') return [2, ...ordered];
  if (shape === '2111') return [1, ...ordered];
  return [0, ...r];
}
const cmpArr = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
function ref7(cards: number[]): number[] {
  let best: number[] | null = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    const s = ref5(five);
    if (!best || cmpArr(s, best) > 0) best = s;
  }
  return best!;
}
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
function deal(r: () => number, n: number) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d.slice(0, n);
}

describe('hand evaluator', () => {
  it('names categories correctly', () => {
    expect(handName(evaluate(C('As Ks Qs Js Ts 2d 3c')))).toBe('Royal Flush');
    expect(handName(evaluate(C('9h 8h 7h 6h 5h Ac Ad')))).toBe('Straight Flush');
    expect(handName(evaluate(C('Ah 2h 3h 4h 5h Kc Kd')))).toBe('Straight Flush');
    expect(handName(evaluate(C('7c 7d 7h 7s 2c 3d 9h')))).toBe('Four of a Kind');
    expect(handName(evaluate(C('7c 7d 7h 2s 2c 3d 9h')))).toBe('Full House');
    expect(handName(evaluate(C('7c 7d 7h 2s 2c 2d 9h')))).toBe('Full House');
    expect(handName(evaluate(C('Ac 9c 7c 4c 2c 3d 9h')))).toBe('Flush');
    expect(handName(evaluate(C('Ac 2d 3h 4s 5c Kd 9h')))).toBe('Straight');
    expect(handName(evaluate(C('7c 7d 7h Ks 2c 3d 9h')))).toBe('Three of a Kind');
    expect(handName(evaluate(C('7c 7d Kh Ks 2c 3d 9h')))).toBe('Two Pair');
    expect(handName(evaluate(C('7c 7d Ah Ks 2c 3d 9h')))).toBe('One Pair');
    expect(handName(evaluate(C('7c 8d Ah Ks 2c 3d Jh')))).toBe('High Card');
  });

  it('orders tricky comparisons correctly', () => {
    // wheel loses to 6-high straight
    expect(evaluate(C('Ac 2d 3h 4s 5c'))).toBeLessThan(evaluate(C('2d 3h 4s 5c 6d')));
    // two pair: best kicker comes from a third pair
    expect(evaluate(C('Kc Kd 9h 9s 8c 8d 2h'))).toBeGreaterThan(evaluate(C('Kc Kd 9h 9s 7c 6d 2h')));
    // full house with two sets uses the higher set as trips
    expect(evaluate(C('9c 9d 9h Ks Kc Kd 2h'))).toBeGreaterThan(evaluate(C('Qc Qd Qh Js Jc 2d 3h')));
    // identical board plays -> exact tie
    const board = C('Ac Kc Qd Jh Ts');
    expect(evaluate([...C('2c 3d'), ...board])).toBe(evaluate([...C('4c 5d'), ...board]));
  });

  it('matches an independent reference evaluator on 20,000 random 7-card hands', () => {
    const r = rng(42);
    for (let i = 0; i < 20000; i++) {
      const h1 = deal(r, 7), h2 = deal(r, 7);
      const fast = Math.sign(evaluate(h1) - evaluate(h2));
      const slow = Math.sign(cmpArr(ref7(h1), ref7(h2)));
      if (fast !== slow) throw new Error(`Mismatch ${h1.map(intToCard)} vs ${h2.map(intToCard)}`);
      expect(categoryOf(evaluate(h1))).toBe(ref7(h1)[0]);
    }
  });

  it('bestFive returns a 5-card subset scoring the same as the 7-card hand', () => {
    const seven = C('7c 7d Kh Ks 2c 3d 9h');
    const five = bestFive(seven);
    expect(five).toHaveLength(5);
    expect(evaluate(five)).toBe(evaluate(seven));
  });
});

describe('settlement (all amounts in cents)', () => {
  const board = C('2c 7d 9h Js 4c');

  it('dealer does not qualify, player wins: ante PUSHES, play WINS, blind pushes (no straight)', () => {
    const s = settleCards(C('Ac Kd'), C('3h 5s'), board, { ante: $(10), play: $(40) });
    expect(s.dealerQualifies).toBe(false);
    expect(s.ante.result).toBe('push');
    expect(s.play.result).toBe('win');
    expect(s.blind.result).toBe('push');
    expect(s.net).toBe($(40));
  });

  it('dealer does not qualify but BEATS player: ante pushes, play and blind LOSE (prototype paid Play here)', () => {
    const s = settleCards(C('3d 5c'), C('Ah Ks'), board, { ante: $(10), play: $(10) });
    expect(s.dealerQualifies).toBe(false);
    expect(s.outcome).toBe('lose');
    expect(s.ante.result).toBe('push');
    expect(s.play.result).toBe('lose');
    expect(s.blind.result).toBe('lose');
    expect(s.net).toBe(-$(20));
  });

  it('dealer qualifies and player wins with a flush: blind pays 3:2 in exact cents', () => {
    const s = settleCards(C('Ac 8c'), C('Jh Jd'), C('2c 7d 9c Js 4c'), { ante: $(1), play: $(4) });
    expect(s.playerHand).toBe('Flush');
    expect(s.blind.net).toBe(150);
    expect(s.ante.net).toBe(100);
    expect(s.play.net).toBe(400);
    expect(s.net).toBe(650);
  });

  it('tie pushes ante, blind and play', () => {
    const s = settleCards(C('2d 3s'), C('2h 3h'), C('Ac Kc Qd Jh Ts'), { ante: $(5), play: $(20) });
    expect(s.outcome).toBe('push');
    expect(s.net).toBe(0);
    expect(s.totalCredit).toBe(s.totalStake);
  });

  it('fold loses ante and blind, but Trips+ still resolves and is credited', () => {
    const s = settleCards(C('9c 9s'), C('Ah Ad'), board, { ante: $(10), play: 0, trips: $(5), folded: true });
    expect(s.outcome).toBe('fold');
    expect(s.playerHand).toBe('Three of a Kind');
    expect(s.trips.net).toBe($(15));
    expect(s.trips.credit).toBe($(20));
    expect(s.net).toBe(-$(20) + $(15));
  });

  it('Trips+ pays independently of losing the main hand', () => {
    const s = settleCards(C('9c 9s'), C('Jh Jd'), C('9h Js 2c 3d 8h'), { ante: $(5), play: $(10), trips: $(5) });
    expect(s.outcome).toBe('lose');
    expect(s.trips.net).toBe($(15));
  });

  it('royal flush pays 500:1 on blind and 50:1 on trips', () => {
    const s = settleCards(C('As Ks'), C('2h 2d'), C('Qs Js Ts 3c 4d'), { ante: $(1), play: $(4), trips: $(1) });
    expect(s.blind.net).toBe($(500));
    expect(s.trips.net).toBe($(50));
  });

  it('net always equals credit − stake', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const d = deal(r, 9);
      const s = settleCards(d.slice(0, 2), d.slice(2, 4), d.slice(4), { ante: $(5), play: $(5) * (1 + (i % 4)), trips: i % 2 ? $(5) : 0, folded: i % 7 === 0 });
      expect(s.net).toBe(s.totalCredit - s.totalStake);
      expect(Number.isInteger(s.net)).toBe(true);
    }
  });

  it('rejects fractional cents', () => {
    expect(() => settle({ ante: 1.5, blind: 1, play: 0, trips: 0, folded: true, playerScore: 0, dealerScore: 0 })).toThrow();
  });
});

describe('bet validation and affordability', () => {
  const limits = { minAnte: $(5), maxAnte: $(100), maxTrips: $(25) };
  it('reserves Ante + Blind + Trips + 1x Play', () => {
    expect(requiredToStart($(10), $(5))).toBe($(35));
    expect(validateInitialBet($(10), $(5), $(35), limits)).toBeNull();
    expect(validateInitialBet($(10), $(5), $(34), limits)).toMatch(/need/);
  });
  it('enforces limits and whole dollars', () => {
    expect(validateInitialBet($(1), 0, $(500), limits)).toMatch(/Minimum/);
    expect(validateInitialBet($(500), 0, $(5000), limits)).toMatch(/Maximum/);
    expect(validateInitialBet(550, 0, $(500), limits)).toMatch(/whole dollars/);
    expect(validateInitialBet($(5), -100, $(500), limits)).not.toBeNull();
    expect(validateInitialBet($(5), $(50), $(500), limits)).toMatch(/Trips/);
  });
  it('formats money', () => {
    expect(formatMoney(150)).toBe('$1.50');
    expect(formatMoney(-2500)).toBe('−$25');
    expect(formatMoney(100000, { sign: true })).toBe('+$1,000');
  });
});

describe('strategy', () => {
  const pre = (s: string) => preflopAdvice(C(s)).action;
  it('pre-flop chart (Wizard of Odds basic strategy)', () => {
    expect(pre('3c 3d')).toBe('play4');
    expect(pre('2c 2d')).toBe('check');
    expect(pre('Ac 2d')).toBe('play4');
    expect(pre('Kc 2c')).toBe('play4');
    expect(pre('Kc 4d')).toBe('check');
    expect(pre('Kc 5d')).toBe('play4');
    expect(pre('Qc 6c')).toBe('play4');
    expect(pre('Qc 5c')).toBe('check');
    expect(pre('Qc 8d')).toBe('play4');
    expect(pre('Qc 7d')).toBe('check');
    expect(pre('Jc 8c')).toBe('play4');
    expect(pre('Jc 7c')).toBe('check');
    expect(pre('Jc Td')).toBe('play4');
    expect(pre('Jc 9d')).toBe('check');
    expect(pre('Tc 9c')).toBe('check');
  });

  it('flop rules', () => {
    const f = (h: string, b: string) => flopAdvice(C(h), C(b)).action;
    expect(f('7c 2d', 'Kh 7s 9d')).toBe('play2');      // hidden pair
    expect(f('3c 2d', 'Kh Ks 9d')).toBe('check');      // board pair only
    expect(f('Kc 2d', 'Kh 7s 7d')).toBe('play2');      // two pair using a hole card
    expect(f('2c 2d', 'Kh 8s 9d')).toBe('check');      // pocket deuces exception
    expect(f('2c 2d', 'Kh 2s 9d')).toBe('play2');      // set of deuces
    expect(f('Tc 3d', 'Kc 8c 4c')).toBe('play2');      // four-flush with hidden ten
    expect(f('9c 3d', 'Kc 8c 4c')).toBe('check');      // four-flush with hidden nine
    expect(f('6c 5d', '7h 8s 2d')).toBe('check');      // open-ended straight draw only
  });

  it('river solver enumerates all 990 dealer combos and picks the higher EV', () => {
    const nuts = riverAdvice(C('As Ks'), C('Qs Js Ts 3c 4d'));
    expect(nuts.detail!.combos).toBe(990);
    expect(nuts.action).toBe('play1');
    expect(nuts.detail!.losses).toBe(0);
    // Board plays (straight on board, hole cards irrelevant): every dealer at least ties -> calling never loses play
    const trash = riverAdvice(C('2c 3d'), C('Kh Kd 9s 9c 5h'));
    expect(trash.action).toBe('fold');
    expect(trash.ev!.fold).toBe(-2);
    const sum = trash.detail!.wins + trash.detail!.ties + trash.detail!.losses;
    expect(sum).toBe(990);
  });

  it('flop and pre-flop EV estimates order sensibly', () => {
    const r = rng(1);
    const strong = flopEV(C('Ac Ad'), C('Ah 7s 2d'), 60, r);
    expect(strong.play2).toBeGreaterThan(strong.check);
    const pf = preflopEV(C('Ac Ad'), 4000, r);
    expect(pf.play4).toBeGreaterThan(pf.play3);
    expect(pf.play4).toBeGreaterThan(pf.check);
    const weak = preflopEV(C('7c 2d'), 4000, r);
    expect(weak.check).toBeGreaterThan(weak.play4);
  });

  it('mistakeCost is null for optimal play and positive for deviations', () => {
    expect(mistakeCost('preflop', C('Ac Kd'), [], 'play4')).toBeNull();
    const m = mistakeCost('river', C('2c 3d'), C('Kh Kd 9s 9c 5h'), 'play1');
    expect(m!.exact).toBe(true);
    expect(m!.cost).toBeGreaterThan(0);
  });
});
