import type { TableConfig } from '../shared/protocol.js';
import { cleanName } from './engine.js';
import { DEFAULT_BACK, DEFAULT_FELT, isBack, isEffects, isFelt } from '../shared/themes.js';
import { DEFAULT_DEALER_SETTINGS, parseDealerSettings } from '../shared/dealers.js';
import { DEFAULT_BAD_BEAT_VARIANT, DEFAULT_PAIRS_VARIANT, isBadBeatVariant, isPairsVariant } from '../shared/sidebets.js';
import { DEFAULT_TRIPS_VARIANT, isTripsVariant } from '../shared/rules.js';
import { DEFAULT_PAIR_PLUS_VARIANT, isPairPlusVariant } from '../shared/tcp.js';
import { isProgProfile, isProgVariant, type ProgGame } from '../shared/progressive.js';
import { DEFAULT_BJ_SIDES, parseBjSidesConfig } from '../shared/bjsides.js';

/**
 * §33–§39 pay-table and progressive defaults. UTH keeps the published $5 Five Card Progressive by default
 * (V2 is selectable); Three Card Poker and Blackjack open with the custom High Roller profile ($5 wager,
 * $25,000 starting meter), clearly labelled as custom. Blackjack side bets start on Classic (none).
 */
export const GAME_EXTRAS: Pick<TableConfig, 'tripsVariant' | 'pairPlusVariant' | 'uthProg' | 'tcpProg' | 'bjProg' | 'jackpotSuit' | 'bjSides'> = {
  tripsVariant: DEFAULT_TRIPS_VARIANT, pairPlusVariant: DEFAULT_PAIR_PLUS_VARIANT,
  uthProg: { variant: 'five-card-5', profile: 'casino' },
  tcpProg: { on: true, variant: 'tcp-pt7', profile: 'high-roller' },
  bjProg: { on: true, variant: 'bj-213-16', profile: 'high-roller' },
  jackpotSuit: 0, bjSides: DEFAULT_BJ_SIDES,
};
/** Validates one game's progressive settings; returns an error message or the parsed value. */
export function parseProg<T extends { variant: string; profile: string; on?: boolean }>(game: ProgGame, x: unknown, cur: T): T | string {
  if (x === undefined) return cur;
  if (!x || typeof x !== 'object') return 'Invalid progressive settings.';
  const o = x as Partial<T>;
  const out = { ...cur };
  if (o.variant !== undefined) { if (!isProgVariant(game, o.variant)) return 'Unknown progressive pay table.'; out.variant = o.variant; }
  if (o.profile !== undefined) { if (!isProgProfile(o.profile)) return 'Unknown progressive profile.'; out.profile = o.profile; }
  if (o.on !== undefined && 'on' in cur) out.on = !!o.on;
  return out;
}

export const MULTI_DEFAULTS: Omit<TableConfig, 'name'> = {
  isPublic: false, allowSpectators: true, maxSeats: 6,
  minAnte: 500, maxAnte: 10_000, maxTrips: 2_500, maxPairs: 2_500, maxBadBeat: 2_500, startingBankroll: 100_000,
  pairsVariant: DEFAULT_PAIRS_VARIANT, badBeatVariant: DEFAULT_BAD_BEAT_VARIANT, progressive: true, felt: DEFAULT_FELT, cardBack: DEFAULT_BACK, effects: 'all',
  game: 'uth', maxPairPlus: 2_500, maxSixCard: 2_500,
  decisionSeconds: 25, bettingSeconds: 20, solo: false, bjSurrender: false, dealer: DEFAULT_DEALER_SETTINGS, ...GAME_EXTRAS,
};

export const SOLO_DEFAULTS: Omit<TableConfig, 'name'> = {
  isPublic: false, allowSpectators: false, maxSeats: 1,
  minAnte: 100, maxAnte: 50_000, maxTrips: 10_000, maxPairs: 10_000, maxBadBeat: 10_000, startingBankroll: 50_000,
  pairsVariant: DEFAULT_PAIRS_VARIANT, badBeatVariant: DEFAULT_BAD_BEAT_VARIANT, progressive: true, felt: DEFAULT_FELT, cardBack: DEFAULT_BACK, effects: 'all',
  game: 'uth', maxPairPlus: 10_000, maxSixCard: 10_000,
  decisionSeconds: 0, bettingSeconds: 5, solo: true, bjSurrender: false, dealer: DEFAULT_DEALER_SETTINGS, ...GAME_EXTRAS,
};

