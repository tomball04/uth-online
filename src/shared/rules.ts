// Ultimate Texas Hold'em rules and settlement. Pure functions, shared by server (authoritative),
// the river solver, and the client (for training explanations only — never for balances).
//
// MONEY: every amount is an integer number of CENTS, and every bet is in whole dollars. Like a real casino
// table without half-dollar chips, a 3:2 Blind payout on an odd bet is rounded DOWN to the whole dollar
// ($25 Blind on a flush pays $37, not $37.50).
//
// Corrections vs. the original prototype:
//  1. Dealer non-qualification only pushes the ANTE. Play and Blind are still settled by comparing
//     hands (the prototype paid Play automatically and pushed Blind when the dealer didn't qualify,
//     even if the dealer's unqualified hand beat the player).
//  2. Trips+ is resolved on folded hands and the winnings are actually credited (the prototype
//     added the win to "net" but never returned stake + win to the bankroll on folds).
//  3. Affordability reserves the mandatory 1x Play on top of Ante + Blind + Trips.

import { Cat, categoryOf, evaluate, handName, type HandName } from './evaluator.js';
import {
  BAD_BEAT_VARIANTS, DEFAULT_BAD_BEAT_VARIANT, DEFAULT_PAIRS_VARIANT, PAIRS_VARIANTS, evaluateBadBeat, evaluatePairs,
  type BadBeatVariant, type PairsVariant,
} from './sidebets.js';
import { PROGRESSIVE, type ProgressiveAward } from './progressive.js';

export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000] as const; // $1 $5 $25 $100 $500

/** Blind pays only when the player WINS with a straight or better. [numerator, denominator] */
export const BLIND_PAYTABLE: Partial<Record<HandName, [number, number]>> = {
  'Royal Flush': [500, 1],
  'Straight Flush': [50, 1],
  'Four of a Kind': [10, 1],
  'Full House': [3, 1],
  'Flush': [3, 2],
  'Straight': [1, 1],
};

/** Trips+ pays on the player's own 7-card hand regardless of the dealer or a fold. */
export const TRIPS_PAYTABLE: Partial<Record<HandName, number>> = {
  'Royal Flush': 50,
  'Straight Flush': 40,
  'Four of a Kind': 30,
  'Full House': 8,
  'Flush': 6,
  'Straight': 5,
  'Three of a Kind': 3,
};

export type WagerResult = 'win' | 'lose' | 'push' | 'none';

export interface WagerOutcome {
  stake: number;      // amount wagered (cents)
  result: WagerResult;
  net: number;        // profit (+) or loss (−) in cents
  credit: number;     // amount returned to the balance (stake back + winnings), cents
  note?: string;
  multiplier?: number; // X to 1 paid, side bets and Blind bonus
  combo?: string;      // qualifying combination (side bets)
  variant?: string;    // pay-table variant id (side bets)
}

export interface SettleInput {
  ante: number;
  blind: number;
  play: number;       // 0 if folded
  trips: number;      // 0 if no side bet
  pairs?: number;     // Ultimate Pairs wager
  badBeat?: number;   // Bad Beat wager
  progressive?: number;              // $5 Five Card Progressive (0 or PROGRESSIVE.wager)
  progressiveAward?: ProgressiveAward | null; // resolved against the live meter at settlement
  pairsVariant?: PairsVariant['id'];
  badBeatVariant?: BadBeatVariant['id'];
  playerHole?: number[]; // required when pairs > 0
  dealerHole?: number[]; // required when pairs > 0 (some variants pay on the dealer's cards)
  folded: boolean;
  playerScore: number;
  dealerScore: number;
}

export interface Settlement {
  outcome: 'win' | 'lose' | 'push' | 'fold';
  dealerQualifies: boolean;
  playerHand: HandName;
  dealerHand: HandName;
  ante: WagerOutcome;
  blind: WagerOutcome;
  play: WagerOutcome;
  trips: WagerOutcome;
  pairs: WagerOutcome;
  badBeat: WagerOutcome;
  progressive: WagerOutcome;
  totalStake: number;
  totalCredit: number;
  net: number;
  /** Ante + Blind + Play only — what strategy and house-edge reporting use. */
  baseNet: number;
  /** Trips+ + Ultimate Pairs + Bad Beat + Progressive, reported separately. */
  sideNet: number;
}

