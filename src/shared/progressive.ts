// §37 Progressive Jackpot Service — the shared half: every progressive variant for every game, how its
// qualifying hand is read from the cards, how much of a wager feeds its meter, and how one table's awards
// are resolved against a meter. The server half (atomic meter updates, transaction history, concurrent
// claims) lives in the stores' settleHand transaction, which locks each meter row while it resolves.
//
// Conventions (§38.4): every progressive award here is "for 1" — the award is the whole payout and the
// wager is NOT returned. "meter" rows pay a percentage of the meter as it stands when the hand settles
// (whole dollars, rounded down); "fixed" rows pay a fixed amount per base wager.
//
// Meters never mix: each (variant, profile) pair has its own meter id, so the three games — and the
// published versus High Roller profiles of one game — never share balances, contributions or reseeds.

import { evaluate, handName, categoryOf, Cat, type HandName } from './evaluator.js';
import { rankOf, suitOf } from './cards.js';
import { evaluate3, tcpCategory, TCP_CAT, isMiniRoyal } from './tcp.js';

export type ProgGame = 'uth' | 'tcp' | 'bj';
export type ProgProfile = 'casino' | 'high-roller';
export interface ProgRow { combo: string; label: string; kind: 'meter' | 'fixed'; pct?: number; amount?: number }
export interface ProgSource { title: string; url: string }
/** What a progressive reads: UTH (hole + board), Three Card Poker (three cards), Blackjack (first two + dealer up-card). */
export interface ProgCards { hole: number[]; board?: number[]; upcard?: number; suit?: number }
export interface ProgVariant {
  id: string; game: ProgGame; name: string; short: string;
  /** The wager the source quotes its awards for (cents). */
  base: number;
  /** Starting / reset value at the base wager (cents). */
  seed: number;
  /** Share of each wager added to the meter, percent. */
  contributionPct: number;
  rows: ProgRow[];
  /** Envy bonus (cents per base wager) paid to every OTHER progressive bettor at the same table when a row hits. */
  envy: Record<string, number>;
  cards: string;
  /** Uses the operator's designated jackpot suit. */
  suited: boolean;
  sources: ProgSource[];
  /** Operator choices where the source is silent, stated openly. */
  notes: string[];
  evaluate: (c: ProgCards) => string | null;
}

// ------------------------------------------------------------------ Ultimate Texas Hold'em
const fiveCardHand = (c: ProgCards) => handName(evaluate([...c.hole, ...(c.board ?? []).slice(0, 3)]));
const UTH_FIVE: ProgVariant = {
  id: 'five-card-5', game: 'uth', name: 'Five Card Progressive', short: 'Five Card',
  base: 500, seed: 1_000_000, contributionPct: 70,
  rows: [
    { combo: 'Royal Flush', label: 'Royal Flush', kind: 'meter', pct: 100 },
    { combo: 'Straight Flush', label: 'Straight Flush', kind: 'meter', pct: 10 },
    { combo: 'Four of a Kind', label: 'Four of a Kind', kind: 'fixed', amount: 150_000 },
    { combo: 'Full House', label: 'Full House', kind: 'fixed', amount: 25_000 },
    { combo: 'Flush', label: 'Flush', kind: 'fixed', amount: 20_000 },
    { combo: 'Straight', label: 'Straight', kind: 'fixed', amount: 15_000 },
    { combo: 'Three of a Kind', label: 'Three of a Kind', kind: 'fixed', amount: 4_500 },
  ],
  envy: { 'Royal Flush': 500_000, 'Straight Flush': 150_000 },
  cards: 'Your two hole cards plus the three flop cards', suited: false,
  sources: [
    { title: 'Hollywood Casino PNRC — Ultimate Texas Hold’em progressive guide', url: 'https://www.hollywoodpnrc.com/-/media/png/east/hollywood-pnrc/pdfs/pnrc-progressive-table-guides-2022/pnrc-texasholdem.pdf' },
    { title: 'Washington State Gambling Commission — Ultimate Texas Hold’em, Multi-Game Link Paytable 01', url: "https://wsgc.wa.gov/sites/default/files/2025-04/Ultimate%20Texas%20Hold%20'Em_0.pdf" },
  ],
  notes: ['Seed $10,000 and 70% contribution are operator choices.', 'Folded hands stay eligible (the bet is decided by the flop).'],
  evaluate: (c) => { const n = fiveCardHand(c); return UTH_FIVE.rows.some((r) => r.combo === n) ? n : null; },
};

