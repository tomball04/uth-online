import { isAttitude, type Attitude } from './roast/meta.js';
// §25 Rotating casino dealers. Presentation only: a dealer's identity never touches the shuffle, the cards,
// strategy, payouts or odds. Every dealer deals exactly the same authoritative game.
//
// Each dealer has ONE appearance definition (§26). Every portrait, pose and expression is rendered from it,
// so a dealer's face, hairstyle and outfit never change between rounds or screens.

import type { Appearance, Equipped, Item } from './cosmetics.js';

/** Dealer-only clothing (rendering only — never sold, never equippable by players). */
export const DEALER_ITEMS: Item[] = ([
  ['dealer-tux', 'tux', '#121216', '#f8f6f0'],
  ['dealer-vest-emerald', 'vest', '#13664a', '#f4f1ea'],
  ['dealer-suit-charcoal', 'suit', '#34373e', '#f4f1ea'],
  ['dealer-vest-plum', 'vest', '#4a2440', '#efe7d6'],
  ['dealer-suit-navy', 'suit3', '#1d2740', '#f4f1ea', '#27334f'],
  ['dealer-blazer-black', 'blazer', '#1b1b1f', '#e9e4da'],
  ['dealer-vest-burgundy', 'vest', '#6d1b2a', '#f4f1ea'],
  ['dealer-vest-blackgold', 'vest', '#141418', '#f4f1ea'],
  ['dealer-shirt-slate', 'shirt', '#5f7286'],
  ['dealer-smoking-deco', 'smoking', '#1d1b26', '#c9a45c'],
  ['dealer-suit-brown', 'suit', '#5a3d2a', '#f2ead9'],
  ['dealer-gown-midnight', 'gown', '#1b2a4a'],
] as const).map(([id, kind, a, b, c]) => ({
  id, name: id, description: '', category: 'clothing', slot: 'outfit', price: 0, rarity: 'standard', available: false,
  collar: kind !== 'gown', jacket: ['tux', 'suit', 'suit3', 'blazer', 'smoking'].includes(kind),
  look: { kind, a, b, c },
} as Item));
DEALER_ITEMS.push(
  { id: 'dealer-tie-gold', name: '', description: '', category: 'facial', slot: 'neckwear', price: 0, rarity: 'standard', available: false, look: { kind: 'bow', a: '#c9a45c' } },
  { id: 'dealer-tie-black', name: '', description: '', category: 'facial', slot: 'neckwear', price: 0, rarity: 'standard', available: false, look: { kind: 'bow', a: '#141418' } },
  { id: 'dealer-name-badge', name: '', description: '', category: 'facial', slot: 'lapel', price: 0, rarity: 'standard', available: false, look: { kind: 'pin', a: '#c9a45c' } },
);

export interface Dealer {
  id: string; name: string; title: string;
  appearance: Appearance; equipped: Equipped;
  /** One line of character, shown on the introduction card. */
  personality: string;
  intro: string; introShort: string;
  /** Short neutral table talk. Never implies luck, streaks, or that a dealer changes the odds. */
  lines: { deal: string[]; wait: string[]; win: string[]; loss: string[]; bigWin: string[]; farewell: string[]; shiftEnd: string[] };
  /** Pitch of the synthesized voice cue (presentation only). */
  voice: number;
}

const A = (a: Partial<Appearance>): Appearance => ({ body: 'broad', skin: 2, face: 'oval', eyes: 'almond', eyeColor: 1, brows: 'soft', nose: 'straight', mouth: 'smile', hair: 'short', hairColor: 1, facialHair: 'none', ...a });

