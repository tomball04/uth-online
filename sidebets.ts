// Ultimate Pairs and Bad Beat side bets. Every pay table is a complete, centrally defined variant
// with its source. A table selects one variant per side bet; variants are never mixed.
//
// Sources
//  * Ultimate Pairs pay tables: Maryland Lottery and Gaming Control Agency, "Ultimate Texas Hold'Em
//    Poker Standard Rules", Version 1.5, Chapter 12 (Ultimate Pairs paytables), Paytables B and D.
//    https://www.mdgaming.com/wp-content/uploads/2026/04/Ultimate-Texas-HoldEm-Poker-Standard-Rules-Version-1.5-accessible.pdf
//  * Bad Beat pay tables: California Office of the Attorney General, Bureau of Gambling Control,
//    "Ultimate Texas Hold'em Bad Beat Bonus — options sheet", Options 1 and 2 (also MLGCA v1.5
//    Bad Beat Paytables A and B).
//    https://www.oag.ca.gov/sites/all/files/agweb/pdfs/gambling/bcg-ult-texas-bad-beat-bonus-options-sheet.pdf
//  The sources do not specify companion-wager or fold handling. Those follow this project's scope
//  addendum §22: Bad Beat requires Ante, Blind and Trips+; both side bets stay live after a fold.

import { rankOf, suitOf } from './cards.js';
import { categoryOf, Cat, handName, type HandName } from './evaluator.js';

export interface Source { title: string; url: string; section: string }

export interface PairsVariant {
  id: 'up-bonus4' | 'up-bonus2';
  name: string;
  short: string;
  /** Rows in display order. `payout` is X to 1. `needsDealer` rows depend on the dealer's hole cards. */
  rows: { combo: PairsCombo; label: string; payout: number; needsDealer?: boolean }[];
  requires: ('ante' | 'blind' | 'trips')[];
  foldHandling: 'stays-live';
  maxPayoutMultiple: number | null;
  source: Source;
}

export type PairsCombo =
  | 'aa-both' | 'ahad' | 'aa' | 'ak-suited' | 'aqj-suited' | 'akqj-suited'
  | 'ak-offsuit' | 'aqj-offsuit' | 'akqj-offsuit' | 'pair-jqk' | 'pair-2-10' | 'pair-2-k';

export interface BadBeatVariant {
  id: 'bb-01' | 'bb-02';
  name: string;
  short: string;
  /** Pays on the category of the LOSING hand. X to 1. */
  rows: { losing: HandName; payout: number }[];
  requires: ('ante' | 'blind' | 'trips')[];
  foldHandling: 'stays-live';
  maxPayoutMultiple: number | null;
  source: Source;
}

const MD: Source = {
  title: 'MLGCA Ultimate Texas Hold’Em Poker Standard Rules v1.5',
  url: 'https://www.mdgaming.com/wp-content/uploads/2026/04/Ultimate-Texas-HoldEm-Poker-Standard-Rules-Version-1.5-accessible.pdf',
  section: 'Chapter 12, Ultimate Pairs paytables',
};
const CA: Source = {
  title: 'California BGC Ultimate Texas Hold’em Bad Beat Bonus options sheet',
  url: 'https://www.oag.ca.gov/sites/all/files/agweb/pdfs/gambling/bcg-ult-texas-bad-beat-bonus-options-sheet.pdf',
  section: 'Bad Beat Paytable',
};