/** Royal Flush among the 7 cards: "hidden" if it uses at least one hole card, "board" if the five community cards are the royal. */
function uthV2Combo(c: ProgCards): string | null {
  const board = c.board ?? [];
  if (board.length < 5) return null;
  const n = handName(evaluate([...c.hole, ...board]));
  if (n === 'Royal Flush') return handName(evaluate(board)) === 'Royal Flush' ? 'Royal Flush (board)' : 'Royal Flush (hidden)';
  return ['Straight Flush', 'Four of a Kind', 'Full House'].includes(n) ? n : null;
}
const UTH_V2: ProgVariant = {
  id: 'uth-v2', game: 'uth', name: 'Ultimate Texas Hold’em Progressive V2', short: 'Progressive V2',
  base: 100, seed: 1_000_000, contributionPct: 20,
  rows: [
    { combo: 'Royal Flush (hidden)', label: 'Royal Flush using at least one hole card', kind: 'meter', pct: 100 },
    { combo: 'Royal Flush (board)', label: 'Royal Flush entirely on the board', kind: 'fixed', amount: 100_000 },
    { combo: 'Straight Flush', label: 'Straight Flush', kind: 'fixed', amount: 25_000 },
    { combo: 'Four of a Kind', label: 'Four of a Kind', kind: 'fixed', amount: 7_500 },
    { combo: 'Full House', label: 'Full House', kind: 'fixed', amount: 1_000 },
  ],
  envy: { 'Royal Flush (hidden)': 10_000 },
  cards: 'Your best five of seven: two hole cards plus all five community cards', suited: false,
  sources: [
    { title: 'Nevada Gaming Control Board — Ultimate Texas Hold’em Progressive V2 (rules of play)', url: "https://www.gaming.nv.gov/uploadedFiles/gamingnvgov/content/divisions/enforcement/Rules-of-Play/Ultimate%20Texas%20Hold%27em%20Progressive%20-%20V2.pdf" },
    { title: 'Wizard of Odds — Ultimate Texas Hold’em, “Small Progressive” ($1)', url: 'https://wizardofodds.com/games/ultimate-texas-hold-em/' },
  ],
  notes: [
    'Pay table checked against the Wizard of Odds $1 “Small Progressive” (hidden Royal = jackpot + $100 Envy; board Royal $1,000; Straight Flush $250; Four of a Kind $75; Full House $10). The Nevada V2 PDF could not be read from this environment.',
    'Seed ($10,000 per $1) and the 20% meter contribution are operator choices: the sources consulted do not state them.',
    'Folded hands stay eligible; the hand is read at showdown from all seven cards.',
  ],
  evaluate: uthV2Combo,
};

