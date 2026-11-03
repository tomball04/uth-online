import type { TableConfig } from '../shared/protocol.js';
import { cleanName } from './engine.js';

export const MULTI_DEFAULTS: Omit<TableConfig, 'name'> = {
  isPublic: false, allowSpectators: true, maxSeats: 6,
  minAnte: 500, maxAnte: 10_000, maxTrips: 2_500, startingBankroll: 100_000,
  decisionSeconds: 25, bettingSeconds: 20, solo: false,
};

export const SOLO_DEFAULTS: Omit<TableConfig, 'name'> = {
  isPublic: false, allowSpectators: false, maxSeats: 1,
  minAnte: 100, maxAnte: 50_000, maxTrips: 10_000, startingBankroll: 50_000,
  decisionSeconds: 0, bettingSeconds: 5, solo: true,
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
  const name = cleanName(typeof i.name === 'string' ? i.name : '', 40) || (solo ? 'Practice Table' : `${hostName}'s Table`);
  const c: TableConfig = {
    name, solo,
    isPublic: solo ? false : i.isPublic === true,
    allowSpectators: solo ? false : i.allowSpectators !== false,
    maxSeats: solo ? 1 : int('maxSeats', 2, 6, base.maxSeats),
    minAnte: dollars('minAnte', 100, 1_000_000, base.minAnte),
    maxAnte: dollars('maxAnte', 100, 1_000_000, base.maxAnte),
    maxTrips: dollars('maxTrips', 0, 1_000_000, base.maxTrips),
    startingBankroll: dollars('startingBankroll', 1_000, 100_000_000, base.startingBankroll),
    decisionSeconds: solo ? int('decisionSeconds', 0, 300, 0) : int('decisionSeconds', 5, 120, base.decisionSeconds),
    bettingSeconds: int('bettingSeconds', 5, 120, base.bettingSeconds),
  };
  if (c.maxAnte < c.minAnte) throw new Error('Maximum ante must be at least the minimum ante.');
  if (c.startingBankroll < c.minAnte * 3) throw new Error('Starting bankroll must cover at least one minimum hand (3× the minimum ante).');
  return c;
}