export const PAIRS_VARIANTS: Record<PairsVariant['id'], PairsVariant> = {
  'up-bonus4': {
    id: 'up-bonus4', name: 'Ultimate Pairs Bonus 4', short: 'Bonus 4',
    rows: [
      { combo: 'ahad', label: 'A♥ A♦', payout: 100 },
      { combo: 'aa', label: 'Any other pair of aces', payout: 30 },
      { combo: 'akqj-suited', label: 'Ace + K, Q or J, suited', payout: 20 },
      { combo: 'akqj-offsuit', label: 'Ace + K, Q or J, unsuited', payout: 10 },
      { combo: 'pair-2-k', label: 'Pair of 2s through Kings', payout: 4 },
    ],
    requires: ['ante', 'blind'], foldHandling: 'stays-live', maxPayoutMultiple: null,
    source: { ...MD, section: 'Chapter 12, Ultimate Pairs Paytable D' },
  },
  'up-bonus2': {
    id: 'up-bonus2', name: 'Ultimate Pairs Bonus 2', short: 'Bonus 2',
    rows: [
      { combo: 'aa-both', label: 'Player and dealer both hold aces', payout: 1000, needsDealer: true },
      { combo: 'aa', label: 'Pair of aces', payout: 30 },
      { combo: 'ak-suited', label: 'A-K suited', payout: 25 },
      { combo: 'aqj-suited', label: 'A-Q or A-J suited', payout: 20 },
      { combo: 'ak-offsuit', label: 'A-K unsuited', payout: 15 },
      { combo: 'pair-jqk', label: 'Pair of Jacks, Queens or Kings', payout: 10 },
      { combo: 'aqj-offsuit', label: 'A-Q or A-J unsuited', payout: 5 },
      { combo: 'pair-2-10', label: 'Pair of 2s through 10s', payout: 3 },
    ],
    requires: ['ante', 'blind'], foldHandling: 'stays-live', maxPayoutMultiple: null,
    source: { ...MD, section: 'Chapter 12, Ultimate Pairs Paytable B' },
  },
};

export const BAD_BEAT_VARIANTS: Record<BadBeatVariant['id'], BadBeatVariant> = {
  'bb-01': {
    id: 'bb-01', name: 'Bad Beat Bonus 01', short: 'Bonus 01',
    rows: [
      { losing: 'Straight Flush', payout: 10000 },
      { losing: 'Four of a Kind', payout: 500 },
      { losing: 'Full House', payout: 40 },
      { losing: 'Flush', payout: 25 },
      { losing: 'Straight', payout: 20 },
      { losing: 'Three of a Kind', payout: 9 },
    ],
    requires: ['ante', 'blind', 'trips'], foldHandling: 'stays-live', maxPayoutMultiple: null,
    source: { ...CA, section: 'Bad Beat Option 1 (MLGCA Paytable A)' },
  },
  'bb-02': {
    id: 'bb-02', name: 'Bad Beat Bonus 02', short: 'Bonus 02',
    rows: [
      { losing: 'Straight Flush', payout: 7500 },
      { losing: 'Four of a Kind', payout: 500 },
      { losing: 'Full House', payout: 50 },
      { losing: 'Flush', payout: 30 },
      { losing: 'Straight', payout: 20 },
      { losing: 'Three of a Kind', payout: 9 },
    ],
    requires: ['ante', 'blind', 'trips'], foldHandling: 'stays-live', maxPayoutMultiple: null,
    source: { ...CA, section: 'Bad Beat Option 2 (MLGCA Paytable B)' },
  },
};

export const DEFAULT_PAIRS_VARIANT: PairsVariant['id'] = 'up-bonus4';
export const DEFAULT_BAD_BEAT_VARIANT: BadBeatVariant['id'] = 'bb-01';
export const isPairsVariant = (x: unknown): x is PairsVariant['id'] => typeof x === 'string' && x in PAIRS_VARIANTS;
export const isBadBeatVariant = (x: unknown): x is BadBeatVariant['id'] => typeof x === 'string' && x in BAD_BEAT_VARIANTS;

// ------------------------------------------------------------------ Ultimate Pairs evaluation
const ACE = 12, KING = 11, QUEEN = 10, JACK = 9;
const HEARTS = 1, DIAMONDS = 2; // see SUIT_CHARS 'shdc'

/** Which combos the two hole cards make, independent of variant. */
function holeFacts(hole: number[]) {
  const [a, b] = hole;
  const ra = rankOf(a), rb = rankOf(b);
  const pair = ra === rb;
  const suited = suitOf(a) === suitOf(b);
  const hasAce = ra === ACE || rb === ACE;
  const other = ra === ACE ? rb : ra;
  const aces = pair && ra === ACE;
  const ahad = aces && new Set([suitOf(a), suitOf(b)]).size === 2 && [suitOf(a), suitOf(b)].includes(HEARTS) && [suitOf(a), suitOf(b)].includes(DIAMONDS);
  return { pair, rank: ra, suited, hasAce, other, aces, ahad };
}