// ------------------------------------------------------------------ Three Card Poker Progressive Link
const NV_TCP: ProgSource = { title: 'Nevada Gaming Control Board — Three Card Poker Progressive Link (rules of play, paytables PT1b–PT10)', url: 'https://www.gaming.nv.gov/siteassets/content/divisions/technology/rules-of-play/three-card-poker-progressive-link.pdf' };
const WOO_TCP: ProgSource = { title: 'Wizard of Odds — Three Card Poker progressive tables (Envy $100 / $25 per $1)', url: 'https://wizardofodds.com/games/three-card-poker/' };
function tcpProgCombo(c: ProgCards): string | null {
  if (c.hole.length !== 3) return null;
  if (isMiniRoyal(c.hole)) return suitOf(c.hole[0]) === (c.suit ?? 0) ? 'A-K-Q (jackpot suit)' : 'A-K-Q suited';
  const cat = tcpCategory(evaluate3(c.hole));
  return cat === TCP_CAT.StraightFlush ? 'Straight Flush' : cat === TCP_CAT.Trips ? 'Three of a Kind' : cat === TCP_CAT.Straight ? 'Straight' : null;
}
const tcpPt = (id: string, sf: number, trips: number, straight: number | null, seed: number, pct: number, envy: boolean): ProgVariant => ({
  id: `tcp-${id.toLowerCase()}`, game: 'tcp', name: `Three Card Progressive ${id}`, short: id,
  base: 100, seed: seed * 100, contributionPct: pct,
  rows: [
    { combo: 'A-K-Q (jackpot suit)', label: 'A-K-Q suited in the jackpot suit', kind: 'meter', pct: 100 },
    { combo: 'A-K-Q suited', label: 'A-K-Q suited, other suit', kind: 'fixed', amount: 50_000 },
    { combo: 'Straight Flush', label: 'Other Straight Flush', kind: 'fixed', amount: sf * 100 },
    { combo: 'Three of a Kind', label: 'Three of a Kind', kind: 'fixed', amount: trips * 100 },
    ...(straight ? [{ combo: 'Straight', label: 'Straight', kind: 'fixed' as const, amount: straight * 100 }] : []),
  ],
  envy: envy ? { 'A-K-Q (jackpot suit)': 10_000, 'A-K-Q suited': 2_500 } : {},
  cards: 'Your three cards, whatever the dealer has and even if you fold', suited: true,
  sources: envy ? [NV_TCP, WOO_TCP] : [NV_TCP],
  notes: [
    `${id}: seed $${seed.toLocaleString('en-US')} and ${pct}% meter increment per the Nevada configuration table.`,
    ...(envy ? ['Envy: Nevada lists Envy for this table without the base wager; $100 / $25 per $1 is the Wizard of Odds figure for the same Mini Royal table.'] : ['No Envy bonus on this table.']),
    'Resolved for every hand, regardless of the Ante/Play result or a fold (Nevada: “always resolved regardless of the outcome of the main theme”).',
  ],
  evaluate: tcpProgCombo,
});
const TCP_PT = [
  tcpPt('PT1b', 70, 60, 6, 1000, 17, true),
  tcpPt('PT2b', 100, 90, null, 1000, 23, true),
  tcpPt('PT3a', 75, 50, 5, 2000, 17, false),
  tcpPt('PT6', 80, 60, 7, 1000, 19, true),
  tcpPt('PT7', 120, 100, null, 1000, 25, true),
  tcpPt('PT8', 100, 50, 6, 2000, 17, false),
];

// ------------------------------------------------------------------ Blackjack 21+3 Progressive
function bj213Combo(c: ProgCards): string | null {
  if (c.hole.length < 2 || c.upcard === undefined) return null;
  const three = [c.hole[0], c.hole[1], c.upcard];
  if (isMiniRoyal(three)) return suitOf(three[0]) === (c.suit ?? 0) ? 'Mini Royal (jackpot suit)' : 'Mini Royal';
  const cat = tcpCategory(evaluate3(three));
  return cat === TCP_CAT.StraightFlush ? 'Straight Flush' : cat === TCP_CAT.Trips ? 'Three of a Kind' : cat === TCP_CAT.Straight ? 'Straight' : null;
}
const BJ_213_16: ProgVariant = {
  id: 'bj-213-16', game: 'bj', name: '21+3 Progressive (PT-PRG-213-16)', short: '21+3 Prog',
  base: 100, seed: 200_000, contributionPct: 17,
  rows: [
    { combo: 'Mini Royal (jackpot suit)', label: 'Suited A-K-Q in the jackpot suit', kind: 'meter', pct: 100 },
    { combo: 'Mini Royal', label: 'Suited A-K-Q, other suit', kind: 'fixed', amount: 50_000 },
    { combo: 'Straight Flush', label: 'Straight Flush', kind: 'fixed', amount: 7_500 },
    { combo: 'Three of a Kind', label: 'Three of a Kind (suited or not)', kind: 'fixed', amount: 3_000 },
    { combo: 'Straight', label: 'Straight', kind: 'fixed', amount: 500 },
  ],
  envy: {},
  cards: 'Your first two cards plus the dealer’s up-card', suited: true,
  sources: [{ title: 'Nevada Gaming Control Board — 21+3 Progressive V5 (PT-PRG-213-16, 3–8 decks)', url: 'https://www.gaming.nv.gov/siteassets/content/divisions/enforcement/rules-of-play/21_Plus_3_Progressive_-_V5.pdf' }],
  notes: ['Seed $2,000 and 17% primary increment per the V5 configuration table. Flush loses on this table. No Envy is defined.',
    'Resolved right after the deal from visible cards, independent of the Blackjack hand and of the ordinary 21+3 bet.'],
  evaluate: bj213Combo,
};

