// Poker hand evaluator for 1..7 cards (integers from cards.ts).
// Returns a single comparable score: higher is better.
// Score layout: category << 20 | five 4-bit tie-break rank slots.
//
// Audit notes vs. the original prototype:
//  - The prototype brute-forced all 21 five-card combos and compared "kickers" arrays whose
//    lengths differed by category; a full house compared trips then pair correctly, but two
//    hands with different kicker array lengths could compare against an implicit 0. This
//    evaluator encodes every category into a fixed-width score so comparisons are exact.
//  - Two pair now picks the best kicker from ALL remaining cards (including a third pair).
//  - Full house picks the best pair from any remaining group of 2+ (including a second set).
//  - The wheel (A-2-3-4-5) is a 5-high straight; a steel wheel is a 5-high straight flush.

import { rankOf, suitOf } from './cards.js';

export const Cat = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export const CATEGORY_NAMES = [
  'High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush',
] as const;
export type HandName = (typeof CATEGORY_NAMES)[number];

function pack(cat: number, ranks: number[]): number {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] ?? 0);
  return s;
}

export const categoryOf = (score: number) => Math.floor(score / 0x100000);

/** Highest straight in a 13-bit rank mask; returns top rank index or -1. */
function topStraight(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((mask & need) === need) return hi;
  }
  // wheel: A,2,3,4,5 -> bits 12,0,1,2,3 ; top card is the five (index 3)
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

function topRanks(mask: number, n: number, exclude: number[] = []): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (mask & (1 << r) && !exclude.includes(r)) out.push(r);
  }
  return out;
}

export function evaluate(cards: number[]): number {
  const counts = new Array<number>(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    counts[r]++;
    suitMask[suitOf(c)] |= 1 << r;
    rankMask |= 1 << r;
  }

  // Flush / straight flush
  let flushMask = 0;
  for (let s = 0; s < 4; s++) if (popcount(suitMask[s]) >= 5) flushMask = suitMask[s];
  if (flushMask) {
    const sf = topStraight(flushMask);
    if (sf >= 0) return pack(Cat.StraightFlush, [sf]);
  }

  const quads: number[] = [], trips: number[] = [], pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quads.length) {
    const q = quads[0];
    return pack(Cat.Quads, [q, ...topRanks(rankMask, 1, [q])]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(Cat.FullHouse, [t, p]);
  }
  if (flushMask) return pack(Cat.Flush, topRanks(flushMask, 5));
  const st = topStraight(rankMask);
  if (st >= 0) return pack(Cat.Straight, [st]);
  if (trips.length) {
    const t = trips[0];
    return pack(Cat.Trips, [t, ...topRanks(rankMask, 2, [t])]);
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs;
    return pack(Cat.TwoPair, [a, b, ...topRanks(rankMask, 1, [a, b])]);
  }
  if (pairs.length === 1) {
    const p = pairs[0];
    return pack(Cat.Pair, [p, ...topRanks(rankMask, 3, [p])]);
  }
  return pack(Cat.HighCard, topRanks(rankMask, 5));
}

function popcount(x: number): number {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

export function handName(score: number): HandName {
  const cat = categoryOf(score);
  if (cat === Cat.StraightFlush) {
    const top = Math.floor(score / 0x10000) & 0xf;
    return top === 12 ? 'Royal Flush' : 'Straight Flush';
  }
  return CATEGORY_NAMES[cat];
}

/** Index into CATEGORY_NAMES (Royal Flush = 9) — used for "best hand" stats. */
export function handNameRank(name: HandName): number {
  return CATEGORY_NAMES.indexOf(name);
}

/** Five cards (subset of input) that make the best hand — used for highlighting. */
export function bestFive(cards: number[]): number[] {
  if (cards.length <= 5) return cards.slice();
  const target = evaluate(cards);
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      if (evaluate(combo) === target) return combo;
    }
  return cards.slice(0, 5);
}
