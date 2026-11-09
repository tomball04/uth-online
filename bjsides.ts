// §34 Blackjack side-bet catalog. Every wager is data: its own rule text, documented pay table(s), source,
// settlement phase and an evaluator that reads only the cards that rule names. The Blackjack engine never
// branches on a particular side bet — adding a documented wager means adding one catalog entry here.
//
// Conventions (§38.4): every table below is "X to 1" (the stake comes back with the win) unless the entry
// says "for 1". A wager pays its single highest qualifying row.
//
// Rules profile: the six All Bets Blackjack wagers come from Nevada's eight-deck "All Bets Blackjack" rule set.
// This casino deals SIX decks (stands on all 17s, peeks with an Ace or ten up). Running those six wagers on the
// six-deck shoe is a separate, ADAPTED profile ("All Bets — six-deck adaptation"); it is not the approved
// eight-deck game, and the published house edges do not apply to it.

import type { CardStr } from './cards.js';
import { cardToInt } from './cards.js';
import { evaluate3, tcpCategory, TCP_CAT } from './tcp.js';
import { total as bjTotal, isNatural } from './blackjack.js';

export type BjSidePhase = 'initial' | 'dealer-hole' | 'final-draw';
export interface BjSideRow { combo: string; label: string; pays: number }
export interface BjSideVariant { id: string; name: string; rows: BjSideRow[]; source: string }
export interface BjSideSource { title: string; url: string }
export interface BjSideContext {
  player: CardStr[];          // the player's first two cards (before any split)
  dealer: CardStr[];          // the dealer's cards as known when evaluated (index 0 = up-card)
  dealerFinal: boolean;       // the dealer's hand is complete (or the round ended early)
  playerNatural: boolean;
}
export interface BjSideDef {
  id: string; name: string; short: string;
  status: 'playable' | 'unavailable';
  /** Why a catalog entry is not playable (shown in the menu and the payout audit). */
  unavailable?: string;
  phase: BjSidePhase;
  rule: string;
  variants: BjSideVariant[];
  sources: BjSideSource[];
  notes: string[];
  /** Highest qualifying row's combo id, or null for a loss. */
  evaluate?: (v: BjSideVariant, c: BjSideContext) => string | null;
}

const NV_ALLBETS: BjSideSource = { title: 'Nevada Gaming Control Board — All Bets Blackjack (live), rules of play', url: 'https://www.gaming.nv.gov/siteassets/content/divisions/enforcement/rules-of-play/All_Bets_Blackjack_Live_Rules_of_Play.pdf' };
const PA_633C: BjSideSource = { title: 'Pennsylvania Code 58 Pa. Code ch. 633c — Blackjack side wagers (§633c.1 Perfect Pairs, §633c.7 Top 3, §633c.13 Buster Blackjack)', url: 'https://pacodeandbulletin.gov/secure/pacode/data/058/chapter633c/058_0633c.pdf' };
const NV_LL: BjSideSource = { title: 'Nevada Gaming Control Board — Lucky Ladies Version 7, Appendix A (felt paytables)', url: 'https://www.gaming.nv.gov/contentassets/3a632692f87340bf9890a9784fd3f1aa/lucky-ladies---version-7.pdf' };
const LVA_MTD: BjSideSource = { title: 'Las Vegas Advisor — Understanding the Match the Dealer blackjack side bet (six-deck table)', url: 'https://www.lasvegasadvisor.com/blog/understanding-the-match-the-dealer-blackjack-side-bet/' };
const ADAPTED = 'Six-deck adaptation of Nevada’s eight-deck All Bets Blackjack wager: the pay table is the published one, the shoe is not.';

const rank = (c: CardStr) => c[0];
const suit = (c: CardStr) => c[1];
const RED = new Set(['h', 'd']);
const color = (c: CardStr) => (RED.has(suit(c)) ? 'red' : 'black');
const bjVal = (c: CardStr) => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
const first = (rows: BjSideRow[], ok: (combo: string) => boolean) => rows.find((r) => ok(r.combo))?.combo ?? null;
const three = (c: BjSideContext): CardStr[] | null => (c.player.length >= 2 && c.dealer.length >= 1 ? [c.player[0], c.player[1], c.dealer[0]] : null);