export const DEALERS: Dealer[] = [
  {
    id: 'vincent', name: 'Vincent', title: 'Veteran floor dealer', voice: 0.82,
    appearance: A({ face: 'square', skin: 1, hair: 'slick', hairColor: 6, brows: 'straight', eyes: 'hooded', eyeColor: 4, nose: 'aquiline', mouth: 'smirk', facialHair: 'mustache' }),
    equipped: { outfit: 'dealer-tux', neckwear: 'dealer-tie-black', background: 'bg-walnut', frame: 'frame-gold' },
    personality: 'Thirty years on the Strip. Unhurried, precise, and dry as a martini.',
    intro: 'Evening, everyone. I’m Vincent — I’ve been dealing since before some of these chips were printed. Let’s keep it friendly.',
    introShort: 'Vincent here. Bets when you’re ready.',
    lines: {
      deal: ['Cards are coming around.', 'Here we go.', 'Nice and easy.'], wait: ['Take your time — the chips aren’t going anywhere.', 'Bets when you’re ready.'],
      win: ['Well played.', 'That one’s yours.', 'Pay the winners.'], loss: ['House takes that one.', 'Next hand’s a fresh start.'],
      bigWin: ['Now that’s a hand.', 'Thirty years, and that still makes me smile.'],
      farewell: ['That’s my shift. It’s been a pleasure.'], shiftEnd: ['Time for my break.'],
    },
  },
  {
    id: 'sophia', name: 'Sophia', title: 'Contemporary dealer', voice: 1.12,
    appearance: A({ body: 'narrow', face: 'heart', skin: 0, hair: 'bob', hairColor: 0, brows: 'arched', eyes: 'almond', eyeColor: 2, nose: 'narrow', mouth: 'smile' }),
    equipped: { outfit: 'dealer-vest-emerald', neckwear: 'dealer-tie-gold', earrings: 'studs-silver', background: 'bg-felt', frame: 'frame-gold' },
    personality: 'Calm, quick and exact. Remembers everyone’s name by the second hand.',
    intro: 'Hi, I’m Sophia. I’ll keep things moving and keep the math honest. Good to have you.',
    introShort: 'Sophia’s dealing. Place your bets.',
    lines: {
      deal: ['Dealing.', 'Cards out.', 'Here they come.'], wait: ['Whenever you’re ready.', 'Betting is open.'],
      win: ['Nicely done.', 'Congratulations.'], loss: ['Not this time.', 'That one goes to the house.'],
      bigWin: ['Wow — congratulations!', 'That’s one to remember.'],
      farewell: ['That’s me for now. Thanks, everyone.'], shiftEnd: ['My relief is here.'],
    },
  },
  {
    id: 'marcus', name: 'Marcus', title: 'High-limit host', voice: 0.9,
    appearance: A({ face: 'round', skin: 6, hair: 'buzz', hairColor: 0, brows: 'bold', eyes: 'round', eyeColor: 0, nose: 'broad', mouth: 'grin', facialHair: 'goatee' }),
    equipped: { outfit: 'dealer-suit-charcoal', neckwear: 'tie-black', watch: 'watch-steel', background: 'bg-walnut', frame: 'frame-gold' },
    personality: 'Big laugh, bigger welcome. Treats a $5 bet like a high-roller’s.',
    intro: 'Welcome, welcome! Marcus at your service. Whether it’s five bucks or five thousand, you get the same treatment here.',
    introShort: 'Marcus on the cards. Welcome!',
    lines: {
      deal: ['Here we go, folks!', 'Let’s see some cards.'], wait: ['No rush — get comfortable.', 'Chips down whenever you like.'],
      win: ['There it is!', 'Love to see it.'], loss: ['Tough one. Shake it off.', 'House got that round.'],
      bigWin: ['Whoa! Somebody frame that hand!', 'That’s the stuff stories are made of!'],
      farewell: ['Y’all have been great. Take care!'], shiftEnd: ['That’s my break bell.'],
    },
  },
  {
    id: 'elena', name: 'Elena', title: 'Vintage-room dealer', voice: 1.05,
    appearance: A({ body: 'narrow', face: 'oval', skin: 3, hair: 'bun', hairColor: 2, brows: 'arched', eyes: 'hooded', eyeColor: 1, nose: 'aquiline', mouth: 'smile' }),
    equipped: { outfit: 'dealer-vest-plum', necklace: 'pearls', earrings: 'studs-silver', background: 'bg-marquee', frame: 'frame-gold' },
    personality: 'Old-school elegance. Deals like it’s 1962 and the Sands just opened.',
    intro: 'Good evening. I’m Elena. I learned on a single-deck table downtown, and I still love a well-run game.',
    introShort: 'Elena dealing — good evening.',
    lines: {
      deal: ['Cards, please — here we are.', 'A fresh hand.'], wait: ['Wagers when you’re ready, darlings.', 'The table is open.'],
      win: ['Beautifully done.', 'Bravo.'], loss: ['The house, this time.', 'Next hand, then.'],
      bigWin: ['Magnificent!', 'Now that’s a classic.'],
      farewell: ['A lovely shift. Good night, all.'], shiftEnd: ['My shift has ended.'],
    },
  },
  {
    id: 'james', name: 'James', title: 'Formal dealer', voice: 0.95,
    appearance: A({ face: 'long', skin: 0, hair: 'side-part', hairColor: 3, brows: 'thin', eyes: 'almond', eyeColor: 2, nose: 'narrow', mouth: 'neutral' }),
    equipped: { outfit: 'dealer-suit-navy', neckwear: 'dealer-tie-black', eyewear: 'glasses-round', background: 'bg-felt', frame: 'frame-gold' },
    personality: 'Reserved and meticulous. Says little; misses nothing.',
    intro: 'Good evening. James. I’ll be dealing for the next while.',
    introShort: 'James. Bets, please.',
    lines: {
      deal: ['Dealing.', 'Cards.'], wait: ['Bets, please.', 'Betting is open.'],
      win: ['Well played.', 'Paid.'], loss: ['House.', 'Collected.'],
      bigWin: ['Remarkable. Congratulations.'],
      farewell: ['Thank you. Good evening.'], shiftEnd: ['My shift is complete.'],
    },
  },
  {
    id: 'naomi', name: 'Naomi', title: 'Modern table professional', voice: 1.08,
    appearance: A({ body: 'narrow', face: 'oval', skin: 5, hair: 'braids', hairColor: 0, brows: 'soft', eyes: 'wide', eyeColor: 0, nose: 'button', mouth: 'smile' }),
    equipped: { outfit: 'dealer-blazer-black', earrings: 'hoops-gold', background: 'bg-felt', frame: 'frame-gold' },
    personality: 'Low-key and sharp. Explains a rule once, perfectly.',
    intro: 'Hey everyone, I’m Naomi. If anything about the rules is unclear, just ask — happy to walk through it.',
    introShort: 'Naomi’s in. Bets open.',
    lines: {
      deal: ['Okay, cards.', 'Dealing now.'], wait: ['Bets are open.', 'Take your time.'],
      win: ['Nice one.', 'Paid out.'], loss: ['House gets that one.', 'On to the next.'],
      bigWin: ['That’s huge — congrats!', 'Big one!'],
      farewell: ['That’s my rotation. Have fun, all.'], shiftEnd: ['Rotation time.'],
    },
  },
  {
    id: 'rafael', name: 'Rafael', title: 'Charismatic dealer', voice: 0.98,
    appearance: A({ face: 'square', skin: 3, hair: 'waves', hairColor: 0, brows: 'bold', eyes: 'smiling', eyeColor: 1, nose: 'straight', mouth: 'grin', facialHair: 'stubble' }),
    equipped: { outfit: 'dealer-vest-burgundy', neckwear: 'dealer-tie-gold', watch: 'watch-gold', background: 'bg-strip', frame: 'frame-gold' },
    personality: 'All charm. Keeps the table laughing without ever slowing the game.',
    intro: '¡Buenas noches! Rafael here. Good company, good cards, good conversation — that’s the plan.',
    introShort: 'Rafael on deck — let’s have fun.',
    lines: {
      deal: ['Here comes the good stuff.', 'Cards in the air!'], wait: ['Bets, my friends.', 'Take a breath, place a bet.'],
      win: ['¡Eso! Well played.', 'Beautiful.'], loss: ['Ah, close one.', 'House this round.'],
      bigWin: ['¡Increíble! What a hand!', 'Somebody call the band!'],
      farewell: ['Gracias, everyone — what a table.'], shiftEnd: ['My time’s up, amigos.'],
    },
  },
  {
    id: 'claire', name: 'Claire', title: 'Classic house dealer', voice: 1.1,
    appearance: A({ body: 'narrow', face: 'round', skin: 1, hair: 'ponytail', hairColor: 4, brows: 'soft', eyes: 'round', eyeColor: 3, nose: 'button', mouth: 'smile' }),
    equipped: { outfit: 'dealer-vest-blackgold', neckwear: 'dealer-tie-gold', lapel: 'dealer-name-badge', background: 'bg-walnut', frame: 'frame-gold' },
    personality: 'Bright and by-the-book. The black-and-gold uniform is always pressed.',
    intro: 'Hello and welcome! I’m Claire. Let’s have a great game.',
    introShort: 'Claire dealing. Welcome!',
    lines: {
      deal: ['Good luck, everyone.', 'Cards are out.'], wait: ['Bets are open!', 'Place your wagers.'],
      win: ['Congratulations!', 'Winner!'], loss: ['House wins that one.', 'On to the next hand.'],
      bigWin: ['Oh wow — congratulations!'],
      farewell: ['Thanks for playing with me!'], shiftEnd: ['Time to swap out.'],
    },
  },
  {
    id: 'andre', name: 'Andre', title: 'Relaxed modern dealer', voice: 0.88,
    appearance: A({ face: 'oval', skin: 7, hair: 'afro', hairColor: 0, brows: 'straight', eyes: 'almond', eyeColor: 0, nose: 'broad', mouth: 'smirk', facialHair: 'full' }),
    equipped: { outfit: 'dealer-shirt-slate', watch: 'watch-steel', background: 'bg-felt', frame: 'frame-gold' },
    personality: 'Easygoing, polished, never rattled. Knows every regular’s order at the bar.',
    intro: 'What’s up, everyone. Andre. Relax, enjoy it — I’ll handle the cards.',
    introShort: 'Andre here. Easy does it.',
    lines: {
      deal: ['Alright, cards.', 'Here we go.'], wait: ['No pressure.', 'Bets whenever.'],
      win: ['Nice.', 'There you go.'], loss: ['House on that one.', 'It happens.'],
      bigWin: ['Okay, that’s big. Respect.'],
      farewell: ['Good playing with y’all. Later.'], shiftEnd: ['That’s my cue.'],
    },
  },
  {
    id: 'victoria', name: 'Victoria', title: 'Art Deco salon dealer', voice: 1.0,
    appearance: A({ body: 'narrow', face: 'long', skin: 2, hair: 'waves', hairColor: 8, brows: 'arched', eyes: 'hooded', eyeColor: 3, nose: 'narrow', mouth: 'smirk' }),
    equipped: { outfit: 'dealer-smoking-deco', earrings: 'hoops-gold', necklace: 'chain-gold', background: 'bg-marquee', frame: 'frame-deco' },
    personality: 'Refined, witty, a little theatrical — in the best Jazz Age way.',
    intro: 'Good evening, darlings. Victoria. Let’s make this the most elegant table in the house.',
    introShort: 'Victoria presiding. Wagers, please.',
    lines: {
      deal: ['And… the cards.', 'Allow me.'], wait: ['Wagers, if you please.', 'The floor is yours.'],
      win: ['Splendid.', 'How delightful.'], loss: ['The house, I’m afraid.', 'Alas.'],
      bigWin: ['Simply spectacular!'],
      farewell: ['It’s been divine. Farewell, darlings.'], shiftEnd: ['My curtain call.'],
    },
  },
  {
    id: 'daniel', name: 'Daniel', title: 'Warm table host', voice: 0.93,
    appearance: A({ face: 'round', skin: 4, hair: 'curly', hairColor: 6, brows: 'soft', eyes: 'smiling', eyeColor: 1, nose: 'straight', mouth: 'smile', facialHair: 'full' }),
    equipped: { outfit: 'dealer-suit-brown', neckwear: 'tie-green', eyewear: 'glasses-reading', background: 'bg-walnut', frame: 'frame-gold' },
    personality: 'Grandfatherly and patient. Happy to explain anything twice.',
    intro: 'Hello there, I’m Daniel. Pull up a chair — and don’t hesitate to ask me anything about the game.',
    introShort: 'Daniel dealing. Welcome in.',
    lines: {
      deal: ['Here we go, then.', 'Cards coming.'], wait: ['Take all the time you need.', 'Bets when you’re ready, friends.'],
      win: ['Well done, well done.', 'That’s a nice hand.'], loss: ['Ah, not this time.', 'The house has it.'],
      bigWin: ['My goodness — congratulations!'],
      farewell: ['Thank you kindly. Enjoy your evening.'], shiftEnd: ['Time for my break, friends.'],
    },
  },
  {
    id: 'isabella', name: 'Isabella', title: 'Luxury salon dealer', voice: 1.15,
    appearance: A({ body: 'narrow', face: 'heart', skin: 4, hair: 'long', hairColor: 0, brows: 'arched', eyes: 'almond', eyeColor: 5, nose: 'straight', mouth: 'smile' }),
    equipped: { outfit: 'dealer-gown-midnight', necklace: 'pearls', earrings: 'hoops-gold', background: 'bg-strip', frame: 'frame-diamond' },
    personality: 'Poised and gracious. Makes every table feel like the private salon.',
    intro: 'Welcome to my table. I’m Isabella. Sit back, settle in — you’re in good hands.',
    introShort: 'Isabella dealing. Welcome.',
    lines: {
      deal: ['Cards are on their way.', 'Dealing.'], wait: ['Your wagers, please.', 'The table is yours.'],
      win: ['Lovely.', 'Congratulations.'], loss: ['The house, this round.', 'Next hand.'],
      bigWin: ['Extraordinary — congratulations!'],
      farewell: ['Thank you for a wonderful shift.'], shiftEnd: ['My shift is over.'],
    },
  },
];

