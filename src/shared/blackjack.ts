// Blackjack (scope addendum §27). Pure rules: totals, legal actions, dealer play, settlement and basic strategy.
// All money is integer cents. The server is the only caller that decides anything; the client uses this module
// only to label totals and show the trainer's advice.

import type { CardStr } from './cards.js';

export const BJ_RULES_VERSION = 'bj-2026.11';

export interface BjRules {
  decks: number;
  /** Blackjack pays num:den (3:2). */
  bjPays: [number, number];
  /** Dealer hits soft 17? Default false: stands on all 17s. */
  h17: boolean;
  /** Double on any first two cards. */
  doubleAny2: boolean;
  doubleAfterSplit: boolean;
  /** Most hands one player can hold after splitting. */
  maxHands: number;
  resplitAces: boolean;
  /** Split aces receive exactly one card each. */
  splitAcesOneCard: boolean;
  insurance: boolean;
  lateSurrender: boolean;
  /** Dealer peeks for blackjack with an Ace or ten-value upcard. */
  peek: boolean;
  /** Reshuffle between rounds once this share of the shoe has been dealt. */
  penetration: number;
}
export const DEFAULT_BJ_RULES: BjRules = {
  decks: 6, bjPays: [3, 2], h17: false, doubleAny2: true, doubleAfterSplit: true, maxHands: 4, resplitAces: false,
  splitAcesOneCard: true, insurance: true, lateSurrender: false, peek: true, penetration: 0.75,
};

/** Rules shown to players before they bet (§27.2). */
export function rulesSummary(r: BjRules): string[] {
  return [
    `${r.decks} decks, shuffled when about ${Math.round(r.penetration * 100)}% has been dealt`,
    `Blackjack pays ${r.bjPays[0]}:${r.bjPays[1]}`,
    r.h17 ? 'Dealer hits soft 17' : 'Dealer stands on all 17s (including soft 17)',
    'Double down on any first two cards' + (r.doubleAfterSplit ? ', including after a split' : ''),
    `Split up to ${r.maxHands} hands; ${r.resplitAces ? 'aces may be resplit' : 'aces cannot be resplit'}; split aces get one card each`,
    '21 after a split is not a blackjack (it pays 1:1)',
    r.insurance ? 'Insurance offered on a dealer Ace, up to half your bet, pays 2:1' : 'No insurance',
    r.lateSurrender ? 'Late surrender: give up half your bet after the dealer checks for blackjack' : 'No surrender',
    r.peek ? 'Dealer checks for blackjack with an Ace or ten-value card showing' : 'No hole-card check',
  ];
}

// ------------------------------------------------------------------ totals
/** Blackjack value of a card's rank (A=11 here; total() reduces to 1 as needed). */
export function cardValue(c: CardStr): number {
  const r = c[0];
  if (r === 'A') return 11;
  if ('TJQK'.includes(r)) return 10;
  return Number(r);
}
export interface Total { total: number; soft: boolean; bust: boolean }
export function total(cards: CardStr[]): Total {
  let t = 0, aces = 0;
  for (const c of cards) { const v = cardValue(c); t += v; if (v === 11) aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0, bust: t > 21 };
}
/** A natural: Ace + ten-value as the first two cards of an unsplit hand. */
export const isNatural = (cards: CardStr[], fromSplit: boolean) => !fromSplit && cards.length === 2 && total(cards).total === 21;
export const isPair = (cards: CardStr[]) => cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
export function describeTotal(cards: CardStr[], fromSplit = false): string {
  if (!cards.length) return '';
  if (isNatural(cards, fromSplit)) return 'Blackjack';
  const t = total(cards);
  if (t.bust) return `Bust (${t.total})`;
  return t.soft && t.total < 21 ? `Soft ${t.total}` : String(t.total);
}

// ------------------------------------------------------------------ hands and actions
export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';
export interface BjHand {
  cards: CardStr[];
  bet: number;               // cents, including any double
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  surrendered: boolean;
}
export const newHand = (cards: CardStr[], bet: number, fromSplit = false, splitAces = false): BjHand =>
  ({ cards, bet, doubled: false, fromSplit, splitAces, done: false, surrendered: false });

