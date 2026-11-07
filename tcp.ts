// Three Card Poker: rules, three-card evaluator, settlement and basic + exact strategy.
// Independent of the Ultimate Texas Hold'em engine except for the shared card model and the standard
// five-card evaluator used by the Six Card Bonus (best five of the player's three + dealer's three).
//
// Rules profile "tcp-2026.11" (pay tables as specified in the project's scope addendum §23):
//  * Dealer qualifies with Queen high or better. Not qualified: Ante 1:1, Play pushes.
//    Qualified: higher hand wins Ante and Play 1:1; dealer higher loses both; exact tie pushes both.
//  * Ante Bonus (needs a Play wager, paid on the Ante, regardless of the dealer): SF 5:1, Trips 4:1, Straight 1:1.
//  * Pair Plus (player's three cards only, live after a fold): SF 40, Trips 30, Straight 6, Flush 3, Pair 1.
//  * Six Card Bonus (best five of player's three + dealer's three, live after a fold):
//    Royal 1000, SF 200, Quads 100, Full House 20, Flush 15, Straight 10, Trips 7.
//  House edges computed here by full enumeration (scratch script, not shipped): Pair Plus 40-30-6-3-1 = 7.276%
//  (the widely used 40-30-6-4-1 table is lower); Six Card Bonus 1000-200-100-20-15-10-7 = 8.561% over all 20,358,520
//  six-card combinations. Ante/Play with Q-6-4 is about 3.37% of the Ante (Wikipedia, "Three Card Poker").
//  General rules reference: Wizard of Odds, https://wizardofodds.com/games/three-card-poker/

import { rankOf, suitOf } from './cards.js';
import { evaluate, handName, type HandName } from './evaluator.js';

export const TCP_RULES_VERSION = 'tcp-2026.11';

export const TCP_CAT = { HighCard: 0, Pair: 1, Flush: 2, Straight: 3, Trips: 4, StraightFlush: 5 } as const;
export const TCP_NAMES = ['High Card', 'Pair', 'Flush', 'Straight', 'Three of a Kind', 'Straight Flush'] as const;
export type TcpHandName = (typeof TCP_NAMES)[number];

/**
 * Comparable score for exactly three cards: category << 12 | three 4-bit rank slots.
 * Straight beats Flush. A-2-3 is the lowest straight (3-high), A-K-Q the highest.
 */
export function evaluate3(cards: number[]): number {
  if (cards.length !== 3) throw new Error('Three Card Poker hands have exactly three cards');
  const r = cards.map(rankOf).sort((a, b) => b - a);
  const flush = suitOf(cards[0]) === suitOf(cards[1]) && suitOf(cards[1]) === suitOf(cards[2]);
  const wheel = r[0] === 12 && r[1] === 1 && r[2] === 0;        // A-3-2
  const straight = (r[0] - r[1] === 1 && r[1] - r[2] === 1) || wheel;
  const top = wheel ? [1, 0, 0] : r;                              // A-2-3 ranks as 3-high
  const pack = (cat: number, a: number, b = 0, c = 0) => (cat << 12) | (a << 8) | (b << 4) | c;
  if (straight && flush) return pack(TCP_CAT.StraightFlush, top[0]);
  if (r[0] === r[2]) return pack(TCP_CAT.Trips, r[0]);
  if (straight) return pack(TCP_CAT.Straight, top[0]);
  if (flush) return pack(TCP_CAT.Flush, r[0], r[1], r[2]);
  if (r[0] === r[1]) return pack(TCP_CAT.Pair, r[0], r[2]);
  if (r[1] === r[2]) return pack(TCP_CAT.Pair, r[1], r[0]);
  return pack(TCP_CAT.HighCard, r[0], r[1], r[2]);
}
export const tcpCategory = (score: number) => score >> 12;
export const tcpHandName = (score: number): TcpHandName => TCP_NAMES[tcpCategory(score)];

const RANK_WORD = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
/** Display name with the rank that matters, e.g. "Queen High" (qualifies) or "Pair of Kings". Settlement uses tcpHandName. */
export function tcpDescribe(score: number): string {
  const cat = tcpCategory(score), top = (score >> 8) & 15;
  if (cat === TCP_CAT.HighCard) return `${RANK_WORD[top]} High`;
  if (cat === TCP_CAT.Pair) return `Pair of ${PLURAL[top]}`;
  if (cat === TCP_CAT.Trips) return `Three ${PLURAL[top]}`;
  return TCP_NAMES[cat];
}