/** Pair category of two cards: perfect (same rank and suit — identical cards from different decks), coloured, mixed. */
export function pairKind(a: CardStr, b: CardStr): 'perfect' | 'colored' | 'mixed' | null {
  if (rank(a) !== rank(b)) return null;
  if (suit(a) === suit(b)) return 'perfect';
  return color(a) === color(b) ? 'colored' : 'mixed';
}
/** Three-card poker category for 21+3 / Top 3, including "suited three of a kind" (three identical cards, multi-deck only). */
export function threeKind(cards: CardStr[]): 'suited-trips' | 'straight-flush' | 'trips' | 'straight' | 'flush' | null {
  const ints = cards.map(cardToInt);
  if (cards.every((x) => x === cards[0])) return 'suited-trips';
  const cat = tcpCategory(evaluate3(ints));
  return cat === TCP_CAT.StraightFlush ? 'straight-flush' : cat === TCP_CAT.Trips ? 'trips' : cat === TCP_CAT.Straight ? 'straight' : cat === TCP_CAT.Flush ? 'flush' : null;
}

const PAIRS_ROWS = (p: number, c: number, m: number): BjSideRow[] => [
  { combo: 'perfect', label: 'Perfect pair (same rank and suit)', pays: p },
  { combo: 'colored', label: 'Coloured pair (same rank and colour)', pays: c },
  { combo: 'mixed', label: 'Mixed pair (same rank, red/black)', pays: m },
];
const pairsEval = (who: 'player' | 'dealer') => (v: BjSideVariant, c: BjSideContext) => {
  const cards = who === 'player' ? c.player : c.dealer;
  if (cards.length < 2) return null;
  const k = pairKind(cards[0], cards[1]);
  return k ? first(v.rows, (x) => x === k) : null;
};

