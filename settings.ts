// Local, per-device preferences. None of these affect game correctness.

export interface Prefs {
  fxVolume: number;        // 0..1
  ambientVolume: number;   // 0..1
  motion: 'full' | 'fast' | 'off';
  trainer: 'casino' | 'training' | 'challenge';
  fourColorDeck: boolean;
  felt: FeltColor;
  cardBack: CardBack;
}

export type FeltColor = 'emerald' | 'sapphire' | 'burgundy' | 'charcoal' | 'purple' | 'teal';
export type CardBack = 'burgundy' | 'navy' | 'black' | 'forest' | 'purple' | 'gold';
export const FELTS: { id: FeltColor; name: string; swatch: string }[] = [
  { id: 'emerald', name: 'Emerald', swatch: '#0e5236' }, { id: 'sapphire', name: 'Sapphire', swatch: '#134673' },
  { id: 'burgundy', name: 'Burgundy', swatch: '#5e1c27' }, { id: 'charcoal', name: 'Charcoal', swatch: '#2c3236' },
  { id: 'purple', name: 'Royal purple', swatch: '#432c61' }, { id: 'teal', name: 'Teal', swatch: '#115255' },
];
export const BACKS: { id: CardBack; name: string; swatch: string }[] = [
  { id: 'burgundy', name: 'Burgundy', swatch: '#7a1f2b' }, { id: 'navy', name: 'Navy', swatch: '#173061' },
  { id: 'black', name: 'Black', swatch: '#1c1c1c' }, { id: 'forest', name: 'Forest green', swatch: '#174a2c' },
  { id: 'purple', name: 'Purple', swatch: '#432263' }, { id: 'gold', name: 'Gold', swatch: '#9a7330' },
];

const KEY = 'uth.prefs';
const defaults: Prefs = {
  fxVolume: 0.7, ambientVolume: 0.25,
  motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'full',
  trainer: 'casino', fourColorDeck: false, felt: 'emerald', cardBack: 'burgundy',
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
function applyTheme() {
  const d = document.documentElement.dataset;
  d.motion = current.motion;
  d.fourColor = String(current.fourColorDeck);
  d.felt = current.felt;
  d.back = current.cardBack;
}
applyTheme();

/** Multiplier applied to every animation duration. 0 = no motion. */
export const motionScale = () => (current.motion === 'off' ? 0 : current.motion === 'fast' ? 0.45 : 1);