/**
 * Legal actions for one hand. `canAfford` is the stack available for another wager equal to the original bet.
 * Unaffordable doubles and splits are simply not offered (§27.4).
 */
export function legalActions(h: BjHand, handsHeld: number, r: BjRules, canAfford: boolean): BjAction[] {
  if (h.done) return [];
  const t = total(h.cards);
  if (t.bust || t.total === 21 && h.cards.length === 2 && !h.fromSplit) return [];
  if (h.splitAces && r.splitAcesOneCard) return [];
  const out: BjAction[] = ['hit', 'stand'];
  const firstTwo = h.cards.length === 2 && !h.doubled;
  if (firstTwo && canAfford && r.doubleAny2 && (!h.fromSplit || r.doubleAfterSplit)) out.push('double');
  if (firstTwo && isPair(h.cards) && canAfford && handsHeld < r.maxHands && (h.cards[0][0] !== 'A' || !h.fromSplit || r.resplitAces)) out.push('split');
  if (firstTwo && r.lateSurrender && !h.fromSplit && handsHeld === 1) out.push('surrender');
  return out;
}

/** Dealer draws to 17 (standing on soft 17 unless h17). Returns the final cards. */
export function dealerPlay(cards: CardStr[], draw: () => CardStr, r: BjRules): CardStr[] {
  const out = [...cards];
  for (;;) {
    const t = total(out);
    if (t.total > 17 || (t.total === 17 && !(t.soft && r.h17))) break;
    out.push(draw());
  }
  return out;
}
/** Does the dealer need to draw at all (any live player hand that isn't a settled natural or surrender)? */
export const dealerMustPlay = (hands: BjHand[]) => hands.some((h) => !h.surrendered && !total(h.cards).bust && !isNatural(h.cards, h.fromSplit));

// ------------------------------------------------------------------ settlement (exact cents)
export type BjOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender';
export interface BjHandResult { outcome: BjOutcome; bet: number; credit: number; net: number; total: string }
/** One hand against the dealer's final cards. Credit = stake returned + winnings. */
export function settleHand(h: BjHand, dealer: CardStr[], r: BjRules): BjHandResult {
  const p = total(h.cards), d = total(dealer);
  const pNat = isNatural(h.cards, h.fromSplit), dNat = isNatural(dealer, false);
  const res = (outcome: BjOutcome, credit: number): BjHandResult => ({ outcome, bet: h.bet, credit, net: credit - h.bet, total: describeTotal(h.cards, h.fromSplit) });
  if (h.surrendered) return res('surrender', h.bet / 2);
  if (pNat && dNat) return res('push', h.bet);
  if (pNat) return res('blackjack', h.bet + (h.bet * r.bjPays[0]) / r.bjPays[1]);
  if (dNat) return res('lose', 0);
  if (p.bust) return res('bust', 0);
  if (d.bust || p.total > d.total) return res('win', h.bet * 2);
  if (p.total === d.total) return res('push', h.bet);
  return res('lose', 0);
}
/** Insurance: pays 2:1 when the dealer has blackjack. */
export function settleInsurance(amount: number, dealer: CardStr[]) {
  if (!amount) return { credit: 0, net: 0 };
  const won = isNatural(dealer, false);
  return { credit: won ? amount * 3 : 0, net: won ? amount * 2 : -amount };
}
/** Bets are whole cents; 3:2 on an odd number of cents would leave half a cent, so bets must keep payouts exact. */
export const exactBet = (bet: number, r: BjRules) => Number.isInteger((bet * r.bjPays[0]) / r.bjPays[1]) && Number.isInteger(bet / 2);
export const maxInsurance = (bet: number) => Math.floor(bet / 2);