export const BJ_SIDES: BjSideDef[] = [
  {
    id: 'perfect-player', name: 'Perfect Player Pairs', short: 'Player Pairs', status: 'playable', phase: 'initial',
    rule: 'Your first two cards are a pair. Perfect = same rank and suit (two identical cards from different decks); coloured = same rank and colour; mixed = same rank, one red and one black.',
    variants: [
      { id: 'allbets', name: 'All Bets 25 / 12 / 6', rows: PAIRS_ROWS(25, 12, 6), source: 'NV All Bets Blackjack; PA §633c.1 Paytable A' },
      { id: 'pa-b', name: 'Paytable B 30 / 10 / 5', rows: PAIRS_ROWS(30, 10, 5), source: 'PA §633c.1 Paytable B' },
    ],
    sources: [NV_ALLBETS, PA_633C], notes: [ADAPTED, 'Pair definitions from PA §633c.1 (the Nevada All Bets text names the categories without defining them).'],
    evaluate: pairsEval('player'),
  },
  {
    id: 'perfect-dealer', name: 'Perfect Dealer Pairs', short: 'Dealer Pairs', status: 'playable', phase: 'dealer-hole',
    rule: 'The dealer’s first two cards are a pair, by the same categories as Player Pairs. Settled only once the hole card is legitimately shown.',
    variants: [{ id: 'allbets', name: 'All Bets 25 / 12 / 6', rows: PAIRS_ROWS(25, 12, 6), source: 'NV All Bets Blackjack' }],
    sources: [NV_ALLBETS], notes: [ADAPTED, 'The dealer’s hole card is never revealed early for this wager: its result appears with the hole card.'],
    evaluate: pairsEval('dealer'),
  },
  {
    id: 'twentyone3', name: '21+3', short: '21+3', status: 'playable', phase: 'initial',
    rule: 'Your first two cards plus the dealer’s up-card, read as a three-card poker hand (Ace high or low: A-2-3 and Q-K-A are straights).',
    variants: [{ id: 'allbets', name: 'All Bets 100 / 40 / 30 / 10 / 5', source: 'NV All Bets Blackjack', rows: [
      { combo: 'suited-trips', label: 'Suited Three of a Kind', pays: 100 }, { combo: 'straight-flush', label: 'Straight Flush', pays: 40 },
      { combo: 'trips', label: 'Three of a Kind', pays: 30 }, { combo: 'straight', label: 'Straight', pays: 10 }, { combo: 'flush', label: 'Flush', pays: 5 }] }],
    sources: [NV_ALLBETS], notes: [ADAPTED],
    evaluate: (v, c) => { const t = three(c); const k = t && threeKind(t); return k ? first(v.rows, (x) => x === k) : null; },
  },
  {
    id: 'top3', name: 'Top 3', short: 'Top 3', status: 'playable', phase: 'initial',
    rule: 'The same three cards as 21+3, a separate wager: suited three of a kind, straight flush or three of a kind. You can win both 21+3 and Top 3 on one hand.',
    variants: [
      { id: 'allbets', name: 'All Bets 270 / 180 / 90', source: 'NV All Bets Blackjack; PA §633c.7', rows: [
        { combo: 'suited-trips', label: 'Suited Three of a Kind', pays: 270 }, { combo: 'straight-flush', label: 'Straight Flush', pays: 180 }, { combo: 'trips', label: 'Three of a Kind', pays: 90 }] },
      { id: 'pa-b', name: 'Paytable B 1000 / 100 / 70', source: 'PA §633c.7 second paytable', rows: [
        { combo: 'suited-trips', label: 'Suited Three of a Kind', pays: 1000 }, { combo: 'straight-flush', label: 'Straight Flush', pays: 100 }, { combo: 'trips', label: 'Three of a Kind', pays: 70 }] },
    ],
    sources: [NV_ALLBETS, PA_633C], notes: [ADAPTED],
    evaluate: (v, c) => { const t = three(c); const k = t && threeKind(t); return k ? first(v.rows, (x) => x === k) : null; },
  },
  {
    id: 'buster', name: 'Buster Blackjack', short: 'Buster', status: 'playable', phase: 'final-draw',
    rule: 'Wins when the dealer busts; pays by the number of cards in the dealer’s busted hand, more if you were dealt a blackjack. '
      + 'The dealer draws only as the Blackjack rules require: if every hand at the table has already busted, surrendered or got a blackjack, the dealer does not draw, the dealer’s hand cannot bust, and Buster loses. No card is ever dealt just to settle this wager. A dealer blackjack also means no bust.',
    variants: [{ id: 'allbets', name: 'All Bets 2000 / 800 / 250 / 50 / 18 / 4 / 2', source: 'NV All Bets Blackjack', rows: [
      { combo: '8+bj', label: '8+ card bust, you have Blackjack', pays: 2000 }, { combo: '7bj', label: '7-card bust, you have Blackjack', pays: 800 },
      { combo: '8+', label: '8+ card bust', pays: 250 }, { combo: '7', label: '7-card bust', pays: 50 }, { combo: '6', label: '6-card bust', pays: 18 },
      { combo: '5', label: '5-card bust', pays: 4 }, { combo: '3-4', label: '3- or 4-card bust', pays: 2 }] }],
    sources: [NV_ALLBETS, PA_633C],
    notes: [ADAPTED, 'Continuation: Nevada’s All Bets text says the dealer does not draw when every player has busted, and says nothing more for Buster. This casino therefore never draws extra cards for it (PA §633c.13(g): if the dealer’s hand does not bust, the wager loses).'],
    evaluate: (v, c) => {
      if (!c.dealerFinal) return null;
      const t = bjTotal(c.dealer);
      if (!t.bust) return null;
      const n = c.dealer.length;
      const k = n >= 8 ? (c.playerNatural ? '8+bj' : '8+') : n === 7 ? (c.playerNatural ? '7bj' : '7') : n === 6 ? '6' : n === 5 ? '5' : '3-4';
      return first(v.rows, (x) => x === k);
    },
  },
  {
    id: 'lucky-lucky', name: 'Lucky Lucky', short: 'Lucky Lucky', status: 'playable', phase: 'initial',
    rule: 'Your first two cards plus the dealer’s up-card: suited or unsuited 7-7-7 and 6-7-8, or a three-card total of 21, 20 or 19. An Ace counts 11 unless that takes the three cards over 21, then 1 (the Blackjack count). This is a total-based bet, not a poker hand.',
    variants: [{ id: 'allbets', name: 'All Bets 200 / 100 / 50 / 25 / 15 / 3 / 2 / 2', source: 'NV All Bets Blackjack', rows: [
      { combo: 'suited-777', label: 'Suited 7-7-7', pays: 200 }, { combo: 'suited-678', label: 'Suited 6-7-8', pays: 100 },
      { combo: '777', label: '7-7-7', pays: 50 }, { combo: '678', label: '6-7-8', pays: 25 },
      { combo: 'suited-21', label: 'Suited total of 21', pays: 15 }, { combo: '21', label: 'Total of 21', pays: 3 },
      { combo: '20', label: 'Total of 20', pays: 2 }, { combo: '19', label: 'Total of 19', pays: 2 }] }],
    sources: [NV_ALLBETS],
    notes: [ADAPTED, 'Ace value: Nevada’s text does not define it; this casino uses the ordinary Blackjack count (11, or 1 if 11 would exceed 21).'],
    evaluate: (v, c) => {
      const t = three(c); if (!t) return null;
      const suited = t.every((x) => suit(x) === suit(t[0]));
      const ranks = t.map(rank).sort().join('');
      const tot = bjTotal(t).total;
      const k = ranks === '777' ? (suited ? 'suited-777' : '777') : ranks === '678' ? (suited ? 'suited-678' : '678')
        : tot === 21 ? (suited ? 'suited-21' : '21') : tot === 20 ? '20' : tot === 19 ? '19' : null;
      return k ? first(v.rows, (x) => x === k) : null;
    },
  },
  {
    id: 'lucky-ladies', name: 'Lucky Ladies', short: 'Lucky Ladies', status: 'playable', phase: 'dealer-hole',
    rule: 'Your first two cards total 20. Queen of Hearts pair pays more, and most of all with a dealer blackjack; matched 20 = two identical cards; suited 20 = same suit. Settled once the dealer’s hole card is shown, because the top award depends on it.',
    variants: [
      { id: 'pt-fltll-01', name: 'PT-FLTLL-01 (1000 / 200 / 20 / 20 / 4)', source: 'NV Lucky Ladies V7 Appendix A', rows: [
        { combo: 'qh-pair-dbj', label: 'Q♥ pair with dealer Blackjack', pays: 1000 }, { combo: 'qh-pair', label: 'Q♥ pair', pays: 200 },
        { combo: 'matched-20', label: 'Matched 20', pays: 20 }, { combo: 'suited-20', label: 'Suited 20', pays: 20 }, { combo: 'any-20', label: 'Any 20', pays: 4 }] },
      { id: 'pt-fltll-02', name: 'PT-FLTLL-02 (1000 / 150 / 25 / 10 / 4)', source: 'NV Lucky Ladies V7 Appendix A', rows: [
        { combo: 'qh-pair-dbj', label: 'Q♥ pair with dealer Blackjack', pays: 1000 }, { combo: 'qh-pair', label: 'Q♥ pair', pays: 150 },
        { combo: 'matched-20', label: 'Matched 20', pays: 25 }, { combo: 'suited-20', label: 'Suited 20', pays: 10 }, { combo: 'any-20', label: 'Any 20', pays: 4 }] },
      { id: 'pt-fltll-03', name: 'PT-FLTLL-03 (1000 / 125 / 20 / 9 / 4)', source: 'NV Lucky Ladies V7 Appendix A', rows: [
        { combo: 'qh-pair-dbj', label: 'Q♥ pair with dealer Blackjack', pays: 1000 }, { combo: 'qh-pair', label: 'Q♥ pair', pays: 125 },
        { combo: 'matched-20', label: 'Matched 20', pays: 20 }, { combo: 'suited-20', label: 'Suited 20', pays: 9 }, { combo: 'any-20', label: 'Any 20', pays: 4 }] },
    ],
    sources: [NV_LL],
    notes: ['Felt tables PT-FLTLL-01 to -03 only. PT-FLTLL-04 is NOT offered: the source’s text layer prints extra values in its Matched 20 and Suited 20 rows, so its columns cannot be read reliably.',
      'Progressive Lucky Ladies tables (Appendix B–D) are not offered.'],
    evaluate: (v, c) => {
      if (c.player.length < 2) return null;
      const [a, b] = c.player;
      if (bjTotal([a, b]).total !== 20) return null;
      const dbj = c.dealer.length >= 2 && isNatural(c.dealer.slice(0, 2), false);
      const k = a === 'Qh' && b === 'Qh' ? (dbj ? 'qh-pair-dbj' : 'qh-pair') : a === b ? 'matched-20' : suit(a) === suit(b) ? 'suited-20' : 'any-20';
      return first(v.rows, (x) => x === k);
    },
  },
  {
    id: 'match-dealer', name: 'Match the Dealer', short: 'Match', status: 'playable', phase: 'initial',
    rule: 'Each of your first two cards is compared with the dealer’s up-card by rank (a suited match also has the same suit). The combined result pays once.',
    variants: [{ id: 'lva-6deck', name: 'Six decks 22 / 15 / 11 / 8 / 4', source: 'Las Vegas Advisor six-deck table', rows: [
      { combo: '2-suited', label: 'Two suited matches', pays: 22 }, { combo: '1-suited-1', label: 'One suited and one unsuited match', pays: 15 },
      { combo: '1-suited', label: 'One suited match', pays: 11 }, { combo: '2-unsuited', label: 'Two unsuited matches', pays: 8 }, { combo: '1-unsuited', label: 'One unsuited match', pays: 4 }] }],
    sources: [LVA_MTD],
    notes: ['Secondary source: the Las Vegas Advisor gives this as the typical SIX-deck table. Tables for other deck counts were not verified, so only the six-deck table is offered (this shoe is six decks).'],
    evaluate: (v, c) => {
      const t = three(c); if (!t) return null;
      const up = t[2];
      let s = 0, u = 0;
      for (const x of t.slice(0, 2)) if (rank(x) === rank(up)) { if (suit(x) === suit(up)) s++; else u++; }
      const k = s === 2 ? '2-suited' : s === 1 && u === 1 ? '1-suited-1' : s === 1 ? '1-suited' : u === 2 ? '2-unsuited' : u === 1 ? '1-unsuited' : null;
      return k ? first(v.rows, (x) => x === k) : null;
    },
  },
  // ---------------------------------------------------------------- catalog entries not playable (§34.4, §38.2)
  ...([
    ['royal-match', 'Royal Match', 'initial', 'The scope’s six-deck table (suited K-Q 25:1, other suited 5:2) could not be confirmed against a readable regulator or casino document from this environment.'],
    ['super-sevens', 'Super Sevens', 'final-draw', 'Only the top award ($5,000 for three suited sevens on $1) was confirmed; the full table, the split rule and the third-card rule were not.'],
    ['blazing-7s', 'Blazing 7’s', 'final-draw', 'Nevada’s Blazing 7’s Progressive V6/V7 PDFs have no text layer; the PA §633c.9 text available here was incomplete. No table is offered rather than a guessed one.'],
    ['hot-3', 'Hot 3', 'initial', 'No regulator or casino document with the Hot 3 table could be found and read from this environment.'],
    ['super-4', 'Super 4', 'dealer-hole', 'Nevada’s Super 4 Progressive Blackjack V2/V3 PDFs have no text layer; the PA §633c.6 extract was partial (multi-meter “Star/Spade” progressives). Not offered.'],
    ['progressive-blackjack', 'Progressive Blackjack (Ace combinations)', 'initial', 'No complete, verified Ace-combination progressive table was available. (21+3 Progressive PT-PRG-213-16 is offered instead as the Blackjack progressive.)'],
  ] as const).map(([id, name, phase, why]): BjSideDef => ({
    id, name, short: name, status: 'unavailable', unavailable: why, phase, rule: '—', variants: [], sources: [], notes: [why],
  })),
];
export const BJ_SIDE: Record<string, BjSideDef> = Object.fromEntries(BJ_SIDES.map((d) => [d.id, d]));
export const PLAYABLE_BJ_SIDES = BJ_SIDES.filter((d) => d.status === 'playable');
/** The six Nevada All Bets wagers, in the order the preset enables them. */
export const ALL_BETS_SIX = ['perfect-player', 'perfect-dealer', 'twentyone3', 'top3', 'buster', 'lucky-lucky'] as const;

