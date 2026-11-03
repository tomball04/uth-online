// Local, per-device preferences. None of these affect game correctness.

export interface Prefs {
  fxVolume: number;        // 0..1
  ambientVolume: number;   // 0..1
  motion: 'full' | 'fast' | 'off';
  trainer: 'casino' | 'training' | 'challenge';
  fourColorDeck: boolean;
}

import { DEFAULT_BACK, DEFAULT_FELT, type CardBack, type FeltColor } from '../shared/themes.js';
export { BACKS, FELTS, type CardBack, type FeltColor } from '../shared/themes.js';

const KEY = 'uth.prefs';
const defaults: Prefs = {
  fxVolume: 0.7, ambientVolume: 0.25,
  motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full',
  trainer: 'casino', fourColorDeck: false,
};

let current: Prefs = { ...defaults, ...(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } })() };
const listeners = new Set<(p: Prefs) => void>();

export const prefs = {
  get: () => current,
  set(p: Partial<Prefs>) {
    current = { ...current, ...p };
    localStorage.setItem(KEY, JSON.stringify(current));
    applyTheme();
    listeners.forEach((l) => l(current));
  },
  on(fn: (p: Prefs) => void) { listeners.add(fn); return () => listeners.delete(fn); },
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
  d.felt = tableTheme?.felt ?? DEFAULT_FELT;
  d.back = tableTheme?.cardBack ?? DEFAULT_BACK;
}
applyTheme();

/** Multiplier applied to every animation duration. 0 = no motion. */
export const motionScale = () => (current.motion === 'off' ? 0 : current.motion === 'fast' ? 0.45 : 1);