export const PROG_VARIANTS: Record<string, ProgVariant> = Object.fromEntries([UTH_FIVE, UTH_V2, ...TCP_PT, BJ_213_16].map((v) => [v.id, v]));
export const PROG_DEFAULT: Record<ProgGame, string> = { uth: 'uth-v2', tcp: 'tcp-pt7', bj: 'bj-213-16' };
export const progVariantsFor = (g: ProgGame) => Object.values(PROG_VARIANTS).filter((v) => v.game === g);
export const isProgVariant = (g: ProgGame, x: unknown): x is string => typeof x === 'string' && PROG_VARIANTS[x]?.game === g;
export const isProgProfile = (x: unknown): x is ProgProfile => x === 'casino' || x === 'high-roller';

/** §37.2 High Roller: a custom profile, $5 wager and $25,000 starting meter for every game. Awards scale with the wager. */
export const HIGH_ROLLER = { wager: 500, seed: 2_500_000 };
export interface ProgSetup { meterId: string; variant: ProgVariant; profile: ProgProfile; wager: number; seed: number; contribution: number; scale: number; custom: boolean }
export function progSetup(variantId: string, profile: ProgProfile): ProgSetup {
  const v = PROG_VARIANTS[variantId];
  if (!v) throw new Error(`Unknown progressive ${variantId}`);
  const hr = profile === 'high-roller';
  const wager = hr ? HIGH_ROLLER.wager : v.base;
  const scale = wager / v.base;
  return {
    meterId: hr ? `${v.id}:high-roller` : v.id === 'five-card-5' ? 'five-card-5' : `${v.id}:casino`,
    variant: v, profile, wager, scale, custom: hr,
    seed: hr ? HIGH_ROLLER.seed : v.seed,
    contribution: Math.round((wager * v.contributionPct) / 100),
  };
}
/** Every meter that can exist (for the lobby display and migrations). */
export const ALL_SETUPS = Object.values(PROG_VARIANTS).flatMap((v) => (['casino', 'high-roller'] as ProgProfile[]).map((p) => progSetup(v.id, p)));

// ------------------------------------------------------------------ resolution against one meter
export interface ProgEntry { playerId: string; seat: number; combo: string | null }
export interface ProgAward { playerId: string; combo: string | null; base: number; envy: number; amount: number; label: string; fromMeter: boolean; pct?: number }
export interface ProgHit { playerId: string; combo: string; amount: number; meterBefore: number; meterAfter: number; pct: number }
export interface ProgResolution { awards: Map<string, ProgAward>; meterBefore: number; meterAfter: number; hits: ProgHit[] }
const dollarsDown = (cents: number) => Math.floor(cents / 100) * 100;

/**
 * Pays every progressive bet on one meter for one hand at one table, in seat order (the deterministic
 * concurrent-winner policy: within a table the lower seat is paid first; across tables the hand whose
 * settlement transaction locks the meter first is paid first). A 100% award empties the meter, which then
 * restarts at the seed plus any cents left over by rounding; a smaller percentage leaves the remainder
 * (never below the seed). Fixed awards are paid by the house and do not touch the meter. Envy goes to every
 * OTHER bettor on this meter at this table, never to the winner.
 */
