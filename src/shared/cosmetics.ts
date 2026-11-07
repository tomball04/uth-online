// Avatars, cosmetics and Style Credits (scope addendum §24). Pure data + validation shared by server and client.
// Cosmetics are visual only: nothing here is read by dealing, betting, settlement or the chip ledger.

// ------------------------------------------------------------------ appearance (always free)
export const SKIN = ['#f6d7c3', '#eec1a0', '#dfa47e', '#c68660', '#a86a48', '#8a5236', '#6b3d27', '#4a2a1b'] as const;
export const HAIR_COLOR = ['#1c1410', '#3b2417', '#6a4026', '#a0703f', '#d9b26d', '#e8d6a8', '#9a9a9a', '#e8e4dc', '#8e2f22', '#2c3e66'] as const;
export const EYE_COLOR = ['#3b2a1c', '#5b3a1e', '#2f6a8c', '#3f7a4a', '#6f7a84', '#8a6a2c'] as const;
export const FACE = ['oval', 'round', 'square', 'heart', 'long'] as const;
export const EYES = ['almond', 'round', 'hooded', 'wide', 'smiling'] as const;
export const BROWS = ['soft', 'arched', 'straight', 'bold', 'thin'] as const;
export const NOSE = ['button', 'straight', 'broad', 'narrow', 'aquiline'] as const;
export const MOUTH = ['smile', 'grin', 'neutral', 'smirk', 'laugh'] as const;
export const HAIR = ['bald', 'buzz', 'short', 'side-part', 'slick', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'braids', 'waves', 'mohawk'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'mustache', 'goatee', 'full', 'handlebar', 'chin-strap'] as const;
export const BODY = ['narrow', 'broad'] as const;
export const POSES = ['front', 'left', 'right'] as const;

export interface Appearance {
  body: (typeof BODY)[number]; skin: number; face: (typeof FACE)[number]; eyes: (typeof EYES)[number]; eyeColor: number;
  brows: (typeof BROWS)[number]; nose: (typeof NOSE)[number]; mouth: (typeof MOUTH)[number];
  hair: (typeof HAIR)[number]; hairColor: number; facialHair: (typeof FACIAL_HAIR)[number];
}
export const DEFAULT_APPEARANCE: Appearance = {
  body: 'broad', skin: 2, face: 'oval', eyes: 'almond', eyeColor: 1, brows: 'soft', nose: 'straight', mouth: 'smile',
  hair: 'short', hairColor: 1, facialHair: 'none',
};

// ------------------------------------------------------------------ equip slots and catalog
export const SLOTS = ['outfit', 'hat', 'eyewear', 'earrings', 'necklace', 'watch', 'neckwear', 'lapel', 'frame', 'background', 'chips', 'cardBack', 'emotes', 'victory'] as const;
export type Slot = (typeof SLOTS)[number];
export type Equipped = Partial<Record<Slot, string>>;

export const CATEGORIES = [
  { id: 'clothing', name: 'Clothing' }, { id: 'hats', name: 'Hats' }, { id: 'eyewear', name: 'Eyewear' },
  { id: 'jewelry', name: 'Jewelry & Watches' }, { id: 'facial', name: 'Facial Accessories' }, { id: 'frames', name: 'Avatar Frames' },
  { id: 'chips', name: 'Custom Poker Chips' }, { id: 'cardBacks', name: 'Card Backs' }, { id: 'backgrounds', name: 'Profile Backgrounds' },
  { id: 'emotes', name: 'Emotes & Reactions' }, { id: 'victory', name: 'Victory Animations' }, { id: 'featured', name: 'Featured Collections' },
] as const;
export type Category = Exclude<(typeof CATEGORIES)[number]['id'], 'featured'>;
export type Rarity = 'standard' | 'fine' | 'rare' | 'legendary';

/** Rendering definition: a fixed, enumerated recipe — never markup. */
export interface Look { kind: string; a?: string; b?: string; c?: string }
export interface Item {
  id: string; name: string; description: string; category: Category; slot: Slot; price: number; look: Look;
  rarity: Rarity; collection?: string; available: boolean;
  /** How it can be obtained without buying. */
  free?: boolean; unlock?: string;
  /** Outfit features other items depend on. */
  collar?: boolean; jacket?: boolean;
  /** Compatibility: needs an outfit with a collar / a jacket. */
  needsCollar?: boolean; needsJacket?: boolean;
}