export const DEALER = new Map(DEALERS.map((d) => [d.id, d]));
export const isDealerId = (x: unknown): x is string => typeof x === 'string' && DEALER.has(x);

// ------------------------------------------------------------------ host settings
export type DealerIntro = 'full' | 'short' | 'off';
export type DealerChatter = 'often' | 'normal' | 'rare' | 'off';
export const ROTATE_EVERY = [10, 25, 50, 100] as const;
export interface DealerSettings {
  rotate: boolean;
  every: (typeof ROTATE_EVERY)[number];
  majorWins: boolean;
  /** A hand's net profit at or above max(majorMin, majorMultiple × that player's opening wager) is a major win. Cents. */
  majorMin: number;
  majorMultiple: number;
  /** A progressive payout at or above this is a major win. Cents. */
  progressiveMin: number;
  intro: DealerIntro;
  chatter: DealerChatter;
  /** Dealer voice cue volume, 0–100 (each player's own sound settings still apply on top). */
  volume: number;
  /** §32 Dealer Attitude: the table's maximum roast intensity. Each player can lower it for themselves. */
  attitude: Attitude;
}
export const DEFAULT_DEALER_SETTINGS: DealerSettings = {
  rotate: true, every: 25, majorWins: true, majorMin: 250_000, majorMultiple: 100, progressiveMin: 1_000_000,
  intro: 'full', chatter: 'normal', volume: 70, attitude: 'smartass',
};
export const CHATTER_RATE: Record<DealerChatter, number> = { often: 0.7, normal: 0.35, rare: 0.12, off: 0 };

