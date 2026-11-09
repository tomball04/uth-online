// Table looks chosen by the host and shown to everyone at the table. Purely cosmetic.
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
/** Host limit on players' cosmetic effects. Never changes what anyone owns. */
export type EffectsLevel = 'all' | 'subtle' | 'off';
export const EFFECTS: { id: EffectsLevel; name: string; note: string }[] = [
  { id: 'all', name: 'All', note: 'Victory animations, animated frames, personal card backs and chips.' },
  { id: 'subtle', name: 'Subtle', note: 'Personal looks, but no victory animations and still frames.' },
  { id: 'off', name: 'Off', note: 'Portraits only. Everyone uses the table’s card backs and classic chips.' },
];
export const isEffects = (x: unknown): x is EffectsLevel => EFFECTS.some((e) => e.id === x);
export const DEFAULT_FELT: FeltColor = 'emerald';
export const DEFAULT_BACK: CardBack = 'burgundy';
export const isFelt = (x: unknown): x is FeltColor => FELTS.some((f) => f.id === x);
export const isBack = (x: unknown): x is CardBack => BACKS.some((b) => b.id === x);