const QUEEN = 10;
/** Dealer qualifies with Queen high or better. */
export function tcpQualifies(dealerScore: number): boolean {
  return tcpCategory(dealerScore) > TCP_CAT.HighCard || ((dealerScore >> 8) & 15) >= QUEEN;
}

export const ANTE_BONUS: Partial<Record<TcpHandName, number>> = { 'Straight Flush': 5, 'Three of a Kind': 4, Straight: 1 };
export const PAIR_PLUS: Partial<Record<TcpHandName, number>> = { 'Straight Flush': 40, 'Three of a Kind': 30, Straight: 6, Flush: 3, Pair: 1 };
export const SIX_CARD: Partial<Record<HandName, number>> = {
  'Royal Flush': 1000, 'Straight Flush': 200, 'Four of a Kind': 100, 'Full House': 20, Flush: 15, Straight: 10, 'Three of a Kind': 7,
};
export const TCP_SOURCES = [
  { title: 'Wizard of Odds — Three Card Poker', url: 'https://wizardofodds.com/games/three-card-poker/' },
  { title: 'Wizard of Odds — Six Card Bonus', url: 'https://wizardofodds.com/games/three-card-poker/six-card-bonus/' },
];

export interface TcpLine { stake: number; result: 'win' | 'lose' | 'push' | 'none'; net: number; credit: number; note?: string; multiplier?: number; combo?: string }
export interface TcpSettlement {
  game: 'tcp';
  outcome: 'win' | 'lose' | 'push' | 'fold';
  dealerQualifies: boolean;
  playerHand: TcpHandName; dealerHand: TcpHandName; sixCardHand: HandName | null;
  ante: TcpLine; play: TcpLine; anteBonus: TcpLine; pairPlus: TcpLine; sixCard: TcpLine;
  totalStake: number; totalCredit: number; net: number; baseNet: number; sideNet: number;
}

const win = (stake: number, profit: number, note?: string, extra: Partial<TcpLine> = {}): TcpLine => ({ stake, result: 'win', net: profit, credit: stake + profit, note, ...extra });
const lose = (stake: number, note?: string): TcpLine => ({ stake, result: 'lose', net: -stake, credit: 0, note });
const push = (stake: number, note?: string): TcpLine => ({ stake, result: 'push', net: 0, credit: stake, note });
const none = (): TcpLine => ({ stake: 0, result: 'none', net: 0, credit: 0 });

export interface TcpSettleInput { ante: number; play: number; pairPlus: number; sixCard: number; folded: boolean; player: number[]; dealer: number[] }