const win = (stake: number, profit: number, note?: string): WagerOutcome =>
  ({ stake, result: 'win', net: profit, credit: stake + profit, note });
const lose = (stake: number, note?: string): WagerOutcome =>
  ({ stake, result: 'lose', net: -stake, credit: 0, note });
const push = (stake: number, note?: string): WagerOutcome =>
  ({ stake, result: 'push', net: 0, credit: stake, note });
const none = (): WagerOutcome => ({ stake: 0, result: 'none', net: 0, credit: 0 });

export function dealerQualifies(dealerScore: number): boolean {
  return categoryOf(dealerScore) >= Cat.Pair;
}

export function settleTrips(trips: number, playerScore: number): WagerOutcome {
  if (trips <= 0) return none();
  const name = handName(playerScore);
  const mult = TRIPS_PAYTABLE[name];
  return mult ? { ...win(trips, trips * mult, `${name} pays ${mult}:1`), multiplier: mult, combo: name } : lose(trips, name);
}

export function settlePairs(stake: number, variantId: PairsVariant['id'], hole: number[] | undefined, dealerHole: number[] | undefined): WagerOutcome {
  if (!stake) return none();
  if (!hole || hole.length !== 2 || !dealerHole || dealerHole.length !== 2) throw new Error('Ultimate Pairs needs both hole-card pairs to settle');
  const v = PAIRS_VARIANTS[variantId];
  const r = evaluatePairs(v, hole, dealerHole);
  return r.won
    ? { ...win(stake, stake * r.payout, `${r.label} pays ${r.payout.toLocaleString('en-US')}:1`), multiplier: r.payout, combo: r.label!, variant: v.id }
    : { ...lose(stake, 'No qualifying hole cards'), variant: v.id };
}

export function settleBadBeat(stake: number, variantId: BadBeatVariant['id'], playerScore: number, dealerScore: number): WagerOutcome {
  if (!stake) return none();
  const v = BAD_BEAT_VARIANTS[variantId];
  const r = evaluateBadBeat(v, playerScore, dealerScore);
  return r.won
    ? { ...win(stake, stake * r.payout, `${r.reason} — pays ${r.payout.toLocaleString('en-US')}:1`), multiplier: r.payout, combo: `${r.loser === 'player' ? 'Player' : 'Dealer'} ${r.losingHand}`, variant: v.id }
    : { ...lose(stake, r.reason), variant: v.id };
}

/** Progressive pays the award as the total amount — the wager is NOT returned, as in a casino. */
export function settleProgressive(stake: number, award: ProgressiveAward | null | undefined): WagerOutcome {
  if (!stake) return none();
  if (!award || award.amount <= 0) return lose(stake, award ? `${award.hand} — no award` : 'No award');
  return { stake, result: 'win', net: award.amount - stake, credit: award.amount, note: award.label, combo: award.hand };
}