// ------------------------------------------------------------------ basic strategy (multi-deck, dealer stands on soft 17)
// Source chart: the standard 4–8 deck, dealer-stands-on-soft-17, double-after-split basic strategy (e.g. the
// Wizard of Odds 4-8 deck S17 DAS chart). Codes: H hit, S stand, D double else hit, Ds double else stand,
// P split, Ph split if DAS else hit, Rh surrender else hit, Rs surrender else stand, Rp surrender else split.
type Code = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Ph' | 'Rh' | 'Rs' | 'Rp';
const UP = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
const row = (s: string) => s.split(' ') as Code[];
const HARD: Record<number, Code[]> = {
  8: row('H H H H H H H H H H'),
  9: row('H D D D D H H H H H'),
  10: row('D D D D D D D D H H'),
  11: row('D D D D D D D D D H'),
  12: row('H H S S S H H H H H'),
  13: row('S S S S S H H H H H'),
  14: row('S S S S S H H H H H'),
  15: row('S S S S S H H H Rh H'),
  16: row('S S S S S H H Rh Rh Rh'),
  17: row('S S S S S S S S S S'),
};
const SOFT: Record<number, Code[]> = {
  13: row('H H H D D H H H H H'),
  14: row('H H H D D H H H H H'),
  15: row('H H D D D H H H H H'),
  16: row('H H D D D H H H H H'),
  17: row('H D D D D H H H H H'),
  18: row('S Ds Ds Ds Ds S S H H H'),
  19: row('S S S S S S S S S S'),
  20: row('S S S S S S S S S S'),
};
const PAIRS: Record<string, Code[]> = {
  A: row('P P P P P P P P P P'),
  T: row('S S S S S S S S S S'),
  '9': row('P P P P P S P P S S'),
  '8': row('P P P P P P P P P P'),
  '7': row('P P P P P P H H H H'),
  '6': row('Ph P P P P H H H H H'),
  '5': row('D D D D D D D D H H'),
  '4': row('H H H Ph Ph H H H H H'),
  '3': row('Ph Ph P P P P H H H H'),
  '2': row('Ph Ph P P P P H H H H'),
};
const upIdx = (c: CardStr) => { const r = 'TJQK'.includes(c[0]) ? 'T' : c[0]; return UP.indexOf(r); };
const pairKey = (c: CardStr) => ('TJQK'.includes(c[0]) ? 'T' : c[0]);

export interface BjAdvice {
  /** Best action ignoring whether the player can afford it. */
  ideal: BjAction;
  /** Best action among those actually available right now. */
  best: BjAction;
  /** The ideal play wasn't available only because of the bankroll: decisions here are ungraded. */
  constrained: boolean;
  kind: 'hard' | 'soft' | 'pair';
  reason: string;
}
const NAME: Record<BjAction, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

/**
 * Basic-strategy advice for a hand. `available` are the legal actions (affordability already applied);
 * `rules` decide whether doubling after split and surrender exist at all.
 */