export function settleTcp(i: TcpSettleInput): TcpSettlement {
  const ps = evaluate3(i.player), ds = evaluate3(i.dealer);
  const playerHand = tcpHandName(ps), dealerHand = tcpHandName(ds);
  const qualifies = tcpQualifies(ds);
  let ante: TcpLine, play: TcpLine, anteBonus: TcpLine = none(), outcome: TcpSettlement['outcome'];
  if (i.folded || !i.play) {
    outcome = 'fold';
    ante = lose(i.ante, 'Folded');
    play = none();
  } else {
    // Ante Bonus: paid on the Ante for straight or better, whatever the dealer has.
    const ab = ANTE_BONUS[playerHand];
    anteBonus = ab ? { stake: 0, result: 'win', net: i.ante * ab, credit: i.ante * ab, multiplier: ab, combo: playerHand, note: `Ante Bonus ${ab}:1` } : none();
    if (!qualifies) {
      outcome = 'win';
      ante = win(i.ante, i.ante, 'Dealer does not qualify — Ante pays 1:1');
      play = push(i.play, 'Dealer does not qualify — Play pushes');
    } else if (ps > ds) {
      outcome = 'win'; ante = win(i.ante, i.ante); play = win(i.play, i.play);
    } else if (ps < ds) {
      outcome = 'lose'; ante = lose(i.ante); play = lose(i.play);
    } else {
      outcome = 'push'; ante = push(i.ante, 'Tie'); play = push(i.play, 'Tie');
    }
  }
  let pairPlus = none();
  if (i.pairPlus > 0) {
    const m = PAIR_PLUS[playerHand];
    pairPlus = m ? win(i.pairPlus, i.pairPlus * m, `${playerHand} pays ${m}:1`, { multiplier: m, combo: playerHand }) : lose(i.pairPlus);
  }
  let sixCard = none(), sixCardHand: HandName | null = null;
  if (i.sixCard > 0) {
    sixCardHand = handName(evaluate([...i.player, ...i.dealer]));   // standard five-card ranks, best 5 of 6
    const m = SIX_CARD[sixCardHand];
    sixCard = m ? win(i.sixCard, i.sixCard * m, `${sixCardHand} pays ${m.toLocaleString('en-US')}:1`, { multiplier: m, combo: sixCardHand }) : lose(i.sixCard);
  }
  const lines = [ante, play, anteBonus, pairPlus, sixCard];
  const totalStake = lines.reduce((s, l) => s + l.stake, 0), totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const baseNet = ante.net + play.net + anteBonus.net, sideNet = pairPlus.net + sixCard.net;
  return { game: 'tcp', outcome, dealerQualifies: qualifies, playerHand, dealerHand, sixCardHand, ante, play, anteBonus, pairPlus, sixCard,
    totalStake, totalCredit, net: totalCredit - totalStake, baseNet, sideNet };
}

// ------------------------------------------------------------------ strategy
/** Basic strategy: play Queen-6-4 or better, fold anything lower. */
export function tcpBasicPlay(cards: number[]): boolean {
  const s = evaluate3(cards);
  if (tcpCategory(s) > TCP_CAT.HighCard) return true;
  const r = [(s >> 8) & 15, (s >> 4) & 15, s & 15];
  const q64 = [10, 4, 2];                                        // Q, 6, 4 as ranks (2 = 0)
  for (let k = 0; k < 3; k++) { if (r[k] !== q64[k]) return r[k] > q64[k]; }
  return true;
}

/**
 * Exact expected value (in Antes) of Play and Fold over every possible dealer hand from the 49 unseen
 * cards: C(49,3) = 18,424. Main game + Ante Bonus only; side bets don't depend on the decision.
 */
export function tcpExactEV(cards: number[]): { play: number; fold: number; combos: number; wins: number; losses: number; ties: number; noQualify: number } {
  const seen = new Set(cards);
  const rest: number[] = [];
  for (let c = 0; c < 52; c++) if (!seen.has(c)) rest.push(c);
  const ps = evaluate3(cards);
  const bonus = ANTE_BONUS[tcpHandName(ps)] ?? 0;
  let total = 0, n = 0, wins = 0, losses = 0, ties = 0, noQ = 0;
  for (let a = 0; a < rest.length; a++) for (let b = a + 1; b < rest.length; b++) for (let c = b + 1; c < rest.length; c++) {
    const ds = evaluate3([rest[a], rest[b], rest[c]]);
    n++;
    let v: number;
    if (!tcpQualifies(ds)) { v = 1; noQ++; }           // Ante +1, Play push
    else if (ps > ds) { v = 2; wins++; }
    else if (ps < ds) { v = -2; losses++; }
    else { v = 0; ties++; }
    total += v + bonus;
  }
  return { play: total / n, fold: -1, combos: n, wins, losses, ties, noQualify: noQ };
}

export interface TcpAdvice { action: 'play1' | 'fold'; reason: string; ev?: { play: number; fold: number } }
export function tcpAdvice(cards: number[], exact = true): TcpAdvice {
  const s = evaluate3(cards);
  const name = tcpHandName(s);
  const play = tcpBasicPlay(cards);
  const ev = exact ? tcpExactEV(cards) : undefined;
  const reason = tcpCategory(s) > TCP_CAT.HighCard
    ? `${name} — any pair or better is a Play.`
    : play ? 'Queen-6-4 or better — Play.' : 'Lower than Queen-6-4 — Fold.';
  return { action: play ? 'play1' : 'fold', reason, ev: ev ? { play: ev.play, fold: ev.fold } : undefined };
}
