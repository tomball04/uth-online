// Ultimate Texas Hold'em rules and settlement. Pure functions, shared by server (authoritative),
// the river solver, and the client (for training explanations only — never for balances).
//
// MONEY: every amount is an integer number of CENTS. Antes are whole dollars (multiples of 100),
// so the 3:2 Blind payout on a Flush is always an exact integer of cents.
//
// Corrections vs. the original prototype:
//  1. Dealer non-qualification only pushes the ANTE. Play and Blind are still settled by comparing
//     hands (the prototype paid Play automatically and pushed Blind when the dealer didn't qualify,
//     even if the dealer's unqualified hand beat the player).
//  2. Trips+ is resolved on folded hands and the winnings are actually credited (the prototype
//     added the win to "net" but never returned stake + win to the bankroll on folds).
//  3. Affordability reserves the mandatory 1x Play on top of Ante + Blind + Trips.

import { Cat, categoryOf, evaluate, handName, type HandName } from './evaluator.js';

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
}

export interface SettleInput {
  ante: number;
  blind: number;
  play: number;       // 0 if folded
  trips: number;      // 0 if no side bet
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
  totalStake: number;
  totalCredit: number;
  net: number;
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
  return mult ? win(trips, trips * mult, `${name} pays ${mult}:1`) : lose(trips, name);
}

export function settle(i: SettleInput): Settlement {
  assertCents(i.ante, i.blind, i.play, i.trips);
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
        const profit = (i.blind * pay[0]) / pay[1];
        if (!Number.isInteger(profit)) throw new Error('Blind payout produced fractional cents');
        blind = win(i.blind, profit, `${playerHand} pays ${pay[0]}:${pay[1]}`);
      } else blind = push(i.blind, 'Win below a straight');
    } else if (cmp < 0) blind = lose(i.blind);
    else blind = push(i.blind, 'Tie');
  }

  const parts = [ante, blind, play, trips];
  const totalStake = parts.reduce((s, p) => s + p.stake, 0);
  const totalCredit = parts.reduce((s, p) => s + p.credit, 0);
  return {
    outcome, dealerQualifies: qualifies, playerHand, dealerHand,
    ante, blind, play, trips, totalStake, totalCredit, net: totalCredit - totalStake,
  };
}

/** Convenience used by tests and the solver. */
export function settleCards(
  hole: number[], dealer: number[], board: number[],
  bets: { ante: number; play: number; trips?: number; folded?: boolean },
): Settlement {
  return settle({
    ante: bets.ante, blind: bets.ante, play: bets.play, trips: bets.trips ?? 0,
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

export interface TableLimits { minAnte: number; maxAnte: number; maxTrips: number }

/** Amount that must be available to start a hand: Ante + Blind + Trips + reserved 1x Play. */
export function requiredToStart(ante: number, trips: number): number {
  return ante * 3 + trips;
}

export function validateInitialBet(
  ante: number, trips: number, balance: number, limits: TableLimits,
): string | null {
  if (!Number.isSafeInteger(ante) || !Number.isSafeInteger(trips)) return 'Bets must be whole amounts.';
  if (ante % 100 !== 0 || trips % 100 !== 0) return 'Bets must be in whole dollars.';
  if (ante < limits.minAnte) return `Minimum Ante is $${limits.minAnte / 100}.`;
  if (ante > limits.maxAnte) return `Maximum Ante is $${limits.maxAnte / 100}.`;
  if (trips < 0) return 'Invalid Trips+ amount.';
  if (trips > limits.maxTrips) return `Maximum Trips+ is $${limits.maxTrips / 100}.`;
  if (requiredToStart(ante, trips) > balance)
    return `You need $${requiredToStart(ante, trips) / 100} available (Ante + Blind + Trips + a 1x Play reserve).`;
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