export function resolveMeter(setup: ProgSetup, entries: ProgEntry[], meter: number): ProgResolution {
  const v = setup.variant;
  const meterBefore = meter;
  const awards = new Map<string, ProgAward>();
  const hits: ProgHit[] = [];
  for (const e of [...entries].sort((a, b) => a.seat - b.seat)) {
    const row = e.combo ? v.rows.find((r) => r.combo === e.combo) : undefined;
    let base = 0, label = '', fromMeter = false, pct: number | undefined;
    if (row?.kind === 'meter') {
      fromMeter = true; pct = row.pct!;
      const before = meter;
      base = dollarsDown((meter * row.pct!) / 100);
      meter = row.pct === 100 ? setup.seed + (meter - base) : Math.max(setup.seed, meter - base);
      label = `${row.label} — ${row.pct}% of the jackpot`;
      hits.push({ playerId: e.playerId, combo: row.combo, amount: base, meterBefore: before, meterAfter: meter, pct: row.pct! });
    } else if (row?.kind === 'fixed') {
      base = Math.round(row.amount! * setup.scale);
      label = `${row.label} pays ${(base / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} for ${(setup.wager / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
    }
    awards.set(e.playerId, { playerId: e.playerId, combo: e.combo, base, envy: 0, amount: base, label, fromMeter, pct });
  }
  for (const hit of hits) {
    const envy = Math.round((v.envy[hit.combo] ?? 0) * setup.scale);
    if (!envy) continue;
    for (const a of awards.values()) {
      if (a.playerId === hit.playerId) continue;
      a.envy += envy; a.amount += envy;
      a.label = a.label ? `${a.label} + Envy bonus` : `Envy bonus (${hit.combo} at the table)`;
    }
  }
  return { awards, meterBefore, meterAfter: meter, hits };
}

// ------------------------------------------------------------------ legacy names (UTH Five Card)
export interface ProgressiveRow { hand: HandName; kind: 'meter' | 'fixed'; pct?: number; amount?: number }
/** The original $5 Five Card Progressive, unchanged, for screens that still show it by name. */
export const PROGRESSIVE = {
  id: UTH_FIVE.id, name: UTH_FIVE.name, wager: UTH_FIVE.base, contribution: Math.round((UTH_FIVE.base * UTH_FIVE.contributionPct) / 100), seed: UTH_FIVE.seed,
  rows: UTH_FIVE.rows.map((r) => ({ hand: r.combo as HandName, kind: r.kind, pct: r.pct, amount: r.amount })) as ProgressiveRow[],
  envy: UTH_FIVE.envy as Partial<Record<HandName, number>>, cards: UTH_FIVE.cards, foldHandling: 'stays-live' as const, sources: UTH_FIVE.sources,
};
export function progressiveHand(hole: number[], flop: number[]): HandName { return fiveCardHand({ hole, board: flop }); }
export interface ProgressiveEntry { playerId: string; seat: number; hand: HandName }
export interface ProgressiveAward { playerId: string; hand: string; base: number; envy: number; amount: number; label: string; fromMeter: boolean }
export interface ProgressiveHit { playerId: string; hand: string; amount: number; meterBefore: number }
export interface ProgressiveResolution { awards: Map<string, ProgressiveAward>; meterBefore: number; meterAfter: number; hits: ProgressiveHit[] }
/** Five Card Progressive at the published $5 profile (kept for the original tests and callers). */
export function resolveProgressive(entries: ProgressiveEntry[], meter: number): ProgressiveResolution {
  const r = resolveMeter(progSetup('five-card-5', 'casino'), entries.map((e) => ({ playerId: e.playerId, seat: e.seat, combo: e.hand })), meter);
  const awards = new Map([...r.awards].map(([k, a]) => [k, { playerId: a.playerId, hand: a.combo ?? entries.find((e) => e.playerId === k)!.hand, base: a.base, envy: a.envy, amount: a.amount, label: a.label, fromMeter: a.fromMeter }]));
  return { awards, meterBefore: r.meterBefore, meterAfter: r.meterAfter, hits: r.hits.map((h) => ({ playerId: h.playerId, hand: h.combo, amount: h.amount, meterBefore: h.meterBefore })) };
}
void rankOf; void categoryOf; void Cat;