// ------------------------------------------------------------------ host configuration
export interface BjSideSetting { on: boolean; variant: string; min: number; max: number }
export interface BjSidesConfig {
  preset: 'classic' | 'allbets' | 'custom';
  bets: Record<string, BjSideSetting>;
}
const defaultSetting = (d: BjSideDef, on: boolean): BjSideSetting => ({ on, variant: d.variants[0]?.id ?? '', min: 100, max: 2_500 });
export function bjSidesPreset(preset: BjSidesConfig['preset'], base?: BjSidesConfig): BjSidesConfig {
  const bets: Record<string, BjSideSetting> = {};
  for (const d of PLAYABLE_BJ_SIDES) {
    const prev = base?.bets[d.id];
    const on = preset === 'allbets' ? (ALL_BETS_SIX as readonly string[]).includes(d.id) : preset === 'classic' ? false : !!prev?.on;
    // A preset always restores the published All Bets tables; custom keeps the host's own choices.
    bets[d.id] = preset === 'custom' && prev ? { ...prev } : { ...defaultSetting(d, on), min: prev?.min ?? 100, max: prev?.max ?? 2_500 };
  }
  return { preset, bets };
}
export const DEFAULT_BJ_SIDES: BjSidesConfig = bjSidesPreset('classic');

/** Server-side validation of a host's side-bet configuration. Unknown, unavailable or mis-sized entries are rejected, never coerced. */
export function parseBjSidesConfig(x: unknown, current: BjSidesConfig = DEFAULT_BJ_SIDES): BjSidesConfig | string {
  if (!x || typeof x !== 'object') return 'Invalid side-bet settings.';
  const o = x as { preset?: unknown; bets?: unknown };
  if (o.preset !== 'classic' && o.preset !== 'allbets' && o.preset !== 'custom') return 'Unknown side-bet preset.';
  if (o.preset !== 'custom') return bjSidesPreset(o.preset, current);
  const out = bjSidesPreset('custom', current);
  const bets = (o.bets && typeof o.bets === 'object' ? o.bets : {}) as Record<string, unknown>;
  for (const [id, raw] of Object.entries(bets)) {
    const d = BJ_SIDE[id];
    if (!d) return `Unknown side bet “${id}”.`;
    const r = raw as Partial<BjSideSetting>;
    if (d.status !== 'playable') { if (r?.on) return `${d.name} is not available: ${d.unavailable}`; continue; }
    const s = { ...out.bets[id] };
    if (r.on !== undefined) s.on = !!r.on;
    if (r.variant !== undefined) { if (!d.variants.some((v) => v.id === r.variant)) return `Unknown pay table for ${d.name}.`; s.variant = r.variant!; }
    for (const k of ['min', 'max'] as const) if (r[k] !== undefined) {
      const n = r[k]!;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 100 || n > 1_000_000 || n % 100) return `${d.name}: limits must be whole dollars from $1 to $10,000.`;
      s[k] = n;
    }
    if (s.max < s.min) return `${d.name}: the maximum must be at least the minimum.`;
    out.bets[id] = s;
  }
  return out;
}
export const enabledBjSides = (c: BjSidesConfig) => PLAYABLE_BJ_SIDES.filter((d) => c.bets[d.id]?.on);