export function bjAdvice(h: BjHand, up: CardStr, available: BjAction[], r: BjRules, handsHeld = 1): BjAdvice {
  const t = total(h.cards), u = upIdx(up), upName = up[0] === 'A' ? 'Ace' : 'TJQK'.includes(up[0]) ? '10' : up[0];
  const firstTwo = h.cards.length === 2 && !h.doubled;
  // What the chart says with every option the RULES allow (money aside).
  const ruleDouble = firstTwo && r.doubleAny2 && (!h.fromSplit || r.doubleAfterSplit);
  const ruleSplit = firstTwo && isPair(h.cards) && handsHeld < r.maxHands && (h.cards[0][0] !== 'A' || !h.fromSplit || r.resplitAces);
  const ruleSurrender = firstTwo && r.lateSurrender && !h.fromSplit && handsHeld === 1;
  let kind: BjAdvice['kind'] = t.soft ? 'soft' : 'hard';
  const asTotal = (): Code => t.soft
    ? (t.total >= 13 && t.total <= 20 ? SOFT[t.total][u] : t.total >= 19 ? 'S' : 'H')
    : (t.total <= 8 ? 'H' : t.total >= 17 ? 'S' : HARD[t.total][u]);
  let code: Code;
  if (ruleSplit && PAIRS[pairKey(h.cards[0])][u] !== undefined && ['P', 'Ph', 'Rp'].includes(PAIRS[pairKey(h.cards[0])][u])) {
    kind = 'pair';
    code = PAIRS[pairKey(h.cards[0])][u];
    if (code === 'Ph' && !r.doubleAfterSplit) code = 'H';
  } else code = asTotal();
  if (isPair(h.cards) && kind !== 'pair' && firstTwo) kind = 'pair';
  const resolve = (c: Code, can: { d: boolean; p: boolean; r: boolean }): BjAction => {
    switch (c) {
      case 'H': return 'hit';
      case 'S': return 'stand';
      case 'D': return can.d ? 'double' : 'hit';
      case 'Ds': return can.d ? 'double' : 'stand';
      case 'P': case 'Ph': return can.p ? 'split' : resolve(asTotal(), can);
      case 'Rh': return can.r ? 'surrender' : 'hit';
      case 'Rs': return can.r ? 'surrender' : 'stand';
      case 'Rp': return can.r ? 'surrender' : can.p ? 'split' : 'hit';
    }
  };
  const ideal = resolve(code, { d: ruleDouble, p: ruleSplit, r: ruleSurrender });
  const best = resolve(code, { d: available.includes('double'), p: available.includes('split'), r: available.includes('surrender') });
  const constrained = ideal !== best && (ideal === 'double' || ideal === 'split');
  const what = kind === 'pair' ? `Pair of ${pairKey(h.cards[0]) === 'T' ? '10s' : pairKey(h.cards[0]) === 'A' ? 'Aces' : pairKey(h.cards[0]) + 's'}` : `${t.soft ? 'Soft' : 'Hard'} ${t.total}`;
  return { ideal, best, constrained, kind, reason: `${what} against a dealer ${upName}: ${NAME[ideal]}${ideal !== best ? ` (not available — ${NAME[best]} instead)` : ''}. ${why(ideal, kind, t.total, upName)}` };
}
function why(a: BjAction, kind: BjAdvice['kind'], tot: number, up: string): string {
  const weak = ['2', '3', '4', '5', '6'].includes(up);
  switch (a) {
    case 'split': return kind === 'pair' && tot === 16 ? 'Two hands starting from 8 beat one stiff 16.' : kind === 'pair' && tot === 12 ? 'Two hands starting from an Ace are far stronger than a soft 12.' : weak ? 'The dealer is likely to bust; get more money out with two hands.' : 'Each half makes a better start than the pair does as one hand.';
    case 'double': return weak ? 'The dealer’s weak card busts often — press your edge with one card.' : 'You’re the favorite to beat the dealer’s card; double the bet for one card.';
    case 'stand': return weak && tot < 17 ? 'Let the dealer risk busting with a weak upcard.' : 'Your total is strong enough to stand.';
    case 'hit': return tot <= 11 ? 'You can’t bust with one card.' : 'Against a strong dealer card, standing on this total loses more often than hitting.';
    case 'surrender': return 'This hand loses more than half the time against that card; surrendering saves half the bet.';
  }
}
/** Basic strategy never takes insurance (it only pays for itself with a card count). */
export const insuranceAdvice = { take: false, reason: 'Insurance pays 2:1, but fewer than one in three hole cards is a ten — it costs about 7% of what you put up. Basic strategy always declines.' };

// ------------------------------------------------------------------ shoe
/** A shoe of `decks` decks as card ids (0–51, each `decks` times), in the order given. */
export function shoeFrom(order: number[], decks: number): number[] {
  if (order.length !== decks * 52) throw new Error('shoe size');
  return order;
}