/** Validate untrusted settings, starting from `base`. Throws a user-facing Error. */
export function parseDealerSettings(p: unknown, base: DealerSettings = DEFAULT_DEALER_SETTINGS): DealerSettings {
  const i = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const out = { ...base };
  const int = (v: unknown, lo: number, hi: number, what: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${what}.`);
    return v;
  };
  if (i.rotate !== undefined) out.rotate = !!i.rotate;
  if (i.every !== undefined) { if (!ROTATE_EVERY.includes(i.every as never)) throw new Error('Rotate every 10, 25, 50 or 100 rounds.'); out.every = i.every as DealerSettings['every']; }
  if (i.majorWins !== undefined) out.majorWins = !!i.majorWins;
  if (i.majorMin !== undefined) { out.majorMin = int(i.majorMin, 10_000, 1_000_000_000, 'major-win amount'); if (out.majorMin % 100) throw new Error('Major-win amount must be whole dollars.'); }
  if (i.majorMultiple !== undefined) out.majorMultiple = int(i.majorMultiple, 5, 10_000, 'major-win multiple');
  if (i.progressiveMin !== undefined) { out.progressiveMin = int(i.progressiveMin, 10_000, 1_000_000_000, 'progressive amount'); if (out.progressiveMin % 100) throw new Error('Progressive amount must be whole dollars.'); }
  if (i.intro !== undefined) { if (!['full', 'short', 'off'].includes(i.intro as string)) throw new Error('Unknown introduction style.'); out.intro = i.intro as DealerIntro; }
  if (i.chatter !== undefined) { if (!(i.chatter as string in CHATTER_RATE)) throw new Error('Unknown dialogue setting.'); out.chatter = i.chatter as DealerChatter; }
  if (i.volume !== undefined) out.volume = int(i.volume, 0, 100, 'dealer volume');
  if (i.attitude !== undefined) { if (!isAttitude(i.attitude)) throw new Error('Unknown dealer attitude.'); out.attitude = i.attitude; }
  return out;
}

/** Is this settled result a major win under these settings? Uses settled nets only. */
export function isMajorWin(s: DealerSettings, net: number, openingWager: number): boolean {
  return s.majorWins && net > 0 && net >= Math.max(s.majorMin, s.majorMultiple * openingWager);
}

/** Pick the next dealer: anyone but the current one. `rand` is a cosmetic source, never the shuffle. */
export function nextDealer(current: string | null, rand: (n: number) => number): string {
  const pool = DEALERS.filter((d) => d.id !== current);
  return pool[rand(pool.length)].id;
}