/** Validate one player's side bets against the table's configuration. Returns an error or null. */
export function validateBjSides(sides: Record<string, number> | undefined, cfg: BjSidesConfig): string | null {
  for (const [id, amt] of Object.entries(sides ?? {})) {
    const d = BJ_SIDE[id];
    if (!d) return `Unknown side bet “${id}”.`;
    if (amt === 0) continue;
    if (typeof amt !== 'number' || !Number.isSafeInteger(amt) || amt < 0) return 'Side bets must be whole amounts.';
    if (amt % 100) return 'Side bets must be in whole dollars.';
    if (d.status !== 'playable') return `${d.name} is not offered: ${d.unavailable}`;
    const s = cfg.bets[id];
    if (!s?.on) return `${d.name} is not open at this table.`;
    if (amt < s.min) return `Minimum ${d.name} is $${s.min / 100}.`;
    if (amt > s.max) return `Maximum ${d.name} is $${s.max / 100}.`;
  }
  return null;
}
export const sumSides = (sides: Record<string, number> | undefined) => Object.values(sides ?? {}).reduce((t, x) => t + (x || 0), 0);

// ------------------------------------------------------------------ settlement
export interface BjSideResult {
  id: string; name: string; variant: string; stake: number; phase: BjSidePhase;
  result: 'win' | 'lose'; combo: string | null; label: string | null; pays: number;
  convention: 'to-1'; credit: number; net: number;
}
export function settleBjSide(id: string, variantId: string, stake: number, c: BjSideContext): BjSideResult {
  const d = BJ_SIDE[id];
  const v = d.variants.find((x) => x.id === variantId) ?? d.variants[0];
  const combo = d.evaluate!(v, c);
  const row = combo ? v.rows.find((r) => r.combo === combo) : undefined;
  if (!row) return { id, name: d.name, variant: v.id, stake, phase: d.phase, result: 'lose', combo: null, label: null, pays: 0, convention: 'to-1', credit: 0, net: -stake };
  const win = stake * row.pays;
  return { id, name: d.name, variant: v.id, stake, phase: d.phase, result: 'win', combo: row.combo, label: row.label, pays: row.pays, convention: 'to-1', credit: stake + win, net: win };
}
/** Can this wager be settled (and its result shown to everyone) with what is known right now? */
export function resolvableNow(phase: BjSidePhase, holeShown: boolean, dealerDone: boolean): boolean {
  return phase === 'initial' || (phase === 'dealer-hole' && holeShown) || (phase === 'final-draw' && dealerDone);
}
void bjVal;

