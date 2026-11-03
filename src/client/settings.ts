// Local, per-device preferences. None of these affect game correctness.

export interface Prefs {
  fxVolume: number;        // 0..1
  ambientVolume: number;   // 0..1
  motion: 'full' | 'fast' | 'off';
  trainer: 'casino' | 'training' | 'challenge';
  fourColorDeck: boolean;
}

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
    document.documentElement.dataset.motion = current.motion;
    document.documentElement.dataset.fourColor = String(current.fourColorDeck);
    listeners.forEach((l) => l(current));
  },
  on(fn: (p: Prefs) => void) { listeners.add(fn); return () => listeners.delete(fn); },
};
document.documentElement.dataset.motion = current.motion;
document.documentElement.dataset.fourColor = String(current.fourColorDeck);

/** Multiplier applied to every animation duration. 0 = no motion. */
export const motionScale = () => (current.motion === 'off' ? 0 : current.motion === 'fast' ? 0.45 : 1);
