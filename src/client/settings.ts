// Local, per-device preferences. None of these affect game correctness.

export interface Prefs {
  fxVolume: number;        // 0..1
  ambientVolume: number;   // 0..1
  motion: 'full' | 'fast' | 'off';
  trainer: 'casino' | 'training' | 'challenge';
  fourColorDeck: boolean;
  /** Show other players' animated frames and victory effects (§24). */
  cosmeticFx: boolean;
  /** §29 cosmetic animation level on this device. */
  fxLevel: 'full' | 'subtle' | 'static' | 'hide';
  /** §32 dealer banter — this device and this player only. */
  roast: RoastPrefs;
}
export interface RoastPrefs {
  /** Highest intensity this player wants to see (0 Professional … 4 No Mercy). Also caps lines aimed at them. */
  max: 0 | 1 | 2 | 3 | 4;
  /** Personal roast targeting (opt-in). Off = the dealer never roasts this player by name. */
  targeting: boolean;
  /** Has the player answered the opt-in question yet? */
  asked: boolean;
  profanity: boolean;
  subtitles: boolean;
  speech: boolean;
  volume: number;   // 0..100
  mute: boolean;
}
export const DEFAULT_ROAST: RoastPrefs = { max: 4, targeting: false, asked: false, profanity: true, subtitles: true, speech: false, volume: 70, mute: false };

import { DEFAULT_BACK, DEFAULT_FELT, type CardBack, type FeltColor } from '../shared/themes.js';
export { BACKS, FELTS, type CardBack, type FeltColor } from '../shared/themes.js';

const KEY = 'uth.prefs';
const defaults: Prefs = {
  fxVolume: 0.7, ambientVolume: 0.25,
  motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full',
  trainer: 'casino', fourColorDeck: false, cosmeticFx: true, fxLevel: 'full', roast: DEFAULT_ROAST,
};

const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })();
let current: Prefs = { ...defaults, ...saved, roast: { ...DEFAULT_ROAST, ...(saved.roast ?? {}) } };
const listeners = new Set<(p: Prefs) => void>();

export const prefs = {
  get: () => current,
  set(p: Partial<Prefs>) {
    current = { ...current, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
    applyTheme();
    listeners.forEach((l) => l(current));
  },
  on(fn: (p: Prefs) => void) { listeners.add(fn); return () => listeners.delete(fn); },
  setRoast(p: Partial<RoastPrefs>) { prefs.set({ roast: { ...current.roast, ...p } }); },
};
// Felt and card backs belong to the table (the host picks them); outside a table the house defaults show.
let tableTheme: { felt: FeltColor; cardBack: CardBack } | null = null;
export function setTableTheme(t: { felt: FeltColor; cardBack: CardBack } | null) {
  tableTheme = t;
  applyTheme();
}
function applyTheme() {
  const d = document.documentElement.dataset;
  d.motion = current.motion;
  d.fourColor = String(current.fourColorDeck);
  d.cosfx = current.cosmeticFx ? 'on' : 'off';
  d.fx = current.fxLevel ?? 'full';
  d.felt = tableTheme?.felt ?? DEFAULT_FELT;
  d.back = tableTheme?.cardBack ?? DEFAULT_BACK;
}
applyTheme();

/** Multiplier applied to every animation duration. 0 = no motion. */
export const motionScale = () => (current.motion === 'off' ? 0 : current.motion === 'fast' ? 0.45 : 1);