// ------------------------------------------------------------------ §34.9 bonus statistics (pure; never mixed with strategy accuracy)
export interface BonusRow {
  handId: string; handNumber: number; at: number; tableCode: string; mainNet: number;
  results: BjSideResult[];
  prog: { stake: number; amount: number; combo: string | null; contrib: number; meterId: string | null; fromMeter: boolean } | null;
}
export interface BonusLine { bets: number; wagered: number; returned: number; net: number; wins: number; hitPct: number; biggest: number; topCombo: string | null; combos: { combo: string; count: number }[] }
export interface BonusStats {
  lifetime: Record<string, BonusLine>; session: Record<string, BonusLine>;
  progressive: { lifetime: BonusLine & { contributed: number; jackpots: number }; session: BonusLine & { contributed: number; jackpots: number } };
  jackpots: { handId: string; at: number; combo: string | null; amount: number }[];
  sessionStart: number | null;
}
function line(xs: { stake: number; credit: number; win: boolean; label: string | null }[]): BonusLine {
  const combos = new Map<string, number>();
  for (const x of xs) if (x.win && x.label) combos.set(x.label, (combos.get(x.label) ?? 0) + 1);
  const wagered = xs.reduce((t, x) => t + x.stake, 0), returned = xs.reduce((t, x) => t + x.credit, 0), wins = xs.filter((x) => x.win).length;
  const list = [...combos].map(([combo, count]) => ({ combo, count })).sort((a, b) => b.count - a.count || a.combo.localeCompare(b.combo));
  return { bets: xs.length, wagered, returned, net: returned - wagered, wins, hitPct: xs.length ? +(100 * wins / xs.length).toFixed(2) : 0,
    biggest: Math.max(0, ...xs.filter((x) => x.win).map((x) => x.credit - x.stake)), topCombo: list[0]?.combo ?? null, combos: list };
}
/** A session is the run of hands with no gap longer than an hour, ending at the latest hand (same rule as §31). */
export function bonusStats(rows: BonusRow[], gapMs = 60 * 60_000): BonusStats {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  let i = sorted.length - 1;
  while (i > 0 && sorted[i].at - sorted[i - 1].at <= gapMs) i--;
  const sess = sorted.slice(Math.max(0, i));
  const per = (rs: BonusRow[]) => {
    const by: Record<string, { stake: number; credit: number; win: boolean; label: string | null }[]> = {};
    for (const r of rs) for (const x of r.results) (by[x.id] ??= []).push({ stake: x.stake, credit: x.credit, win: x.result === 'win', label: x.label });
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, line(v)]));
  };
  const prog = (rs: BonusRow[]) => {
    const ps = rs.filter((r) => r.prog);
    return { ...line(ps.map((r) => ({ stake: r.prog!.stake, credit: r.prog!.amount, win: r.prog!.amount > 0, label: r.prog!.combo }))),
      contributed: ps.reduce((t, r) => t + r.prog!.contrib, 0), jackpots: ps.filter((r) => r.prog!.fromMeter).length };
  };
  return {
    lifetime: per(sorted), session: per(sess), progressive: { lifetime: prog(sorted), session: prog(sess) },
    jackpots: sorted.filter((r) => r.prog?.fromMeter).map((r) => ({ handId: r.handId, at: r.at, combo: r.prog!.combo, amount: r.prog!.amount })).reverse(),
    sessionStart: sess[0]?.at ?? null,
  };
}