/** Build a validated config from untrusted input. Throws Error with a user-facing message. */
export function buildConfig(input: unknown, hostName: string): TableConfig {
  const i = (typeof input === 'object' && input) ? input as Record<string, unknown> : {};
  const solo = i.solo === true;
  const base = solo ? SOLO_DEFAULTS : MULTI_DEFAULTS;
  const int = (k: string, lo: number, hi: number, def: number) => {
    const v = i[k];
    if (v === undefined || v === null || v === '') return def;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${k}.`);
    return v;
  };
  const dollars = (k: string, lo: number, hi: number, def: number) => {
    const v = int(k, lo, hi, def);
    if (v % 100) throw new Error(`${k} must be whole dollars.`);
    return v;
  };
  const variant = <T>(k: string, ok: (x: unknown) => x is T, def: T): T => {
    const v = i[k];
    if (v === undefined || v === null || v === '') return def;
    if (!ok(v)) throw new Error(`Unknown pay table for ${k}.`);
    return v;
  };
  const must = <T>(r: T | string): T => { if (typeof r === 'string') throw new Error(r); return r; };
  const name = cleanName(typeof i.name === 'string' ? i.name : '', 40) || (solo ? 'Practice Table' : `${hostName}'s Table`);
  const c: TableConfig = {
    name, solo,
    isPublic: solo ? false : i.isPublic === true,
    allowSpectators: solo ? false : i.allowSpectators !== false,
    maxSeats: solo ? 1 : int('maxSeats', 2, 6, base.maxSeats),
    minAnte: dollars('minAnte', 100, 100_000_000, base.minAnte),
    maxAnte: dollars('maxAnte', 100, 100_000_000, base.maxAnte),
    maxTrips: dollars('maxTrips', 0, 1_000_000, base.maxTrips),
    maxPairs: dollars('maxPairs', 0, 1_000_000, base.maxPairs),
    maxBadBeat: dollars('maxBadBeat', 0, 1_000_000, base.maxBadBeat),
    pairsVariant: variant('pairsVariant', isPairsVariant, base.pairsVariant),
    badBeatVariant: variant('badBeatVariant', isBadBeatVariant, base.badBeatVariant),
    progressive: i.progressive !== false,
    game: i.game === 'tcp' || i.game === 'bj' ? i.game : 'uth',
    bjSurrender: i.bjSurrender === true,
    maxPairPlus: dollars('maxPairPlus', 0, 1_000_000, base.maxPairPlus),
    maxSixCard: dollars('maxSixCard', 0, 1_000_000, base.maxSixCard),
    felt: variant('felt', isFelt, base.felt),
    cardBack: variant('cardBack', isBack, base.cardBack),
    effects: variant('effects', isEffects, base.effects),
    startingBankroll: dollars('startingBankroll', 1_000, 100_000_000_000, base.startingBankroll),
    decisionSeconds: solo ? int('decisionSeconds', 0, 300, 0) : int('decisionSeconds', 5, 120, base.decisionSeconds),
    bettingSeconds: int('bettingSeconds', 5, 120, base.bettingSeconds),
    // §32: private tables default to the "Asshole" attitude (v1 "Savage"); public tables to Smartass. Hosts can go up to No Mercy.
    dealer: parseDealerSettings(i.dealer, { ...base.dealer, attitude: i.isPublic === true && !solo ? 'smartass' : 'asshole' }),
    tripsVariant: variant('tripsVariant', isTripsVariant, base.tripsVariant),
    pairPlusVariant: variant('pairPlusVariant', isPairPlusVariant, base.pairPlusVariant),
    uthProg: must(parseProg('uth', i.uthProg, base.uthProg)),
    tcpProg: must(parseProg('tcp', i.tcpProg, base.tcpProg)),
    bjProg: must(parseProg('bj', i.bjProg, base.bjProg)),
    jackpotSuit: int('jackpotSuit', 0, 3, base.jackpotSuit),
    bjSides: i.bjSides === undefined ? base.bjSides : must(parseBjSidesConfig(i.bjSides)),
  };
  if (c.maxAnte < c.minAnte) throw new Error('Maximum ante must be at least the minimum ante.');
  if (c.startingBankroll < c.minAnte * 3) throw new Error('Starting bankroll must cover at least one minimum hand (3× the minimum ante).');
  return c;
}