export function settle(i: SettleInput): Settlement {
  assertCents(i.ante, i.blind, i.play, i.trips, i.pairs ?? 0, i.badBeat ?? 0, i.progressive ?? 0);
  const playerHand = handName(i.playerScore);
  const dealerHand = handName(i.dealerScore);
  const qualifies = dealerQualifies(i.dealerScore);
  const trips = settleTrips(i.trips, i.playerScore);

  let ante: WagerOutcome, blind: WagerOutcome, play: WagerOutcome, outcome: Settlement['outcome'];

  if (i.folded) {
    outcome = 'fold';
    ante = lose(i.ante, 'Folded');
    blind = lose(i.blind, 'Folded');
    play = none();
  } else {
    const cmp = Math.sign(i.playerScore - i.dealerScore);
    outcome = cmp > 0 ? 'win' : cmp < 0 ? 'lose' : 'push';

    // ANTE: pushes if dealer does not qualify; otherwise follows the comparison.
    if (!qualifies) ante = push(i.ante, 'Dealer does not qualify');
    else if (cmp > 0) ante = win(i.ante, i.ante);
    else if (cmp < 0) ante = lose(i.ante);
    else ante = push(i.ante, 'Tie');

    // PLAY: 1:1 on a win, push on tie, lose otherwise — qualification is irrelevant.
    if (cmp > 0) play = win(i.play, i.play);
    else if (cmp < 0) play = lose(i.play);
    else play = push(i.play, 'Tie');

    // BLIND: pays the bonus table on a winning straight+, pushes on other wins and ties, loses on a loss.
    if (cmp > 0) {
      const pay = BLIND_PAYTABLE[playerHand];
      if (pay) {
        // Casino breakage: odd payouts (3:2 on an odd-dollar Blind) are paid in whole dollars, rounded down.
        const exact = (i.blind * pay[0]) / pay[1];
        const profit = Math.floor(exact / 100) * 100;
        blind = { ...win(i.blind, profit, `${playerHand} pays ${pay[0]}:${pay[1]}${profit !== exact ? ' (rounded down to the dollar)' : ''}`), multiplier: pay[0] / pay[1] };
      } else blind = push(i.blind, 'Win below a straight');
    } else if (cmp < 0) blind = lose(i.blind);
    else blind = push(i.blind, 'Tie');
  }

  // Side bets resolve on the actual cards whether or not the player folded.
  const pairs = settlePairs(i.pairs ?? 0, i.pairsVariant ?? DEFAULT_PAIRS_VARIANT, i.playerHole, i.dealerHole);
  const badBeat = settleBadBeat(i.badBeat ?? 0, i.badBeatVariant ?? DEFAULT_BAD_BEAT_VARIANT, i.playerScore, i.dealerScore);

  const progressive = settleProgressive(i.progressive ?? 0, i.progressiveAward);

  const parts = [ante, blind, play, trips, pairs, badBeat, progressive];
  const totalStake = parts.reduce((s, p) => s + p.stake, 0);
  const totalCredit = parts.reduce((s, p) => s + p.credit, 0);
  return {
    outcome, dealerQualifies: qualifies, playerHand, dealerHand,
    ante, blind, play, trips, pairs, badBeat, progressive, totalStake, totalCredit, net: totalCredit - totalStake,
    baseNet: ante.net + blind.net + play.net,
    sideNet: trips.net + pairs.net + badBeat.net + progressive.net,
  };
}

/** Convenience used by tests and the solver. */
export function settleCards(
  hole: number[], dealer: number[], board: number[],
  bets: { ante: number; play: number; trips?: number; folded?: boolean; pairs?: number; badBeat?: number;
    pairsVariant?: PairsVariant['id']; badBeatVariant?: BadBeatVariant['id'] },
): Settlement {
  return settle({
    ante: bets.ante, blind: bets.ante, play: bets.play, trips: bets.trips ?? 0,
    pairs: bets.pairs ?? 0, badBeat: bets.badBeat ?? 0, pairsVariant: bets.pairsVariant, badBeatVariant: bets.badBeatVariant,
    playerHole: hole, dealerHole: dealer,
    folded: !!bets.folded,
    playerScore: evaluate([...hole, ...board]),
    dealerScore: evaluate([...dealer, ...board]),
  });
}

function assertCents(...xs: number[]) {
  for (const x of xs) if (!Number.isSafeInteger(x) || x < 0) throw new Error(`Invalid cents amount ${x}`);
}

// ---------------------------------------------------------------------------------------------
// Wager validation (used by the server; the client uses it only to grey out illegal buttons)
// ---------------------------------------------------------------------------------------------

export interface TableLimits {
  minAnte: number; maxAnte: number; maxTrips: number; maxPairs: number; maxBadBeat: number;
  badBeatVariant?: BadBeatVariant['id']; pairsVariant?: PairsVariant['id'];
  progressiveEnabled?: boolean;
}