// ------------------------------------------------------------------ §31 EV cost of a Blackjack decision
// Infinite-deck approximation (each rank drawn with fixed probability), dealer peeked (no natural), split hands
// played without resplitting. Within a few thousandths of a bet of six-deck values — good enough to say what a
// mistake cost on average, which is all EV lost is used for. Never used for settlement.
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];        // 11 = ace
const P = (v: number) => (v === 10 ? 4 / 13 : 1 / 13);
type St = { hard: number; ace: boolean };
const best = (s: St) => (s.ace && s.hard + 10 <= 21 ? s.hard + 10 : s.hard);
const add = (s: St, v: number): St => ({ hard: s.hard + (v === 11 ? 1 : v), ace: s.ace || v === 11 });
const distCache = new Map<string, number[]>();
/** Dealer final totals [17,18,19,20,21,bust] given the upcard value, after the peek showed no blackjack. */
function dealerDist(up: number, h17: boolean): number[] {
  const k = `${up}:${h17}`;
  const hit = distCache.get(k); if (hit) return hit;
  const out = [0, 0, 0, 0, 0, 0];
  const go = (s: St, p: number) => {
    const t = best(s);
    if (s.hard > 21) { out[5] += p; return; }
    const soft = s.ace && s.hard + 10 <= 21;
    if (t > 17 || (t === 17 && !(soft && h17))) { out[t - 17] += p; return; }
    for (const v of RANKS) go(add(s, v), p * P(v));
  };
  const s0 = add({ hard: 0, ace: false }, up);
  const banned = up === 11 ? 10 : up === 10 ? 11 : 0;
  const norm = 1 - (banned ? P(banned) : 0);
  for (const v of RANKS) if (v !== banned) go(add(s0, v), P(v) / norm);
  distCache.set(k, out);
  return out;
}
function standEV(s: St, d: number[]): number {
  const t = best(s);
  if (s.hard > 21) return -1;
  let ev = d[5];
  for (let i = 0; i < 5; i++) ev += 17 + i < t ? d[i] : 17 + i > t ? -d[i] : 0;
  return ev;
}
function hitEV(s: St, d: number[], memo: Map<string, number>): number {
  const k = `${s.hard}:${s.ace}`;
  const m = memo.get(k); if (m !== undefined) return m;
  let ev = 0;
  for (const v of RANKS) {
    const n = add(s, v);
    ev += P(v) * (n.hard > 21 ? -1 : Math.max(standEV(n, d), hitEV(n, d, memo)));
  }
  memo.set(k, ev);
  return ev;
}
const doubleEV = (s: St, d: number[]) => 2 * RANKS.reduce((a, v) => { const n = add(s, v); return a + P(v) * (n.hard > 21 ? -1 : standEV(n, d)); }, 0);

/** Expected value (in units of one original bet) of each action for this hand against this upcard. */
export function bjActionEVs(h: BjHand, up: CardStr, r: BjRules): Partial<Record<BjAction, number>> {
  const d = dealerDist(cardValue(up), r.h17), memo = new Map<string, number>();
  const s = h.cards.reduce<St>((a, c) => add(a, cardValue(c)), { hard: 0, ace: false });
  const out: Partial<Record<BjAction, number>> = { stand: standEV(s, d), hit: hitEV(s, d, memo), double: doubleEV(s, d), surrender: -0.5 };
  if (h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1])) {
    const c = cardValue(h.cards[0]);
    const one = RANKS.reduce((a, v) => {
      const n = add(add({ hard: 0, ace: false }, c), v);
      const ev = c === 11 && r.splitAcesOneCard ? standEV(n, d)
        : Math.max(standEV(n, d), hitEV(n, d, memo), r.doubleAfterSplit ? doubleEV(n, d) : -Infinity);
      return a + P(v) * ev;
    }, 0);
    out.split = 2 * one;
  }
  return out;
}
/** What choosing `action` instead of `recommended` cost, in original bets (never negative). */
export function bjEvCost(h: BjHand, up: CardStr, action: BjAction, recommended: BjAction, r: BjRules): number {
  if (action === recommended) return 0;
  const ev = bjActionEVs(h, up, r);
  const a = ev[action], b = ev[recommended];
  return a === undefined || b === undefined ? 0 : Math.max(0, b - a);
}
/** Insurance costs 1/13 of the insurance stake on average (a 10 shows 4 times in 13); declining costs nothing. */
export const insuranceEvCost = (stake: number, bet: number) => (bet ? (stake / 13) / bet : 0);