function comboMatches(combo: PairsCombo, f: ReturnType<typeof holeFacts>, dealerAces: boolean | null): boolean {
  const aceFace = f.hasAce && !f.pair && [KING, QUEEN, JACK].includes(f.other);
  switch (combo) {
    case 'aa-both': return f.aces && dealerAces === true;
    case 'ahad': return f.ahad;
    case 'aa': return f.aces;
    case 'ak-suited': return aceFace && f.other === KING && f.suited;
    case 'aqj-suited': return aceFace && f.other !== KING && f.suited;
    case 'akqj-suited': return aceFace && f.suited;
    case 'ak-offsuit': return aceFace && f.other === KING && !f.suited;
    case 'aqj-offsuit': return aceFace && f.other !== KING && !f.suited;
    case 'akqj-offsuit': return aceFace && !f.suited;
    case 'pair-jqk': return f.pair && f.rank >= JACK && f.rank <= KING;
    case 'pair-2-10': return f.pair && f.rank <= 8;
    case 'pair-2-k': return f.pair && f.rank <= KING;
  }
}

export interface PairsResult { won: boolean; label: string | null; payout: number; combo: PairsCombo | null }

/**
 * Highest applicable row only. `dealerHole` is required to settle; pass null to preview
 * (rows that depend on the dealer are skipped and never confirmed early).
 */
export function evaluatePairs(variant: PairsVariant, hole: number[], dealerHole: number[] | null): PairsResult {
  const f = holeFacts(hole);
  const dealerAces = dealerHole ? rankOf(dealerHole[0]) === ACE && rankOf(dealerHole[1]) === ACE : null;
  for (const row of variant.rows) {
    if (row.needsDealer && dealerHole === null) continue;
    if (comboMatches(row.combo, f, dealerAces)) return { won: true, label: row.label, payout: row.payout, combo: row.combo };
  }
  return { won: false, label: null, payout: 0, combo: null };
}

/** For the in-hand indicator: what the player has locked in, and what could still improve at showdown. */
export function previewPairs(variant: PairsVariant, hole: number[]) {
  const now = evaluatePairs(variant, hole, null);
  const f = holeFacts(hole);
  const dealerRow = variant.rows.find((r) => r.needsDealer && r.combo === 'aa-both');
  const pending = dealerRow && f.aces ? dealerRow : null;
  return { ...now, pendingUpgrade: pending ? { label: pending.label, payout: pending.payout } : null };
}

// ------------------------------------------------------------------ Bad Beat evaluation
export interface BadBeatResult {
  won: boolean; payout: number; losingHand: HandName | null; loser: 'player' | 'dealer' | null;
  reason: string;
}

/** Compare the full 7-card hands, kickers included. Ties lose. Pays on the losing hand's category. */
export function evaluateBadBeat(variant: BadBeatVariant, playerScore: number, dealerScore: number): BadBeatResult {
  if (playerScore === dealerScore) return { won: false, payout: 0, losingHand: null, loser: null, reason: 'Tied hands' };
  const loser = playerScore < dealerScore ? 'player' : 'dealer';
  const losingScore = Math.min(playerScore, dealerScore);
  if (categoryOf(losingScore) < Cat.Trips) {
    return { won: false, payout: 0, losingHand: handName(losingScore), loser, reason: `Losing hand ${handName(losingScore)} is below Three of a Kind` };
  }
  const name = handName(losingScore);
  const row = variant.rows.find((r) => r.losing === name);
  if (!row) return { won: false, payout: 0, losingHand: name, loser, reason: `${name} is not on the pay table` };
  return { won: true, payout: row.payout, losingHand: name, loser, reason: `${loser === 'player' ? 'Your' : 'Dealer’s'} ${name} was beaten` };
}