export interface InitialBets { ante: number; trips: number; pairs: number; badBeat: number; progressive: number }
export const NO_BETS: InitialBets = { ante: 0, trips: 0, pairs: 0, badBeat: 0, progressive: 0 };
export const sideTotal = (b: { trips: number; pairs?: number; badBeat?: number; progressive?: number }) =>
  b.trips + (b.pairs ?? 0) + (b.badBeat ?? 0) + (b.progressive ?? 0);

/** Amount that must be available to start a hand: Ante + Blind + every side bet + a reserved 1x Play. */
export function requiredToStart(ante: number, sideBets = 0): number {
  return ante * 3 + sideBets;
}

export function validateInitialBet(input: Omit<InitialBets, 'progressive'> & { progressive?: number }, balance: number, limits: TableLimits): string | null {
  const b: InitialBets = { ...input, progressive: input.progressive ?? 0 };
  const vals = [b.ante, b.trips, b.pairs, b.badBeat, b.progressive];
  if (!vals.every((x) => typeof x === 'number' && Number.isSafeInteger(x))) return 'Bets must be whole amounts.';
  if (vals.some((x) => x < 0)) return 'Bets cannot be negative.';
  if (vals.some((x) => x % 100 !== 0)) return 'Bets must be in whole dollars.';
  if (b.ante < limits.minAnte) return `Minimum Ante is $${limits.minAnte / 100}.`;
  if (b.ante > limits.maxAnte) return `Maximum Ante is $${limits.maxAnte / 100}.`;
  if (b.trips > limits.maxTrips) return `Maximum Trips+ is $${limits.maxTrips / 100}.`;
  if (b.pairs > limits.maxPairs) return `Maximum Ultimate Pairs bet is $${limits.maxPairs / 100}.`;
  if (b.badBeat > limits.maxBadBeat) return `Maximum Bad Beat bet is $${limits.maxBadBeat / 100}.`;
  if (b.progressive !== 0 && b.progressive !== PROGRESSIVE.wager) return `The progressive is a fixed $${PROGRESSIVE.wager / 100} bet.`;
  if (b.progressive && limits.progressiveEnabled === false) return 'The progressive is turned off at this table.';
  const bbRequires = BAD_BEAT_VARIANTS[limits.badBeatVariant ?? DEFAULT_BAD_BEAT_VARIANT].requires;
  if (b.badBeat > 0 && bbRequires.includes('trips') && b.trips <= 0) return 'Bad Beat needs a Trips+ bet at this table.';
  const need = requiredToStart(b.ante, sideTotal(b));
  if (need > balance) return `You need $${need / 100} available (Ante + Blind + side bets + a 1x Play reserve).`;
  return null;
}

export type Decision = 'check' | 'fold' | 'play4' | 'play3' | 'play2' | 'play1';
export type DecisionPhase = 'preflop' | 'flop' | 'river';

export const LEGAL_DECISIONS: Record<DecisionPhase, Decision[]> = {
  preflop: ['play4', 'play3', 'check'],
  flop: ['play2', 'check'],
  river: ['play1', 'fold'],
};

export const PLAY_MULTIPLIER: Partial<Record<Decision, number>> = { play4: 4, play3: 3, play2: 2, play1: 1 };

/** Decision applied when the server-side timer expires. */
export const TIMEOUT_DEFAULT: Record<DecisionPhase, Decision> = { preflop: 'check', flop: 'check', river: 'fold' };

export function decisionLabel(d: Decision): string {
  return ({ check: 'Check', fold: 'Fold', play4: 'Play 4x', play3: 'Play 3x', play2: 'Play 2x', play1: 'Play 1x' })[d];
}

export function formatMoney(cents: number, opts: { sign?: boolean } = {}): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = '$' + dollars.toLocaleString('en-US') + (rem ? '.' + String(rem).padStart(2, '0') : '');
  if (neg) return '−' + body;
  return (opts.sign && cents > 0 ? '+' : '') + body;
}