const I = (x: Omit<Item, 'available' | 'rarity'> & { rarity?: Rarity; available?: boolean }): Item => ({ rarity: 'standard', available: true, ...x });

export const CATALOG: Item[] = [
  // ---- clothing (outfit slot). Free basics first.
  I({ id: 'tee-charcoal', name: 'Charcoal Tee', description: 'An easy crew-neck tee.', category: 'clothing', slot: 'outfit', price: 0, free: true, look: { kind: 'tee', a: '#3a3d42' } }),
  I({ id: 'tee-cream', name: 'Cream Tee', description: 'Soft cream cotton.', category: 'clothing', slot: 'outfit', price: 0, free: true, look: { kind: 'tee', a: '#e9e0cc' } }),
  I({ id: 'polo-navy', name: 'Navy Polo', description: 'Country-club casual.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, look: { kind: 'polo', a: '#22355e' } }),
  I({ id: 'polo-green', name: 'Felt-Green Polo', description: 'The color of a good table.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, look: { kind: 'polo', a: '#1f6b4a' } }),
  I({ id: 'shirt-white', name: 'White Dress Shirt', description: 'Crisp, collared, ready for a tie.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, look: { kind: 'shirt', a: '#f4f1ea' } }),
  I({ id: 'shirt-blue', name: 'Oxford Blue Shirt', description: 'A classic button-down.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, look: { kind: 'shirt', a: '#9fbbe0' } }),
  I({ id: 'dress-black', name: 'Little Black Dress', description: 'Timeless and sleek.', category: 'clothing', slot: 'outfit', price: 0, free: true, look: { kind: 'dress', a: '#1b1b1f' } }),
  I({ id: 'blazer-grey', name: 'Grey Blazer', description: 'Smart casual over a white shirt.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, jacket: true, look: { kind: 'blazer', a: '#5b5f66', b: '#f4f1ea' } }),
  I({ id: 'vest-brown', name: 'Brown Waistcoat', description: 'Dealer-school chic.', category: 'clothing', slot: 'outfit', price: 0, free: true, collar: true, look: { kind: 'vest', a: '#6a4026', b: '#f4f1ea' } }),
  I({ id: 'suit-three-piece', name: 'Three-Piece Casino Suit', description: 'Charcoal pinstripe, vest and all.', category: 'clothing', slot: 'outfit', price: 400, rarity: 'fine', collar: true, jacket: true, look: { kind: 'suit3', a: '#2b2e35', b: '#f4f1ea', c: '#3a3e47' } }),
  I({ id: 'tux-black', name: 'Black Tuxedo', description: 'Satin lapels for big nights.', category: 'clothing', slot: 'outfit', price: 450, rarity: 'fine', collar: true, jacket: true, collection: 'classic-vegas', look: { kind: 'tux', a: '#141418', b: '#f8f6f0' } }),
  I({ id: 'tux-white', name: 'White Dinner Jacket', description: 'For the high-limit room.', category: 'clothing', slot: 'outfit', price: 600, rarity: 'rare', collar: true, jacket: true, collection: 'high-roller', look: { kind: 'tux', a: '#efe9dc', b: '#ffffff' } }),
  I({ id: 'dress-emerald', name: 'Emerald Evening Gown', description: 'Matches the felt.', category: 'clothing', slot: 'outfit', price: 450, rarity: 'fine', look: { kind: 'gown', a: '#13664a' } }),
  I({ id: 'dress-red', name: 'Ruby Cocktail Dress', description: 'Red is lucky, they say.', category: 'clothing', slot: 'outfit', price: 400, rarity: 'fine', look: { kind: 'gown', a: '#9c1f2e' } }),
  I({ id: 'western-vest', name: 'Western Vest', description: 'Leather vest over a bib shirt.', category: 'clothing', slot: 'outfit', price: 300, collar: true, collection: 'old-west', look: { kind: 'vest', a: '#7a4a24', b: '#d9c7a4' } }),
  I({ id: 'vegas-sharkskin', name: 'Vintage Sharkskin Suit', description: '1962, front row at the Sands.', category: 'clothing', slot: 'outfit', price: 500, rarity: 'rare', collar: true, jacket: true, collection: 'art-deco', look: { kind: 'suit', a: '#7f8a94', b: '#f4f1ea' } }),
  I({ id: 'deco-gold-jacket', name: 'Art Deco Smoking Jacket', description: 'Velvet with geometric gold trim.', category: 'clothing', slot: 'outfit', price: 550, rarity: 'rare', collar: true, jacket: true, collection: 'art-deco', look: { kind: 'smoking', a: '#3a1f4a', b: '#c9a45c' } }),

  // ---- hats
  I({ id: 'cap-green', name: 'Green Ball Cap', description: 'A simple cap.', category: 'hats', slot: 'hat', price: 0, free: true, look: { kind: 'cap', a: '#1f6b4a' } }),
  I({ id: 'fedora-black', name: 'Classic Black Fedora', description: 'Pinched crown, satin band.', category: 'hats', slot: 'hat', price: 150, collection: 'classic-vegas', look: { kind: 'fedora', a: '#1b1b1f', b: '#8b2534' } }),
  I({ id: 'fedora-cream', name: 'Panama Fedora', description: 'Straw and summer.', category: 'hats', slot: 'hat', price: 175, look: { kind: 'fedora', a: '#e3d3a6', b: '#2a2a2a' } }),
  I({ id: 'cowboy-brown', name: 'Cowboy Hat', description: 'Wide brim, sun-worn.', category: 'hats', slot: 'hat', price: 200, collection: 'old-west', look: { kind: 'cowboy', a: '#7a4a24' } }),
  I({ id: 'cap-casino', name: 'Casino Logo Cap', description: 'Embroidered spade.', category: 'hats', slot: 'hat', price: 100, look: { kind: 'cap', a: '#141418', b: '#c9a45c' } }),
  I({ id: 'visor-dealer', name: 'Dealer’s Visor', description: 'Green visor, old-school card room.', category: 'hats', slot: 'hat', price: 120, look: { kind: 'visor', a: '#2c7a4f' } }),

  // ---- eyewear
  I({ id: 'glasses-round', name: 'Round Glasses', description: 'Thin wire frames.', category: 'eyewear', slot: 'eyewear', price: 0, free: true, look: { kind: 'round', a: '#2a2a2a' } }),
  I({ id: 'glasses-reading', name: 'Reading Glasses', description: 'For studying the strategy chart.', category: 'eyewear', slot: 'eyewear', price: 0, unlock: 'student', look: { kind: 'half', a: '#6a4026' } }),
  I({ id: 'sun-gold', name: 'Gold-Rimmed Sunglasses', description: 'Aviators with gold rims.', category: 'eyewear', slot: 'eyewear', price: 200, rarity: 'fine', look: { kind: 'aviator', a: '#c9a45c', b: '#2b2b2b' } }),
  I({ id: 'sun-blackgold', name: 'Black-and-Gold Shades', description: 'Nobody can read you.', category: 'eyewear', slot: 'eyewear', price: 300, rarity: 'rare', collection: 'high-roller', look: { kind: 'wayfarer', a: '#111', b: '#c9a45c' } }),

  // ---- jewelry & watches
  I({ id: 'studs-silver', name: 'Silver Studs', description: 'Small and bright.', category: 'jewelry', slot: 'earrings', price: 0, free: true, look: { kind: 'studs', a: '#d8dde3' } }),
  I({ id: 'hoops-gold', name: 'Gold Hoops', description: 'Classic hoops.', category: 'jewelry', slot: 'earrings', price: 120, look: { kind: 'hoops', a: '#d4af37' } }),
  I({ id: 'chain-gold', name: 'Gold Chain', description: 'A fine rope chain.', category: 'jewelry', slot: 'necklace', price: 180, look: { kind: 'chain', a: '#d4af37' } }),
  I({ id: 'pearls', name: 'Pearl Necklace', description: 'A single strand.', category: 'jewelry', slot: 'necklace', price: 220, rarity: 'fine', look: { kind: 'pearls', a: '#f3eee4' } }),
  I({ id: 'watch-steel', name: 'Steel Watch', description: 'Plain and reliable.', category: 'jewelry', slot: 'watch', price: 0, free: true, look: { kind: 'watch', a: '#c0c6cc' } }),
  I({ id: 'watch-gold', name: 'Gold Watch', description: 'Heavy, polished, unmissable.', category: 'jewelry', slot: 'watch', price: 300, rarity: 'fine', collection: 'classic-vegas', look: { kind: 'watch', a: '#d4af37' } }),
  I({ id: 'watch-luxury', name: 'Diamond Bezel Watch', description: 'Catches every light in the room.', category: 'jewelry', slot: 'watch', price: 500, rarity: 'rare', collection: 'high-roller', look: { kind: 'watch', a: '#e8e8f0', b: '#bfe3ff' } }),
  I({ id: 'pocketwatch', name: 'Pocket Watch', description: 'Gold chain across the vest.', category: 'jewelry', slot: 'watch', price: 250, collection: 'old-west', look: { kind: 'pocketwatch', a: '#c9a45c' } }),

  // ---- facial accessories: neckwear + lapel (need the right outfit)
  I({ id: 'tie-black', name: 'Black Tie', description: 'Slim and sharp.', category: 'facial', slot: 'neckwear', price: 0, free: true, needsCollar: true, look: { kind: 'tie', a: '#141418' } }),
  I({ id: 'tie-green', name: 'Felt-Green Tie', description: 'Silk in table green.', category: 'facial', slot: 'neckwear', price: 80, needsCollar: true, look: { kind: 'tie', a: '#1f6b4a' } }),
  I({ id: 'bow-red', name: 'Red Bow Tie', description: 'The Classic Vegas finishing touch.', category: 'facial', slot: 'neckwear', price: 100, needsCollar: true, collection: 'classic-vegas', look: { kind: 'bow', a: '#a3192a' } }),
  I({ id: 'bow-burgundy', name: 'Burgundy Bow Tie', description: 'Deep wine silk.', category: 'facial', slot: 'neckwear', price: 100, needsCollar: true, look: { kind: 'bow', a: '#6d1b2a' } }),
  I({ id: 'scarf-silk', name: 'Silk Scarf', description: 'Patterned silk, loosely tied.', category: 'facial', slot: 'neckwear', price: 140, look: { kind: 'scarf', a: '#c9a45c', b: '#8b2534' } }),
  I({ id: 'bolo', name: 'Bolo Tie', description: 'Turquoise slide on a leather cord.', category: 'facial', slot: 'neckwear', price: 120, needsCollar: true, collection: 'old-west', look: { kind: 'bolo', a: '#3aa6a0' } }),
  I({ id: 'pocket-square', name: 'Pocket Square', description: 'Folded to two points.', category: 'facial', slot: 'lapel', price: 60, needsJacket: true, look: { kind: 'square', a: '#f4f1ea' } }),
  I({ id: 'lapel-spade', name: 'Gold Spade Lapel Pin', description: 'A tiny gold spade.', category: 'facial', slot: 'lapel', price: 90, needsJacket: true, look: { kind: 'pin', a: '#d4af37' } }),
  I({ id: 'lapel-regular', name: 'Regular’s Pin', description: 'Awarded for coming back for another night.', category: 'facial', slot: 'lapel', price: 0, unlock: 'return-night', needsJacket: true, look: { kind: 'pin', a: '#c0c6cc' } }),
  I({ id: 'novelty-chip', name: 'Lucky Chip Earpiece', description: 'A tiny $5 chip on a clip. Silly. Lucky? No.', category: 'facial', slot: 'lapel', price: 50, look: { kind: 'chippin', a: '#c0392b' } }),

  // ---- frames
  I({ id: 'frame-gold', name: 'Classic Gold Frame', description: 'A brass ring around your portrait.', category: 'frames', slot: 'frame', price: 0, free: true, look: { kind: 'ring', a: '#c9a45c' } }),
  I({ id: 'frame-silver', name: 'Silver Frame', description: 'Polished silver.', category: 'frames', slot: 'frame', price: 150, look: { kind: 'ring', a: '#c0c6cc' } }),
  I({ id: 'frame-purple', name: 'Royal Purple Frame', description: 'Velvet purple and gold.', category: 'frames', slot: 'frame', price: 300, look: { kind: 'ring2', a: '#6a3f99', b: '#c9a45c' } }),
  I({ id: 'frame-emerald', name: 'Emerald Frame', description: 'Cut-gem green.', category: 'frames', slot: 'frame', price: 300, look: { kind: 'ring2', a: '#13664a', b: '#7fd1a8' } }),
  I({ id: 'frame-deco', name: 'Art Deco Frame', description: 'Geometric gold sunburst.', category: 'frames', slot: 'frame', price: 500, rarity: 'rare', collection: 'art-deco', look: { kind: 'deco', a: '#c9a45c' } }),
  I({ id: 'frame-diamond', name: 'Diamond Avatar Frame', description: 'A ring of tiny diamonds.', category: 'frames', slot: 'frame', price: 750, rarity: 'rare', look: { kind: 'diamond', a: '#dff3ff' } }),
  I({ id: 'frame-highroller', name: 'Animated High Roller Frame', description: 'A slow gold shimmer (still if motion is reduced).', category: 'frames', slot: 'frame', price: 1000, rarity: 'legendary', collection: 'high-roller', look: { kind: 'animated', a: '#c9a45c', b: '#fff2c4' } }),
  I({ id: 'frame-royal', name: 'Animated Royal Flush Frame', description: 'Ten through ace of spades circle your portrait.', category: 'frames', slot: 'frame', price: 1500, rarity: 'legendary', look: { kind: 'royal', a: '#c9a45c' } }),
  I({ id: 'frame-vegas-bonus', name: 'Classic Vegas Marquee Frame', description: 'Collection reward: complete Classic Vegas.', category: 'frames', slot: 'frame', price: 0, unlock: 'collection:classic-vegas', rarity: 'rare', look: { kind: 'marquee', a: '#e0b04a' } }),
  I({ id: 'frame-west-bonus', name: 'Wanted Poster Frame', description: 'Collection reward: complete Old West Gambler.', category: 'frames', slot: 'frame', price: 0, unlock: 'collection:old-west', rarity: 'rare', look: { kind: 'wanted', a: '#c8a26b' } }),
  I({ id: 'frame-hr-bonus', name: 'Velvet Rope Frame', description: 'Collection reward: complete High Roller.', category: 'frames', slot: 'frame', price: 0, unlock: 'collection:high-roller', rarity: 'rare', look: { kind: 'rope', a: '#8b2534', b: '#c9a45c' } }),
  I({ id: 'frame-deco-bonus', name: 'Chrysler Frame', description: 'Collection reward: complete Art Deco.', category: 'frames', slot: 'frame', price: 0, unlock: 'collection:art-deco', rarity: 'rare', look: { kind: 'deco', a: '#e8e8f0' } }),

  // ---- chips (visual only; values never change)
  I({ id: 'chips-classic', name: 'Classic Vegas', description: 'The standard rack.', category: 'chips', slot: 'chips', price: 0, free: true, look: { kind: 'classic' } }),
  I({ id: 'chips-ivory', name: 'Vintage Poker Chip Set', description: 'Clay chips with aged ivory faces.', category: 'chips', slot: 'chips', price: 500, rarity: 'fine', look: { kind: 'ivory' } }),
  I({ id: 'chips-blackgold', name: 'Black and Gold', description: 'Matte black, gold inlays.', category: 'chips', slot: 'chips', price: 400, look: { kind: 'blackgold' } }),
  I({ id: 'chips-highroller', name: 'High Roller', description: 'Pearl inlays and engraved rims.', category: 'chips', slot: 'chips', price: 600, rarity: 'rare', collection: 'high-roller', look: { kind: 'highroller' } }),
  I({ id: 'chips-midnight', name: 'Midnight Blue', description: 'Deep blue with silver edge spots.', category: 'chips', slot: 'chips', price: 350, look: { kind: 'midnight' } }),
  I({ id: 'chips-emerald', name: 'Emerald Casino', description: 'Green clay with gold spots.', category: 'chips', slot: 'chips', price: 350, look: { kind: 'emerald' } }),
  I({ id: 'chips-saloon', name: 'Western Saloon', description: 'Hand-stamped, sun-faded.', category: 'chips', slot: 'chips', price: 500, collection: 'old-west', look: { kind: 'saloon' } }),

  // ---- card backs (your seat's face-down cards; rank and suit are never shown)
  I({ id: 'back-table', name: 'Table Default', description: 'Use the host’s table backs.', category: 'cardBacks', slot: 'cardBack', price: 0, free: true, look: { kind: 'table' } }),
  I({ id: 'back-midnight', name: 'Midnight Card Backs', description: 'Deep navy with silver lattice.', category: 'cardBacks', slot: 'cardBack', price: 350, look: { kind: 'midnight', a: '#1b2a4a', b: '#0d1426' } }),
  I({ id: 'back-deco', name: 'Art Deco Backs', description: 'Gold fans on black.', category: 'cardBacks', slot: 'cardBack', price: 450, collection: 'art-deco', look: { kind: 'deco', a: '#1b1b1f', b: '#c9a45c' } }),
  I({ id: 'back-saloon', name: 'Saloon Backs', description: 'Rope-and-star pattern.', category: 'cardBacks', slot: 'cardBack', price: 350, look: { kind: 'saloon', a: '#7a4a24', b: '#4a2a14' } }),

  // ---- profile backgrounds
  I({ id: 'bg-felt', name: 'Felt', description: 'Table green.', category: 'backgrounds', slot: 'background', price: 0, free: true, look: { kind: 'solid', a: '#145a3e', b: '#0b3b28' } }),
  I({ id: 'bg-walnut', name: 'Walnut', description: 'Rail wood.', category: 'backgrounds', slot: 'background', price: 0, free: true, look: { kind: 'solid', a: '#5a3520', b: '#2e1a0e' } }),
  I({ id: 'bg-strip', name: 'The Strip at Night', description: 'Neon glow behind you.', category: 'backgrounds', slot: 'background', price: 250, look: { kind: 'strip', a: '#2a1446', b: '#e0457b' } }),
  I({ id: 'bg-marquee', name: 'Marquee Lights', description: 'Bulbs and brass.', category: 'backgrounds', slot: 'background', price: 300, collection: 'classic-vegas', look: { kind: 'marquee', a: '#3a1d0e', b: '#f2c25a' } }),
  I({ id: 'bg-desert', name: 'Desert Sunset', description: 'Old West dusk.', category: 'backgrounds', slot: 'background', price: 250, look: { kind: 'desert', a: '#e58a3a', b: '#6d2a4a' } }),

  // ---- emotes (reaction sets)
  I({ id: 'emotes-classic', name: 'Classic Reactions', description: 'Nice hand! Good luck! and friends.', category: 'emotes', slot: 'emotes', price: 0, free: true, look: { kind: 'classic' } }),
  I({ id: 'emotes-vegas', name: 'Vegas Reactions', description: '“Winner winner!”, “Let it ride!”, “Dealer’s hot!”, “Shuffle up!”', category: 'emotes', slot: 'emotes', price: 200, look: { kind: 'vegas' } }),
  I({ id: 'emotes-west', name: 'Saloon Reactions', description: '“Howdy!”, “Well I’ll be!”, “Yeehaw!”, “Tough draw, partner.”', category: 'emotes', slot: 'emotes', price: 200, look: { kind: 'west' } }),

  // ---- victory animations (cosmetic; never change settlement timing)
  I({ id: 'win-standard', name: 'Standard', description: 'The usual glow.', category: 'victory', slot: 'victory', price: 0, free: true, look: { kind: 'standard' } }),
  I({ id: 'win-chipshower', name: 'Gold Chip Shower', description: 'Gold chips tumble past your seat.', category: 'victory', slot: 'victory', price: 400, look: { kind: 'chips' } }),
  I({ id: 'win-sparkle', name: 'Card Sparkle', description: 'Your cards glint.', category: 'victory', slot: 'victory', price: 250, look: { kind: 'sparkle' } }),
  I({ id: 'win-spotlight', name: 'Subtle Spotlight', description: 'A soft light finds you.', category: 'victory', slot: 'victory', price: 250, look: { kind: 'spotlight' } }),
  I({ id: 'win-royal', name: 'Royal Flush Flourish', description: 'Five spades fan out above your seat.', category: 'victory', slot: 'victory', price: 600, rarity: 'rare', look: { kind: 'royal' } }),
  I({ id: 'win-vegas', name: 'Classic Vegas Celebration', description: 'Marquee bulbs blink around your plate.', category: 'victory', slot: 'victory', price: 500, collection: 'classic-vegas', look: { kind: 'vegas' } }),
];

export const REACTION_SETS: Record<string, string[]> = {
  'emotes-classic': ['Nice hand!', 'Good luck!', 'Ouch!', 'Well played!', 'Wow!'],
  'emotes-vegas': ['Winner winner!', 'Let it ride!', 'Dealer’s hot!', 'Shuffle up!', 'Wow!'],
  'emotes-west': ['Howdy!', 'Well I’ll be!', 'Yeehaw!', 'Tough draw, partner.', 'Wow!'],
};

export const COLLECTIONS = [
  { id: 'classic-vegas', name: 'Classic Vegas', reward: 'frame-vegas-bonus', description: 'Black tuxedo, red bow tie, fedora, gold watch, marquee lights.' },
  { id: 'old-west', name: 'Old West Gambler', reward: 'frame-west-bonus', description: 'Cowboy hat, western vest, bolo tie, pocket watch, saloon chips.' },
  { id: 'high-roller', name: 'High Roller', reward: 'frame-hr-bonus', description: 'White dinner jacket, diamond watch, black-and-gold shades, high-roller chips, animated frame.' },
  { id: 'art-deco', name: 'Art Deco', reward: 'frame-deco-bonus', description: 'Sharkskin suit, smoking jacket, deco frame, deco card backs.' },
] as const;

export const ITEM = new Map(CATALOG.map((i) => [i.id, i]));
export const collectionItems = (id: string) => CATALOG.filter((i) => i.collection === id);

// ------------------------------------------------------------------ Style Credits: rewards (non-wagering only)
/**
 * Every way to earn. None depends on wager size, losses, winnings or jackpots. `once` rewards pay one time;
 * `perNight` pays at most once per table night. Amounts are defaults; the server can override them.
 */
export const REWARDS = [
  { id: 'welcome', name: 'Welcome to the casino', description: 'A starter allowance for the Boutique.', credits: 300, once: true },
  { id: 'first-avatar', name: 'Dressed for the occasion', description: 'Save your avatar for the first time.', credits: 50, once: true },
  { id: 'tutorial', name: 'Read the rules', description: 'Open How to Play.', credits: 50, once: true },
  { id: 'trainer', name: 'Explore the trainer', description: 'Turn on Training or Challenge mode.', credits: 50, once: true },
  { id: 'first-hand', name: 'First hand', description: 'Play your first hand.', credits: 100, once: true },
  { id: 'hands-25', name: 'Getting comfortable', description: 'Play 25 hands.', credits: 150, once: true },
  { id: 'hands-100', name: 'Regular', description: 'Play 100 hands.', credits: 300, once: true },
  { id: 'both-games', name: 'Both tables', description: 'Play Ultimate Texas Hold’em and Three Card Poker.', credits: 150, once: true },
  { id: 'game-night', name: 'Game night', description: 'Play a hand at a table with friends.', credits: 100, once: true },
  { id: 'return-night', name: 'Back for more', description: 'Play on a second game night. Unlocks the Regular’s Pin.', credits: 200, once: true },
  { id: 'student', name: 'Student of the game', description: 'Make 20 decisions with 75% or more matching basic strategy. Unlocks Reading Glasses.', credits: 150, once: true },
  { id: 'table-talk', name: 'Table talk', description: 'Send a chat message or reaction at a table.', credits: 25, once: true },
  { id: 'session', name: 'Full session', description: 'Play 10 hands in one game night (once per night).', credits: 50, once: false },
] as const;
export type RewardId = (typeof REWARDS)[number]['id'];
export const REWARD = new Map<string, (typeof REWARDS)[number]>(REWARDS.map((r) => [r.id, r]));

// ------------------------------------------------------------------ outfits
export const OUTFIT_PRESETS = ['casual', 'casino-night', 'custom'] as const;
export type OutfitPreset = (typeof OUTFIT_PRESETS)[number];
export const PRESET_NAME: Record<OutfitPreset, string> = { casual: 'Casual', 'casino-night': 'Casino Night', custom: 'Custom' };

export interface AvatarData { appearance: Appearance; equipped: Equipped; preset: OutfitPreset; outfits: Partial<Record<OutfitPreset, Equipped>> }
export const DEFAULT_EQUIPPED: Equipped = { outfit: 'polo-navy', frame: 'frame-gold', background: 'bg-felt', chips: 'chips-classic', cardBack: 'back-table', emotes: 'emotes-classic', victory: 'win-standard' };
export const DEFAULT_AVATAR: AvatarData = { appearance: DEFAULT_APPEARANCE, equipped: DEFAULT_EQUIPPED, preset: 'casual', outfits: {} };

/** Public part of a player's look, sent to everyone at a table. */
export interface PublicLook { appearance: Appearance; equipped: Equipped }

// ------------------------------------------------------------------ validation
const inList = <T extends readonly unknown[]>(list: T, v: unknown): v is T[number] => list.includes(v as T[number]);
const idx = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;

/** Parse untrusted appearance data. Only enumerated values survive; anything else is rejected. */
export function parseAppearance(x: unknown): Appearance | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (!inList(BODY, a.body) || !idx(a.skin, SKIN.length) || !inList(FACE, a.face) || !inList(EYES, a.eyes) || !idx(a.eyeColor, EYE_COLOR.length)
    || !inList(BROWS, a.brows) || !inList(NOSE, a.nose) || !inList(MOUTH, a.mouth) || !inList(HAIR, a.hair) || !idx(a.hairColor, HAIR_COLOR.length)
    || !inList(FACIAL_HAIR, a.facialHair)) return null;
  return { body: a.body, skin: a.skin as number, face: a.face, eyes: a.eyes, eyeColor: a.eyeColor as number, brows: a.brows, nose: a.nose,
    mouth: a.mouth, hair: a.hair, hairColor: a.hairColor as number, facialHair: a.facialHair };
}

/** Is this item usable without buying? */
export const isFreeItem = (it: Item) => !!it.free;

/**
 * Check an equipped set: every item exists, sits in its own slot, is owned (or free), and is compatible
 * with the outfit. Returns an error message or null.
 */
export function validateEquipped(eq: unknown, owns: (itemId: string) => boolean): string | null {
  if (!eq || typeof eq !== 'object') return 'Invalid outfit.';
  const e = eq as Record<string, unknown>;
  for (const [slot, id] of Object.entries(e)) {
    if (!inList(SLOTS, slot)) return 'Unknown slot.';
    if (id === undefined || id === null || id === '') continue;
    const it = typeof id === 'string' ? ITEM.get(id) : undefined;
    if (!it) return 'Unknown item.';
    if (it.slot !== slot) return `${it.name} doesn’t go in that slot.`;
    if (!isFreeItem(it) && !owns(it.id)) return `You don’t own ${it.name} yet.`;
  }
  const outfit = typeof e.outfit === 'string' ? ITEM.get(e.outfit) : undefined;
  for (const id of Object.values(e)) {
    const it = typeof id === 'string' ? ITEM.get(id) : undefined;
    if (it?.needsCollar && !outfit?.collar) return `${it.name} needs a collared shirt, suit or tuxedo.`;
    if (it?.needsJacket && !outfit?.jacket) return `${it.name} needs a jacket, suit or tuxedo.`;
  }
  return null;
}

/** Drop items that no longer fit after an outfit change (e.g. a bow tie when switching to a tee). */
export function fitEquipped(eq: Equipped): Equipped {
  const out = { ...eq };
  const outfit = out.outfit ? ITEM.get(out.outfit) : undefined;
  for (const [slot, id] of Object.entries(out) as [Slot, string][]) {
    const it = ITEM.get(id);
    if (!it || (it.needsCollar && !outfit?.collar) || (it.needsJacket && !outfit?.jacket)) delete out[slot];
  }
  return out;
}

export function cleanEquipped(eq: unknown): Equipped {
  const out: Equipped = {};
  if (!eq || typeof eq !== 'object') return out;
  for (const [slot, id] of Object.entries(eq as Record<string, unknown>)) {
    if (inList(SLOTS, slot) && typeof id === 'string' && ITEM.get(id)?.slot === slot) out[slot] = id;
  }
  return out;
}

/** Random free appearance (and free clothing), for the Randomize button and new guests. */
export function randomAvatar(rand: () => number = Math.random): { appearance: Appearance; equipped: Equipped } {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const appearance: Appearance = {
    body: pick(BODY), skin: Math.floor(rand() * SKIN.length), face: pick(FACE), eyes: pick(EYES), eyeColor: Math.floor(rand() * EYE_COLOR.length),
    brows: pick(BROWS), nose: pick(NOSE), mouth: pick(MOUTH), hair: pick(HAIR), hairColor: Math.floor(rand() * HAIR_COLOR.length),
    facialHair: rand() < 0.55 ? 'none' : pick(FACIAL_HAIR),
  };
  const free = (slot: Slot) => CATALOG.filter((i) => i.slot === slot && i.free);
  const equipped: Equipped = { ...DEFAULT_EQUIPPED, outfit: pick(free('outfit')).id, frame: 'frame-gold' };
  if (rand() < 0.3) equipped.eyewear = 'glasses-round';
  if (rand() < 0.3) equipped.earrings = 'studs-silver';
  if (rand() < 0.25) equipped.hat = 'cap-green';
  if (rand() < 0.4) equipped.watch = 'watch-steel';
  if (rand() < 0.35 && ITEM.get(equipped.outfit!)?.collar) equipped.neckwear = 'tie-black';
  return { appearance, equipped: fitEquipped(equipped) };
}
