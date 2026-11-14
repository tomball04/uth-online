// Unit tests, one section per area (rules, evaluator, strategy, side bets, chips, roast library …).
import { describe, expect, it } from 'vitest';
import { DEFAULT_BJ_RULES as R, bjActionEVs, bjAdvice, bjEvCost, dealerPlay, describeTotal, insuranceEvCost, isNatural, legalActions, newHand, settleHand, settleInsurance, total } from '../../src/shared/blackjack';
import { type Appearance, CATALOG, COLLECTIONS, DEFAULT_APPEARANCE, FACE, FACIAL_HAIR, HAIR, ITEM, REWARDS, SLOTS, fitEquipped, ownsItem, parseAppearance, randomAvatar, validateEquipped } from '../../src/shared/cosmetics';
import { EXPRESSIONS, HEAD, renderAvatar, renderItemPreview } from '../../src/shared/avatarSvg';
import { Cosmetics } from '../../src/server/cosmetics';
import { MemoryStore } from '../../src/server/memoryStore';
import { readFileSync } from 'node:fs';
import { CHIP_COLLECTIONS, DENOMS, DENOM_LABEL, chipBreakdown, chipCollectionFor, chipItemId, parseChipItem, renderChip } from '../../src/shared/chips';
import { DEBT_JOKES, PAWN_ITEMS, PAWN_TIERS, debtJoke, debtLine, pawnFor, pawnTier, randomPawn } from '../../src/shared/debt';
import { cardToInt, intToCard } from '../../src/shared/cards';
import { bestFive, categoryOf, evaluate, handName } from '../../src/shared/evaluator';
import { NO_BETS, formatMoney, requiredToStart, settle, settleCards, settlePairs, validateInitialBet } from '../../src/shared/rules';
import { dealerOuts, flopAdvice, flopEV, improvementOuts, mistakeCost, outsFor, preflopAdvice, preflopEV, riverAdvice } from '../../src/shared/strategy';
import { PROGRESSIVE, progressiveHand, resolveProgressive } from '../../src/shared/progressive';
import { type QDecision, type QHand, classify, currentSession, matches, summarize } from '../../src/shared/quality';
import { type NightHand, type NightHandPlayer, buildRecap } from '../../src/shared/recap';
import { LINE, LINES, ROAST_DEALERS, contentReport, linesFor } from '../../src/shared/roast/library';
import { CONTENT } from '../../src/shared/roast/lines';
import { BONUS, CATEGORIES, EXTRA, FACTS, PRIMARY, type RoastPayload } from '../../src/shared/roast/meta';
import { cleanText, fill, profanityOf } from '../../src/shared/roast/render';
import { viewRoast } from '../../src/shared/roast/view';
import { RoastDirector, type RoundFacts, type RoundPlayer, grudgePhrase } from '../../src/server/roast';
import { type DecisionRecord, musicPosition, parseMusicNow } from '../../src/shared/protocol';
import { BAD_BEAT_VARIANTS, PAIRS_VARIANTS, evaluatePairs, previewPairs } from '../../src/shared/sidebets';
import { ANTE_BONUS, PAIR_PLUS, SIX_CARD, evaluate3, settleTcp, tcpBasicPlay, tcpExactEV, tcpHandName, tcpQualifies } from '../../src/shared/tcp';

// ==================================================================== blackjack.test.ts
describe('blackjack', () => {
  const c = (s: string) => s.split(' ');
  describe('§27 blackjack totals', () => {
    it('hard, soft and multiple aces', () => {
      expect(total(c('As Ad'))).toEqual({ total: 12, soft: true, bust: false });
      expect(total(c('As Ad Ah Ac'))).toEqual({ total: 14, soft: true, bust: false });
      expect(total(c('As Ad Ah Ac 7s'))).toEqual({ total: 21, soft: true, bust: false });
      expect(total(c('As Ad Ah Ac 7s Kd'))).toEqual({ total: 21, soft: false, bust: false });
      expect(total(c('Ks Qd 5h'))).toEqual({ total: 25, soft: false, bust: true });
      expect(total(c('As 6d'))).toMatchObject({ total: 17, soft: true });
      expect(describeTotal(c('As 6d'))).toBe('Soft 17');
      expect(describeTotal(c('As Kd'))).toBe('Blackjack');
      expect(describeTotal(c('As Kd'), true)).toBe('21');                 // 21 after a split is not a blackjack
      expect(isNatural(c('As Kd'), true)).toBe(false);
      expect(isNatural(c('7s 7d 7h'), false)).toBe(false);
    });
    it('dealer stands on soft 17 and hits 16', () => {
      const deck = ['5c', 'Kd'];
      expect(dealerPlay(c('As 6d'), () => deck.shift()!, R)).toEqual(c('As 6d'));
      expect(dealerPlay(c('Ts 6d'), () => '5c', R)).toEqual(c('Ts 6d 5c'));
      expect(dealerPlay(c('As 6d'), () => '2c', { ...R, h17: true })).toEqual(c('As 6d 2c'));
      const draws = ['As', '3c'];
      expect(dealerPlay(c('2s 3d'), () => draws.shift()!, R)).toEqual(c('2s 3d As 3c'));   // 5 → soft 16 → hard 19... 2+3+A=16 soft, +3 = 19
    });
  });

  describe('§27 settlement is exact', () => {
    const D = (s: string) => c(s);
    it('3:2 blackjack, including on $1 (no rounding)', () => {
      expect(settleHand(newHand(c('As Kd'), 100), D('9s 8d'), R)).toMatchObject({ outcome: 'blackjack', credit: 250, net: 150 });
      expect(settleHand(newHand(c('As Kd'), 2500), D('9s 8d'), R)).toMatchObject({ net: 3750 });
    });
    it('double blackjack pushes; dealer blackjack beats 21 and everything else', () => {
      expect(settleHand(newHand(c('As Kd'), 1000), D('Ah Qc'), R)).toMatchObject({ outcome: 'push', net: 0 });
      expect(settleHand(newHand(c('7s 7d 7h'), 1000), D('Ah Qc'), R)).toMatchObject({ outcome: 'lose', net: -1000 });
    });
    it('busts lose even if the dealer busts; dealer bust pays live hands; ties push', () => {
      expect(settleHand(newHand(c('Ks Qd 5h'), 1000), D('Ts 6d 9c'), R)).toMatchObject({ outcome: 'bust', net: -1000 });
      expect(settleHand(newHand(c('Ks 2d'), 1000), D('Ts 6d 9c'), R)).toMatchObject({ outcome: 'win', net: 1000 });
      expect(settleHand(newHand(c('Ks 8d'), 1000), D('Ts 8c'), R)).toMatchObject({ outcome: 'push', net: 0 });
      expect(settleHand(newHand(c('Ks 7d'), 1000), D('Ts 8c'), R)).toMatchObject({ outcome: 'lose', net: -1000 });
    });
    it('split 21 pays 1:1; doubles pay on the doubled bet; surrender returns half', () => {
      expect(settleHand(newHand(c('As Kd'), 1000, true), D('9s 8d'), R)).toMatchObject({ outcome: 'win', net: 1000 });
      expect(settleHand({ ...newHand(c('6s 5d Kd'), 2000), doubled: true }, D('9s 8d'), R)).toMatchObject({ outcome: 'win', net: 2000 });
      expect(settleHand({ ...newHand(c('Ts 6d'), 1000), surrendered: true }, D('9s 8d'), R)).toMatchObject({ outcome: 'surrender', credit: 500, net: -500 });
    });
    it('insurance pays 2:1 only against a dealer blackjack', () => {
      expect(settleInsurance(500, c('As Kd'))).toEqual({ credit: 1500, net: 1000 });
      expect(settleInsurance(500, c('As 9d'))).toEqual({ credit: 0, net: -500 });
    });
  });

  describe('§27 legal actions', () => {
    it('double and split need the money and the right cards', () => {
      expect(legalActions(newHand(c('8s 8d'), 1000), 1, R, true)).toEqual(['hit', 'stand', 'double', 'split']);
      expect(legalActions(newHand(c('8s 8d'), 1000), 1, R, false)).toEqual(['hit', 'stand']);
      expect(legalActions(newHand(c('8s 8d'), 1000), 4, R, true)).toEqual(['hit', 'stand', 'double']);          // four-hand maximum
      expect(legalActions(newHand(c('8s 8d 2c'), 1000), 1, R, true)).toEqual(['hit', 'stand']);
      expect(legalActions(newHand(c('Ks Qd'), 1000), 1, R, true)).toContain('split');                          // any two tens
      expect(legalActions(newHand(c('As 8d'), 1000, true, true), 2, R, true)).toEqual([]);                    // split aces: one card
      expect(legalActions(newHand(c('As Ad'), 1000, true), 2, R, true)).not.toContain('split');               // no resplitting aces
      expect(legalActions(newHand(c('6s 5d'), 1000, true), 2, R, true)).toContain('double');                  // double after split
      expect(legalActions(newHand(c('6s 5d'), 1000, true), 2, { ...R, doubleAfterSplit: false }, true)).not.toContain('double');
      expect(legalActions(newHand(c('Ts 6d'), 1000), 1, R, true)).not.toContain('surrender');                 // off by default
      expect(legalActions(newHand(c('Ts 6d'), 1000), 1, { ...R, lateSurrender: true }, true)).toContain('surrender');
      expect(legalActions(newHand(c('As Kd'), 1000), 1, R, true)).toEqual([]);                                // natural: nothing to do
    });
  });

  describe('§27 basic strategy (6 decks, S17, DAS)', () => {
    const adv = (cards: string, up: string, rules = R, afford = true, fromSplit = false) => {
      const h = newHand(c(cards), 1000, fromSplit);
      return bjAdvice(h, up, legalActions(h, 1, rules, afford), rules);
    };
    const cases: [string, string, string][] = [
      ['Ts 6d', 'Ts', 'hit'], ['Ts 6d', '6c', 'stand'], ['Ts 2d', '3c', 'hit'], ['Ts 2d', '4c', 'stand'],
      ['6s 5d', 'Ad', 'hit'], ['6s 5d', 'Td', 'double'], ['5s 4d', '2d', 'hit'], ['5s 4d', '3d', 'double'],
      ['As 7d', '2c', 'stand'], ['As 7d', '3c', 'double'], ['As 7d', '9c', 'hit'], ['As 8d', '6c', 'stand'],
      ['As 2d', '5c', 'double'], ['As 2d', '4c', 'hit'],
      ['8s 8d', 'Ac', 'split'], ['As Ad', 'Tc', 'split'], ['Ts Td', '6c', 'stand'], ['9s 9d', '7c', 'stand'], ['9s 9d', '8c', 'split'],
      ['5s 5d', '9c', 'double'], ['4s 4d', '5c', 'split'], ['4s 4d', '4c', 'hit'], ['2s 2d', '2c', 'split'], ['6s 6d', '2c', 'split'], ['7s 7d', '8c', 'hit'],
    ];
    for (const [cards, up, want] of cases) it(`${cards} vs ${up}: ${want}`, () => expect(adv(cards, up).best).toBe(want));
    it('surrender only when the rules allow it', () => {
      expect(adv('Ts 6d', 'Ts', { ...R, lateSurrender: true }).best).toBe('surrender');
      expect(adv('Ts 5d', 'Ts', { ...R, lateSurrender: true }).best).toBe('surrender');
      expect(adv('Ts 5d', '9s', { ...R, lateSurrender: true }).best).toBe('hit');
    });
    it('no DAS: 2-2 vs 2 hits instead of splitting', () => expect(adv('2s 2d', '2c', { ...R, doubleAfterSplit: false }).best).toBe('hit'));
    it('can’t afford the ideal double or split: plays the best available, and the decision is marked constrained', () => {
      const a = adv('6s 5d', 'Td', R, false);
      expect(a).toMatchObject({ ideal: 'double', best: 'hit', constrained: true });
      expect(adv('8s 8d', 'Tc', R, false)).toMatchObject({ ideal: 'split', best: 'hit', constrained: true });
    });
  });
});

// ==================================================================== borders.test.ts
// §29 animated borders: distinct, priced, owned server-side, cosmetic only.
describe('borders', () => {
  const borders = CATALOG.filter((i) => i.category === 'borders');
  const strip = (s: string) => s.replace(/(#|id=")[a-z]+[0-9a-z]*/g, '$1x');

  describe('§29 animated borders', () => {
    it('there are 15, each a distinct animation, with price tiers', () => {
      expect(borders).toHaveLength(15);
      const svgs = borders.map((b) => strip(renderAvatar({ appearance: DEFAULT_APPEARANCE, equipped: { frame: b.id } }, { frame: true })));
      expect(new Set(svgs).size).toBe(15);
      for (const s of svgs) expect(s).toMatch(/class="bx[ "]/);
      for (const s of svgs) expect(s).toMatch(/bx-(spin|pulse|flicker|twinkle|chase|smoke|wave|flame|arc|seq|bob)/);
      const tiers = new Set(borders.map((b) => b.rarity));
      expect([...tiers].sort()).toEqual(['fine', 'legendary', 'rare', 'standard']);
      expect(Math.min(...borders.map((b) => b.price))).toBeGreaterThan(0);
      for (const b of borders) expect(['light', 'medium']).toContain((b as any).perf);
    });
    it('previews render for the Boutique and contain no scripts or external references', () => {
      for (const b of borders) {
        const s = renderItemPreview(b.id);
        expect(s).toContain('<svg');
        expect(s).not.toMatch(/<script|href="http|on[a-z]+=/i);
      }
    });
    it('buying needs enough Style Credits, never chips; owned borders equip; unowned are rejected', async () => {
      const store = new MemoryStore();
      const c = new Cosmetics(store, { rewards: { welcome: 600 } });
      await c.welcome('p');
      await expect(c.buy('p', 'border-diamond-crown', 'key-aaaaaaaa')).rejects.toThrow(/Not enough Style Credits/);
      expect((await store.getCosmetics('p')).balance).toBe(600);
      const save = (frame: string) => c.save('p', { appearance: DEFAULT_APPEARANCE, equipped: { frame }, preset: 'custom', outfits: {} });
      await expect(save('border-golden-halo')).rejects.toThrow();
      const r = await c.buy('p', 'border-golden-halo', 'key-bbbbbbbb');
      expect(r.status).toBe('ok');
      expect((await c.buy('p', 'border-golden-halo', 'key-bbbbbbbb')).status).not.toBe('insufficient');  // retry: no double charge
      expect((await store.getCosmetics('p')).balance).toBe(250);
      expect((await save('border-golden-halo')).equipped.frame).toBe('border-golden-halo');
    });
    it('settlement code never reads cosmetics', () => {
      for (const f of ['rules', 'blackjack', 'tcp', 'sidebets', 'progressive', 'evaluator']) {
        expect(readFileSync(`src/shared/${f}.ts`, 'utf8')).not.toMatch(/cosmetics|avatarSvg|frame/);
      }
    });
  });
});

// ==================================================================== character.test.ts
// §26 character consistency: one appearance definition drives every render; hair geometry never changes with
// pose, expression, hat, size or context.
describe('character', () => {
  const look = (a: Partial<Appearance>, eq: Record<string, string> = { outfit: 'shirt-white' }) => ({ appearance: { ...DEFAULT_APPEARANCE, ...a }, equipped: eq });
  /** The inner geometry of a layer, with ids and transforms stripped. */
  const layer = (svg: string, cls: string) => {
    const m = svg.match(new RegExp(`<g class="${cls}"[^>]*>(.*?)</g></g>`));
    return m ? m[1].replace(/ clip-path="url\(#[^)]+\)"/g, '') : null;
  };
  const tf = (svg: string, cls: string) => svg.match(new RegExp(`<g class="${cls}"[^>]* transform="([^"]+)"`))?.[1];

  describe('§26 hair geometry is fixed per style', () => {
    it('is identical across every expression and pose', () => {
      for (const hair of HAIR) {
        const ref = renderAvatar(look({ hair }), { id: 'r' });
        for (const expression of EXPRESSIONS) {
          const s = renderAvatar(look({ hair }), { id: 'r', expression });
          expect(layer(s, 'hair-front'), `${hair}/${expression}`).toBe(layer(ref, 'hair-front'));
          expect(layer(s, 'hair-back')).toBe(layer(ref, 'hair-back'));
          expect(tf(s, 'hair-front')).toBe(tf(ref, 'hair-front'));
        }
        for (const pose of ['left', 'right'] as const) {
          const s = renderAvatar(look({ hair }), { id: 'r', pose });
          expect(layer(s, 'hair-front')).toBe(layer(ref, 'hair-front'));      // same shape; only the head turns
          expect(layer(s, 'hair-back')).toBe(layer(ref, 'hair-back'));
        }
      }
    });
    it('is identical under every hat — the hat hides hair above its line, it never reshapes it', () => {
      for (const hair of HAIR) for (const hat of ['fedora-black', 'cowboy-brown', 'cap-casino', 'visor-dealer']) {
        const s = renderAvatar(look({ hair }, { outfit: 'polo-navy', hat }), { id: 'h' });
        expect(layer(s, 'hair-front'), `${hair}+${hat}`).toBe(layer(renderAvatar(look({ hair }, { outfit: 'polo-navy' }), { id: 'h' }), 'hair-front'));
        expect(s.indexOf('class="hat"')).toBeGreaterThan(s.indexOf('class="hair-front"'));   // hat drawn above hair
      }
    });
    it('fits the same geometry to each face shape with one transform', () => {
      for (const hair of HAIR) {
        const shapes = FACE.map((face) => layer(renderAvatar(look({ face, hair }), { id: 'f' }), 'hair-front'));
        expect(new Set(shapes).size, hair).toBe(1);
      }
      for (const face of FACE) {
        const t = tf(renderAvatar(look({ face }), { id: 'f' }), 'hair-front')!;
        expect(t).toContain(`scale(${Math.round((HEAD[face].w / 17) * 1000) / 1000} 1)`);
      }
    });
    it('draws long and tied-back hair behind the shoulders and clothing, in the same head turn', () => {
      for (const hair of ['long', 'bob', 'braids', 'ponytail', 'afro', 'bun'] as const) {
        const s = renderAvatar(look({ hair }), { pose: 'left', id: 'b' });
        const back = s.indexOf('class="hair-back"'), torso = s.indexOf('M44 58 L44 71');           // neck starts the torso layer
        expect(back, hair).toBeGreaterThan(-1);
        expect(back).toBeLessThan(torso);
        expect(tf(s, 'hair-back')!.startsWith('rotate(-4 50 60)')).toBe(true);
        expect(tf(s, 'head')).toBe('rotate(-4 50 60)');
      }
    });
    it('facial hair is fitted to the jaw of each face', () => {
      for (const face of FACE) for (const facialHair of FACIAL_HAIR.filter((f) => f !== 'none')) {
        const s = renderAvatar(look({ face, facialHair }), { id: 'j' });
        expect(s).toContain('class="facial-hair"');
        expect(tf(s, 'facial-hair')).toContain(`scale(${Math.round((HEAD[face].w / 17) * 1000) / 1000} ${Math.round(((HEAD[face].chin - 44) / 21) * 1000) / 1000})`);
      }
    });
    it('is deterministic: the same data renders the same SVG every time, at any size', () => {
      const l = look({ hair: 'curly', face: 'heart', facialHair: 'goatee' }, { outfit: 'tux-black', hat: 'fedora-black', frame: 'frame-gold' });
      expect(renderAvatar(l, { id: 'd' })).toBe(renderAvatar(l, { id: 'd' }));
      expect(renderAvatar(l, { id: 'd', crop: 'face' }).replace(/viewBox="[^"]+"/, '')).toBe(renderAvatar(l, { id: 'd' }).replace(/viewBox="[^"]+"/, ''));
    });
  });
});

// ==================================================================== chips.test.ts
describe('chips', () => {
  describe('§28 chips', () => {
    it('nine denominations from $1 to the $100,000 plaque', () => {
      expect(DENOMS.map((d) => d / 100)).toEqual([1, 5, 25, 100, 500, 1000, 5000, 25000, 100000]);
    });
    it('15 collections × 9 denominations = 135 designs, every one with a legible value and no scripts', () => {
      expect(CHIP_COLLECTIONS).toHaveLength(15);
      const all = new Set<string>();
      for (const c of CHIP_COLLECTIONS) for (const d of DENOMS) {
        const svg = renderChip(d, c.id).replace(/(#|id=")ch[0-9a-z]+/g, '$1ID');
        expect(svg).toContain(`>${DENOM_LABEL[d]}</text>`);
        expect(svg).toMatch(/aria-label="\$[\d,]+ (chip|plaque)"/);
        expect(svg).not.toMatch(/<script|on[a-z]+=|href=/i);
        all.add(svg);
      }
      expect(all.size).toBe(135);
      // each collection looks different from the others at the same value
      for (const d of DENOMS) expect(new Set(CHIP_COLLECTIONS.map((c) => renderChip(d, c.id).replace(/(#|id=")ch[0-9a-z]+/g, '$1ID'))).size).toBe(15);
    });
    it('catalog: a set and nine singles per collection; the set unlocks its singles', () => {
      for (const c of CHIP_COLLECTIONS) {
        expect(ITEM.get(c.setId)?.slot).toBe('chips');
        for (const d of DENOMS) expect(ITEM.get(chipItemId(c.id, d))).toMatchObject({ chipOf: c.setId });
      }
      expect(CATALOG.filter((i) => i.category === 'chips')).toHaveLength(150);
      expect(ownsItem(new Set(['chips-neon']), 'chip-neon-500')).toBe(true);
      expect(ownsItem(new Set(['chip-neon-500']), 'chip-neon-25')).toBe(false);
      expect(ownsItem(new Set(), 'chip-classic-25')).toBe(true);           // Classic is free
      expect(validateEquipped({ c500: 'chip-neon-500' }, (id) => id === 'chips-neon')).toBeNull();
      expect(validateEquipped({ c500: 'chip-neon-25' }, () => true)).toMatch(/slot/);   // a $25 design can't sit in the $500 slot
      expect(validateEquipped({ c500: 'chip-neon-500' }, () => false)).toMatch(/own/);
    });
    it('values come from numbers, never designs; huge amounts are a handful of chips/plaques', () => {
      expect(parseChipItem('chip-diamond-500')).toEqual({ col: 'diamond', d: 50_000 });
      expect(chipCollectionFor({ chips: 'chips-neon', c500: 'chip-diamond-500' }, 50_000)).toBe('diamond');
      expect(chipCollectionFor({ chips: 'chips-neon' }, 2_500)).toBe('neon');
      expect(chipBreakdown(1_234_500, 5)).toEqual([500_000, 500_000, 100_000, 100_000, 10_000]);   // $12,345 → five chips, no more
      expect(chipBreakdown(987_654_321_00, 5).length).toBeLessThanOrEqual(5);
      expect(chipBreakdown(987_654_321_00, 5)[0]).toBe(10_000_000);
    });
  });
});

// ==================================================================== cosmetics.test.ts
describe('cosmetics', () => {
  describe('§24 catalog', () => {
    it('has unique ids, valid slots and whole-credit prices', () => {
      expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
      for (const i of CATALOG) {
        expect(SLOTS).toContain(i.slot);
        expect(Number.isInteger(i.price) && i.price >= 0).toBe(true);
        if (i.free) expect(i.price).toBe(0);
      }
    });
    it('includes the addendum’s example items at the example prices', () => {
      const want: [string, number][] = [['Classic Black Fedora', 150], ['Gold-Rimmed Sunglasses', 200], ['Burgundy Bow Tie', 100], ['Three-Piece Casino Suit', 400],
        ['Gold Watch', 300], ['Diamond Avatar Frame', 750], ['Vintage Poker Chip Set', 500], ['Midnight Card Backs', 350], ['Animated Royal Flush Frame', 1500]];
      for (const [name, price] of want) expect(CATALOG.find((i) => i.name === name)?.price, name).toBe(price);
    });
    it('every collection has items and an earn-only reward item', () => {
      for (const c of COLLECTIONS) {
        expect(CATALOG.filter((i) => i.collection === c.id).length).toBeGreaterThanOrEqual(4);
        expect(ITEM.get(c.reward)?.unlock).toBe(`collection:${c.id}`);
      }
    });
    it('has free basics in every wearable slot so nobody has to buy anything', () => {
      for (const slot of ['outfit', 'hat', 'eyewear', 'earrings', 'watch', 'neckwear', 'frame', 'background', 'chips', 'cardBack', 'emotes', 'victory'] as const)
        expect(CATALOG.some((i) => i.slot === slot && i.free), slot).toBe(true);
    });
    it('rewards never mention wagers, wins, losses or jackpots', () => {
      for (const r of REWARDS) expect(`${r.name} ${r.description}`).not.toMatch(/\b(wager|bet size|profit|won|win \$|loss|jackpot|progressive)\b/i);
    });
  });

  describe('appearance and outfit validation', () => {
    it('accepts only enumerated values', () => {
      expect(parseAppearance(DEFAULT_APPEARANCE)).toEqual(DEFAULT_APPEARANCE);
      expect(parseAppearance({ ...DEFAULT_APPEARANCE, hair: '<script>alert(1)</script>' })).toBeNull();
      expect(parseAppearance({ ...DEFAULT_APPEARANCE, skin: 1.5 })).toBeNull();
      expect(parseAppearance({ ...DEFAULT_APPEARANCE, hairColor: 99 })).toBeNull();
      expect(parseAppearance('<svg onload=alert(1)>')).toBeNull();
    });
    it('checks ownership, slots and compatibility', () => {
      const none = () => false;
      expect(validateEquipped({ outfit: 'polo-navy', hat: 'cap-green' }, none)).toBeNull();          // free
      expect(validateEquipped({ hat: 'fedora-black' }, none)).toMatch(/don’t own/);
      expect(validateEquipped({ hat: 'fedora-black' }, (id) => id === 'fedora-black')).toBeNull();
      expect(validateEquipped({ hat: 'polo-navy' }, none)).toMatch(/slot/);
      expect(validateEquipped({ hat: 'no-such-item' }, none)).toMatch(/Unknown item/);
      expect(validateEquipped({ outfit: 'tee-charcoal', neckwear: 'tie-black' }, none)).toMatch(/collared/);
      expect(validateEquipped({ outfit: 'polo-navy', lapel: 'lapel-spade' }, () => true)).toMatch(/jacket/);
      expect(fitEquipped({ outfit: 'tee-charcoal', neckwear: 'tie-black', hat: 'cap-green' })).toEqual({ outfit: 'tee-charcoal', hat: 'cap-green' });
    });
  });

  describe('layered SVG renderer', () => {
    it('produces one self-contained SVG with no scripts, handlers or external references', () => {
      for (let i = 0; i < 40; i++) {
        const svg = renderAvatar(randomAvatar());
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.match(/<svg/g)!.length).toBe(1);
        expect(svg).not.toMatch(/<script|on[a-z]+=|javascript:|href=|<foreignObject|<image/i);
      }
    });
    it('ignores hostile input instead of echoing it', () => {
      const svg = renderAvatar({ appearance: { hair: '"/><script>x</script>' }, equipped: { hat: '"><img src=x onerror=alert(1)>', outfit: 'tux-black' } });
      expect(svg).not.toMatch(/script|onerror|img/);
      expect(svg).toContain('<svg');
    });
    it('six random players get six different portraits', () => {
      let seed = 3; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const svgs = Array.from({ length: 6 }, () => renderAvatar(randomAvatar(r), { id: 'x' }));
      expect(new Set(svgs).size).toBe(6);
    });
    it('previews every catalog item', () => {
      // Chip previews come wrapped in a <div class="chip-preview"> holding up to three chip SVGs; everything else is one <svg>.
      for (const it of CATALOG) {
        const s = renderItemPreview(it.id);
        expect(s, it.id).toMatch(it.category === 'chips' ? /^<div class="chip-preview( one)?"><svg/ : /^<svg/);
        expect(s, it.id).not.toMatch(/<script|<foreignObject|<image|href="http|\son[a-z]+=/i);
      }
    });
  });

  describe('Cosmetics service', () => {
    it('prices and rewards are configurable', async () => {
      const c = new Cosmetics(new MemoryStore(), { prices: { 'fedora-black': 999 }, rewards: { welcome: 10 }, unavailable: ['tux-white'] });
      expect(c.price('fedora-black')).toBe(999);
      expect(c.catalog().find((i) => i.id === 'tux-white')!.available).toBe(false);
      await c.welcome('p1');
      await c.welcome('p1');
      expect((await (c as any).store.getCosmetics('p1')).balance).toBe(10);
      await expect(c.buy('p1', 'tux-white', 'key-12345678')).rejects.toThrow(/available/);
    });
    it('rewards read only counts, so bet size can never earn more', async () => {
      const store = new MemoryStore();
      const c = new Cosmetics(store);
      store.rewardFacts = async () => ({ hands: 1, games: ['uth'], friendHands: 1, nights: 1, nightHands: 1, decisions: 0, correct: 0 });
      expect((await c.afterHand('a', 'n1')).sort()).toEqual(['first-hand', 'game-night']);
      expect(await c.afterHand('a', 'n1')).toEqual([]);          // once only
    });
  });
});

// ==================================================================== debt.test.ts
describe('debt', () => {
  describe('debt counter', () => {
    it('has 15 items at every $1,000 step up to $10,000, then bigger tiers, all sorted', () => {
      for (let k = 1; k <= 10; k++) {
        const t = PAWN_TIERS[k - 1];
        expect(t.value).toBe(k * 100_000);
        expect(t.items).toHaveLength(15);
      }
      for (let i = 1; i < PAWN_TIERS.length; i++) expect(PAWN_TIERS[i].value).toBeGreaterThan(PAWN_TIERS[i - 1].value);
      for (const t of PAWN_TIERS) expect(t.items.length).toBeGreaterThanOrEqual(8);
      expect(new Set(PAWN_ITEMS.map((p) => p.item)).size).toBe(PAWN_ITEMS.length);              // no duplicates anywhere
      for (const p of PAWN_ITEMS) expect(p.item).not.toMatch(/'/);                               // curly apostrophes only
    });
    it('uses the cheapest tier that covers the whole debt', () => {
      expect(pawnTier(1).value).toBe(100_000);
      expect(pawnTier(100_000).value).toBe(100_000);
      expect(pawnTier(100_001).value).toBe(200_000);
      expect(pawnTier(1_500_000).value).toBe(2_000_000);
      expect(pawnTier(1e12)).toBe(PAWN_TIERS[PAWN_TIERS.length - 1]);                            // beyond the list: the biggest tier
    });
    it('picks at random within the tier, or stably from a seed', () => {
      const seen = new Set(Array.from({ length: 400 }, () => randomPawn(250_000).item));
      expect(seen.size).toBe(15);
      for (const i of seen) expect(PAWN_TIERS[2].items).toContain(i);
      expect(pawnFor(250_000, 0.999).item).toBe(PAWN_TIERS[2].items[14]);
      expect(pawnFor(250_000, 'player-1').item).toBe(pawnFor(250_000, 'player-1').item);
      expect(pawnFor(250_000).item).toBe(PAWN_TIERS[2].items[0]);
    });
    it('never repeats a joke back to back and words the line in dollars', () => {
      expect(DEBT_JOKES.length).toBeGreaterThanOrEqual(25);
      for (let n = 1; n < 60; n++) expect(debtJoke(n)).not.toBe(debtJoke(n + 1));
      expect(new Set(Array.from({ length: DEBT_JOKES.length }, (_, i) => debtJoke(i + 1))).size).toBe(DEBT_JOKES.length);
      const pawn = pawnFor(300_000, 0.5);
      expect(debtLine('Tom', 100_000, 300_000, 3, pawn)).toBe(
        `Tom takes a $1,000 marker. Total debt: $3,000. ${DEBT_JOKES[2]} To cover it, pawn ${pawn.item} (about $3,000).`);
    });
  });
});

// ==================================================================== engine.test.ts
describe('engine', () => {
  const C = (s: string) => s.split(' ').filter(Boolean).map(cardToInt);
  const $ = (d: number) => d * 100;

  // ---------- Independent reference evaluator (naive, 5 cards) to cross-check the fast one ----------
  function ref5(cards: number[]): number[] {
    const r = cards.map((c) => c >> 2).sort((a, b) => b - a);
    const flush = cards.every((c) => (c & 3) === (cards[0] & 3));
    const uniq = [...new Set(r)];
    let straightHi = -1;
    if (uniq.length === 5 && r[0] - r[4] === 4) straightHi = r[0];
    if (uniq.length === 5 && r[0] === 12 && r[1] === 3) straightHi = 3;
    const cnt = new Map<number, number>();
    r.forEach((x) => cnt.set(x, (cnt.get(x) || 0) + 1));
    const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const ordered = groups.flatMap(([rank, n]) => Array(n).fill(rank));
    const shape = groups.map((g) => g[1]).join('');
    if (flush && straightHi >= 0) return [8, straightHi];
    if (shape === '41') return [7, ...ordered];
    if (shape === '32') return [6, ...ordered];
    if (flush) return [5, ...r];
    if (straightHi >= 0) return [4, straightHi];
    if (shape === '311') return [3, ...ordered];
    if (shape === '221') return [2, ...ordered];
    if (shape === '2111') return [1, ...ordered];
    return [0, ...r];
  }
  const cmpArr = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; } return 0; };
  function ref7(cards: number[]): number[] {
    let best: number[] | null = null;
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const s = ref5(five);
      if (!best || cmpArr(s, best) > 0) best = s;
    }
    return best!;
  }
  function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function deal(r: () => number, n: number) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d.slice(0, n);
  }

  describe('hand evaluator', () => {
    it('names categories correctly', () => {
      expect(handName(evaluate(C('As Ks Qs Js Ts 2d 3c')))).toBe('Royal Flush');
      expect(handName(evaluate(C('9h 8h 7h 6h 5h Ac Ad')))).toBe('Straight Flush');
      expect(handName(evaluate(C('Ah 2h 3h 4h 5h Kc Kd')))).toBe('Straight Flush');
      expect(handName(evaluate(C('7c 7d 7h 7s 2c 3d 9h')))).toBe('Four of a Kind');
      expect(handName(evaluate(C('7c 7d 7h 2s 2c 3d 9h')))).toBe('Full House');
      expect(handName(evaluate(C('7c 7d 7h 2s 2c 2d 9h')))).toBe('Full House');
      expect(handName(evaluate(C('Ac 9c 7c 4c 2c 3d 9h')))).toBe('Flush');
      expect(handName(evaluate(C('Ac 2d 3h 4s 5c Kd 9h')))).toBe('Straight');
      expect(handName(evaluate(C('7c 7d 7h Ks 2c 3d 9h')))).toBe('Three of a Kind');
      expect(handName(evaluate(C('7c 7d Kh Ks 2c 3d 9h')))).toBe('Two Pair');
      expect(handName(evaluate(C('7c 7d Ah Ks 2c 3d 9h')))).toBe('One Pair');
      expect(handName(evaluate(C('7c 8d Ah Ks 2c 3d Jh')))).toBe('High Card');
    });

    it('orders tricky comparisons correctly', () => {
      // wheel loses to 6-high straight
      expect(evaluate(C('Ac 2d 3h 4s 5c'))).toBeLessThan(evaluate(C('2d 3h 4s 5c 6d')));
      // two pair: best kicker comes from a third pair
      expect(evaluate(C('Kc Kd 9h 9s 8c 8d 2h'))).toBeGreaterThan(evaluate(C('Kc Kd 9h 9s 7c 6d 2h')));
      // full house with two sets uses the higher set as trips
      expect(evaluate(C('9c 9d 9h Ks Kc Kd 2h'))).toBeGreaterThan(evaluate(C('Qc Qd Qh Js Jc 2d 3h')));
      // identical board plays -> exact tie
      const board = C('Ac Kc Qd Jh Ts');
      expect(evaluate([...C('2c 3d'), ...board])).toBe(evaluate([...C('4c 5d'), ...board]));
    });

    it('matches an independent reference evaluator on 20,000 random 7-card hands', () => {
      const r = rng(42);
      for (let i = 0; i < 20000; i++) {
        const h1 = deal(r, 7), h2 = deal(r, 7);
        const fast = Math.sign(evaluate(h1) - evaluate(h2));
        const slow = Math.sign(cmpArr(ref7(h1), ref7(h2)));
        if (fast !== slow) throw new Error(`Mismatch ${h1.map(intToCard)} vs ${h2.map(intToCard)}`);
        expect(categoryOf(evaluate(h1))).toBe(ref7(h1)[0]);
      }
    });

    it('bestFive returns a 5-card subset scoring the same as the 7-card hand', () => {
      const seven = C('7c 7d Kh Ks 2c 3d 9h');
      const five = bestFive(seven);
      expect(five).toHaveLength(5);
      expect(evaluate(five)).toBe(evaluate(seven));
    });
  });

  describe('settlement (all amounts in cents)', () => {
    const board = C('2c 7d 9h Js 4c');

    it('dealer does not qualify, player wins: ante PUSHES, play WINS, blind pushes (no straight)', () => {
      const s = settleCards(C('Ac Kd'), C('3h 5s'), board, { ante: $(10), play: $(40) });
      expect(s.dealerQualifies).toBe(false);
      expect(s.ante.result).toBe('push');
      expect(s.play.result).toBe('win');
      expect(s.blind.result).toBe('push');
      expect(s.net).toBe($(40));
    });

    it('dealer does not qualify but BEATS player: ante pushes, play and blind LOSE (prototype paid Play here)', () => {
      const s = settleCards(C('3d 5c'), C('Ah Ks'), board, { ante: $(10), play: $(10) });
      expect(s.dealerQualifies).toBe(false);
      expect(s.outcome).toBe('lose');
      expect(s.ante.result).toBe('push');
      expect(s.play.result).toBe('lose');
      expect(s.blind.result).toBe('lose');
      expect(s.net).toBe(-$(20));
    });

    it('flush pays the Blind 3:2, rounded down to the whole dollar like a casino', () => {
      const board = C('2c 7d 9c Js 4c');
      const s = settleCards(C('Ac 8c'), C('Jh Jd'), board, { ante: $(1), play: $(4) });
      expect(s.playerHand).toBe('Flush');
      expect(s.blind.net).toBe($(1));                 // $1.50 -> $1
      expect(s.blind.note).toMatch(/rounded down/);
      expect(s.net).toBe($(6));
      expect(settleCards(C('Ac 8c'), C('Jh Jd'), board, { ante: $(25), play: $(100) }).blind.net).toBe($(37)); // not $37.50
      expect(settleCards(C('Ac 8c'), C('Jh Jd'), board, { ante: $(20), play: $(80) }).blind.net).toBe($(30));  // exact, no rounding
      for (const ante of [1, 5, 7, 25, 35, 99]) {
        const x = settleCards(C('Ac 8c'), C('Jh Jd'), board, { ante: $(ante), play: $(ante) });
        expect(x.net % 100).toBe(0);                  // never a half-dollar
      }
    });

    it('tie pushes ante, blind and play', () => {
      const s = settleCards(C('2d 3s'), C('2h 3h'), C('Ac Kc Qd Jh Ts'), { ante: $(5), play: $(20) });
      expect(s.outcome).toBe('push');
      expect(s.net).toBe(0);
      expect(s.totalCredit).toBe(s.totalStake);
    });

    it('fold loses ante and blind, but Trips+ still resolves and is credited', () => {
      const s = settleCards(C('9c 9s'), C('Ah Ad'), board, { ante: $(10), play: 0, trips: $(5), folded: true });
      expect(s.outcome).toBe('fold');
      expect(s.playerHand).toBe('Three of a Kind');
      expect(s.trips.net).toBe($(15));
      expect(s.trips.credit).toBe($(20));
      expect(s.net).toBe(-$(20) + $(15));
    });

    it('Trips+ pays independently of losing the main hand', () => {
      const s = settleCards(C('9c 9s'), C('Jh Jd'), C('9h Js 2c 3d 8h'), { ante: $(5), play: $(10), trips: $(5) });
      expect(s.outcome).toBe('lose');
      expect(s.trips.net).toBe($(15));
    });

    it('royal flush pays 500:1 on blind and 50:1 on trips', () => {
      const s = settleCards(C('As Ks'), C('2h 2d'), C('Qs Js Ts 3c 4d'), { ante: $(1), play: $(4), trips: $(1) });
      expect(s.blind.net).toBe($(500));
      expect(s.trips.net).toBe($(50));
    });

    it('net always equals credit − stake', () => {
      const r = rng(7);
      for (let i = 0; i < 2000; i++) {
        const d = deal(r, 9);
        const s = settleCards(d.slice(0, 2), d.slice(2, 4), d.slice(4), { ante: $(5), play: $(5) * (1 + (i % 4)), trips: i % 2 ? $(5) : 0, folded: i % 7 === 0 });
        expect(s.net).toBe(s.totalCredit - s.totalStake);
        expect(Number.isInteger(s.net)).toBe(true);
      }
    });

    it('rejects fractional cents', () => {
      expect(() => settle({ ante: 1.5, blind: 1, play: 0, trips: 0, folded: true, playerScore: 0, dealerScore: 0 })).toThrow();
    });
  });

  describe('bet validation and affordability', () => {
    const limits = { minAnte: $(5), maxAnte: $(100), maxTrips: $(25), maxPairs: $(25), maxBadBeat: $(25) };
    const B = (ante: number, trips = 0, pairs = 0, badBeat = 0) => ({ ante, trips, pairs, badBeat });
    it('reserves Ante + Blind + Trips + 1x Play', () => {
      expect(requiredToStart($(10), $(5))).toBe($(35));
      expect(validateInitialBet(B($(10), $(5)), $(35), limits)).toBeNull();
      expect(validateInitialBet(B($(10), $(5)), $(34), limits)).toMatch(/need/);
    });
    it('enforces limits and whole dollars', () => {
      expect(validateInitialBet(B($(1), 0), $(500), limits)).toMatch(/Minimum/);
      expect(validateInitialBet(B($(500), 0), $(5000), limits)).toMatch(/Maximum/);
      expect(validateInitialBet(B(550, 0), $(500), limits)).toMatch(/whole dollars/);
      expect(validateInitialBet(B($(5), -100), $(500), limits)).not.toBeNull();
      expect(validateInitialBet(B($(5), $(50)), $(500), limits)).toMatch(/Trips/);
    });
    it('formats money', () => {
      expect(formatMoney(150)).toBe('$1.50');
      expect(formatMoney(-2500)).toBe('−$25');
      expect(formatMoney(100000, { sign: true })).toBe('+$1,000');
    });
  });

  describe('strategy', () => {
    const pre = (s: string) => preflopAdvice(C(s)).action;
    it('pre-flop chart (Wizard of Odds basic strategy)', () => {
      expect(pre('3c 3d')).toBe('play4');
      expect(pre('2c 2d')).toBe('check');
      expect(pre('Ac 2d')).toBe('play4');
      expect(pre('Kc 2c')).toBe('play4');
      expect(pre('Kc 4d')).toBe('check');
      expect(pre('Kc 5d')).toBe('play4');
      expect(pre('Qc 6c')).toBe('play4');
      expect(pre('Qc 5c')).toBe('check');
      expect(pre('Qc 8d')).toBe('play4');
      expect(pre('Qc 7d')).toBe('check');
      expect(pre('Jc 8c')).toBe('play4');
      expect(pre('Jc 7c')).toBe('check');
      expect(pre('Jc Td')).toBe('play4');
      expect(pre('Jc 9d')).toBe('check');
      expect(pre('Tc 9c')).toBe('check');
    });

    it('flop rules', () => {
      const f = (h: string, b: string) => flopAdvice(C(h), C(b)).action;
      expect(f('7c 2d', 'Kh 7s 9d')).toBe('play2');      // hidden pair
      expect(f('3c 2d', 'Kh Ks 9d')).toBe('check');      // board pair only
      expect(f('Kc 2d', 'Kh 7s 7d')).toBe('play2');      // two pair using a hole card
      expect(f('2c 2d', 'Kh 8s 9d')).toBe('check');      // pocket deuces exception
      expect(f('2c 2d', 'Kh 2s 9d')).toBe('play2');      // set of deuces
      expect(f('Tc 3d', 'Kc 8c 4c')).toBe('play2');      // four-flush with hidden ten
      expect(f('9c 3d', 'Kc 8c 4c')).toBe('check');      // four-flush with hidden nine
      expect(f('6c 5d', '7h 8s 2d')).toBe('check');      // open-ended straight draw only
    });

    it('river solver enumerates all 990 dealer combos and picks the higher EV', () => {
      const nuts = riverAdvice(C('As Ks'), C('Qs Js Ts 3c 4d'));
      expect(nuts.detail!.combos).toBe(990);
      expect(nuts.action).toBe('play1');
      expect(nuts.detail!.losses).toBe(0);
      // Board plays (straight on board, hole cards irrelevant): every dealer at least ties -> calling never loses play
      const trash = riverAdvice(C('2c 3d'), C('Kh Kd 9s 9c 5h'));
      expect(trash.action).toBe('fold');
      expect(trash.ev!.fold).toBe(-2);
      const sum = trash.detail!.wins + trash.detail!.ties + trash.detail!.losses;
      expect(sum).toBe(990);
    });

    it('flop and pre-flop EV estimates order sensibly', () => {
      const r = rng(1);
      const strong = flopEV(C('Ac Ad'), C('Ah 7s 2d'), 60, r);
      expect(strong.play2).toBeGreaterThan(strong.check);
      const pf = preflopEV(C('Ac Ad'), 4000, r);
      expect(pf.play4).toBeGreaterThan(pf.play3);
      expect(pf.play4).toBeGreaterThan(pf.check);
      const weak = preflopEV(C('7c 2d'), 4000, r);
      expect(weak.check).toBeGreaterThan(weak.play4);
    });

    it('mistakeCost is null for optimal play and positive for deviations', () => {
      expect(mistakeCost('preflop', C('Ac Kd'), [], 'play4')).toBeNull();
      const m = mistakeCost('river', C('2c 3d'), C('Kh Kd 9s 9c 5h'), 'play1');
      expect(m!.exact).toBe(true);
      expect(m!.cost).toBeGreaterThan(0);
    });
  });

  describe('outs', () => {
    it('counts the dealer\'s single-card outs on the river (matches the strategy chart examples)', () => {
      const a = dealerOuts(C('Ad 3c'), C('Ks 9d 7c 4h 2s'));
      expect(a.count).toBe(15);                                   // pairing any board card
      expect(a.byRank).toEqual([{ rank: 'K', count: 3 }, { rank: '9', count: 3 }, { rank: '7', count: 3 }, { rank: '4', count: 3 }, { rank: '2', count: 3 }]);
      expect(a.combos).toBe(990);
      const b = dealerOuts(C('6d 3c'), C('Ks 9d 7c 4h 2s'));
      expect(b.count).toBe(35);                                   // 15 board pairs + A, Q, J, 10, 8
      expect(riverAdvice(C('Ad 3c'), C('Ks 9d 7c 4h 2s')).action).toBe('play1');
      expect(riverAdvice(C('6d 3c'), C('Ks 9d 7c 4h 2s')).action).toBe('fold');
    });
    it('counts the player\'s outs to improve on the flop', () => {
      const f = improvementOuts(C('Ac 8c'), C('Kc 7c 2d'));
      expect(f.count).toBe(15);                                   // 9 clubs + 3 aces + 3 eights
      expect(f.hitByRiver!).toBeCloseTo(0.541, 2);
      expect(improvementOuts(C('2c 3d'), C('Kh Ks Kd')).cards).not.toContain('Kc'); // board quads aren't your improvement
    });
    it('has no outs before the flop', () => expect(outsFor('preflop', C('Ac Kd'), [])).toBeUndefined());
  });
});

// ==================================================================== progressive.test.ts
describe('progressive', () => {
  const c = (s: string) => s.split(' ').map(cardToInt);
  const LIMITS = { minAnte: 500, maxAnte: 10_000, maxTrips: 2_500, maxPairs: 2_500, maxBadBeat: 2_500 };

  describe('Five Card Progressive', () => {
    it('scores hole cards + flop only, ignoring turn and river', () => {
      expect(progressiveHand(c('As Ks'), c('Qs Js Ts 2d 3c'))).toBe('Royal Flush');
      expect(progressiveHand(c('As Kd'), c('2s 7h 9c As Ah'))).toBe('High Card');   // turn/river aces don't count
      expect(progressiveHand(c('9h 9d'), c('9s 4c 4d'))).toBe('Full House');
    });

    it('pays the fixed table and nothing below trips', () => {
      const hands = ['Four of a Kind', 'Full House', 'Flush', 'Straight', 'Three of a Kind', 'Two Pair'] as const;
      const r = resolveProgressive(hands.map((hand, seat) => ({ playerId: `p${seat}`, seat, hand })), 2_000_000);
      expect(hands.map((_, i) => r.awards.get(`p${i}`)!.amount)).toEqual([150_000, 25_000, 20_000, 15_000, 4_500, 0]);
      expect(r.meterAfter).toBe(2_000_000);
      expect(r.hits).toEqual([]);
    });

    it('royal takes the whole meter and resets it; straight flush takes 10% rounded down; envy goes to the others', () => {
      const r = resolveProgressive([
        { playerId: 'sf', seat: 0, hand: 'Straight Flush' },
        { playerId: 'royal', seat: 2, hand: 'Royal Flush' },
        { playerId: 'none', seat: 4, hand: 'One Pair' },
      ], 1_234_567);
      // Seat order: the straight flush is paid first, 10% of $12,345.67 = $1,234.56, rounded down to $1,234.
      expect(r.awards.get('sf')!.base).toBe(123_400);
      expect(r.awards.get('royal')!.base).toBe(1_111_100);             // $11,111.67 left, paid as $11,111
      expect(r.meterAfter).toBe(PROGRESSIVE.seed + 67);                // the 67¢ carries into the reset meter
      expect(r.awards.get('sf')!.envy).toBe(500_000);                  // from the royal
      expect(r.awards.get('royal')!.envy).toBe(150_000);               // from the straight flush
      expect(r.awards.get('none')!.amount).toBe(650_000);              // both envies, no hand award
      expect(r.hits.map((h) => h.hand)).toEqual(['Straight Flush', 'Royal Flush']);
    });

    it('never lets a straight flush drain the meter below the seed', () => {
      const r = resolveProgressive([{ playerId: 'a', seat: 0, hand: 'Straight Flush' }], PROGRESSIVE.seed + 5_000);
      expect(r.awards.get('a')!.base).toBe(100_500);
      expect(r.meterAfter).toBe(PROGRESSIVE.seed);
    });

    it('settles as a non-returned wager that survives a fold', () => {
      const award = resolveProgressive([{ playerId: 'x', seat: 0, hand: 'Flush' }], PROGRESSIVE.seed).awards.get('x')!;
      const hole = c('2h 7h'), board = c('9h Jh Kh 3c 4d'), dealer = c('Ac Ad');
      const st = settle({ ante: 1000, blind: 1000, play: 0, trips: 0, folded: true, progressive: 500, progressiveAward: award,
        playerScore: evaluate([...hole, ...board]), dealerScore: evaluate([...dealer, ...board]), playerHole: hole, dealerHole: dealer });
      expect(st.progressive).toMatchObject({ stake: 500, credit: 20_000, net: 19_500, result: 'win' });
      expect(st.net).toBe(-2000 + 19_500);
      const lose = settle({ ante: 1000, blind: 1000, play: 1000, trips: 0, folded: false, progressive: 500, progressiveAward: null,
        playerScore: evaluate([...hole, ...board]), dealerScore: evaluate([...dealer, ...board]), playerHole: hole, dealerHole: dealer });
      expect(lose.progressive).toMatchObject({ stake: 500, credit: 0, net: -500 });
    });

    it('accepts exactly $5 or nothing, and only where the table offers it', () => {
      const base = { ...NO_BETS, ante: 1000 };
      expect(validateInitialBet({ ...base, progressive: 500 }, 100_000, LIMITS)).toBeNull();
      expect(validateInitialBet({ ...base, progressive: 1000 }, 100_000, LIMITS)).toMatch(/\$5/);
      expect(validateInitialBet({ ...base, progressive: 500 }, 100_000, { ...LIMITS, progressiveEnabled: false })).toMatch(/not offered|progressive/i);
      expect(validateInitialBet({ ...base, progressive: 500 }, 3_499, LIMITS)).not.toBeNull();   // 3× ante + $5 = $35
      expect(validateInitialBet({ ...base, progressive: 500 }, 3_500, LIMITS)).toBeNull();
    });
  });
});

// ==================================================================== quality.test.ts
describe('quality', () => {
  const d = (correct: boolean, o: Partial<QDecision> = {}): QDecision => ({ phase: 'preflop', action: 'x', recommended: 'y', correct, graded: true, timedOut: false, reason: '', evCost: correct ? 0 : 0.5, evCents: correct ? 0 : 500, ...o });
  let n = 0;
  const hand = (mainNet: number, ds: QDecision[], o: Partial<QHand> = {}): QHand => ({ handId: `h${++n}`, handNumber: n, tableCode: 'T', game: 'uth', at: n * 1000, nightId: null,
    mainNet, totalNet: mainNet, folded: false, hole: [], community: [], dealer: [], decisions: ds, ...o });

  describe('§31 classification', () => {
    it('one deviation makes a wrong call; the result is the main-game sign only', () => {
      expect(classify(hand(50, [d(true), d(false)]))).toMatchObject({ call: 'wrong', result: 'win', evLostCents: 500 });
      expect(classify(hand(-20, [d(true)]))).toMatchObject({ call: 'right', result: 'loss' });
      expect(classify(hand(0, [d(true)]))).toMatchObject({ call: 'right', result: 'push' });
      // side bet won (total positive) but main game lost: a loss
      expect(classify(hand(-20, [d(false)], { totalNet: 30, folded: true }))).toMatchObject({ call: 'wrong', result: 'loss' });
    });
    it('constrained / unverified decisions are ungraded, never "correct"', () => {
      expect(classify(hand(10, [d(false, { graded: false })])).call).toBe('ungraded');
      expect(classify(hand(10, [])).call).toBe('ungraded');
      expect(classify(hand(10, [d(true), d(false, { graded: false })])).call).toBe('right');
    });
    it('EV lost is the same whether the hand won or lost; unknown EV is reported, not guessed', () => {
      expect(classify(hand(500, [d(false)])).evLostCents).toBe(classify(hand(-500, [d(false)])).evLostCents);
      expect(classify(hand(5, [d(false, { evCents: null, evCost: null })])).evLostCents).toBeNull();
    });
    it('summary: rates, reconciliation, multiple mistakes count once per hand, per game', () => {
      const hs = [hand(50, [d(false), d(false)]), hand(-10, [d(false)]), hand(0, [d(false)]), hand(10, [d(true)]), hand(-10, [d(true)]), hand(0, []),
        hand(30, [d(false, { evCents: null })], { game: 'bj' })];
      const s = summarize(hs);
      expect(s).toMatchObject({ hands: 7, wrongWins: 2, wrongLosses: 1, wrongPushes: 1, rightWins: 1, rightLosses: 1, ungraded: 1, wrongHands: 4, mistakes: 5,
        evLostCents: 2000, evUnknown: 1, wrongWinProfit: 80, rightLossAmount: -10 });
      expect(s.wrongWinRate).toBe(0.5);
      expect(s.rightWinRate).toBe(0.5);
      expect(s.wrongWins + s.wrongLosses + s.rightWins + s.rightLosses + s.wrongPushes + s.rightPushes + s.ungraded).toBe(s.hands);
      expect(s.byGame.bj).toMatchObject({ hands: 1, wrongWins: 1 });
      expect(s.byGame.tcp).toBeUndefined();
    });
    it('session = the latest run without an hour-long gap', () => {
      const hs = [hand(1, [], { at: 0 }), hand(1, [], { at: 10 * 60_000 }), hand(1, [], { at: 3 * 3600_000 }), hand(1, [], { at: 3 * 3600_000 + 5 * 60_000 })];
      expect(currentSession(hs).map((h) => h.at)).toEqual([3 * 3600_000, 3 * 3600_000 + 5 * 60_000]);
      expect(currentSession([])).toEqual([]);
    });
    it('history filters', () => {
      const c = classify(hand(5, [d(false)]));
      expect(matches(c, 'wrong-wins')).toBe(true);
      expect(matches(c, 'right-losses')).toBe(false);
      expect(matches(c, 'all')).toBe(true);
    });
  });

  describe('§31 Blackjack EV (infinite deck, dealer peeked, S17)', () => {
    const ev = (c: string[], up: string) => bjActionEVs(newHand(c as any, 100), up as any, R);
    it('matches published infinite-deck values', () => {
      expect(ev(['Ts', '6d'], '9c').stand!).toBeCloseTo(-0.541, 2);
      expect(ev(['Ts', '6d'], '9c').hit!).toBeCloseTo(-0.508, 2);
      expect(ev(['5s', '6h'], '6c').double!).toBeCloseTo(0.667, 2);
      expect(ev(['Ts', '2h'], '4c').stand!).toBeCloseTo(-0.211, 2);
    });
    it('costs are never negative and zero when the action is recommended', () => {
      expect(bjEvCost(newHand(['Ts', 'Th'] as any, 100), '6c', 'split', 'stand', R)).toBeGreaterThan(0.1);
      expect(bjEvCost(newHand(['Ts', 'Th'] as any, 100), '6c', 'stand', 'stand', R)).toBe(0);
      expect(insuranceEvCost(500, 1000)).toBeCloseTo(500 / 13 / 1000, 6);
    });
  });
});

// ==================================================================== recap.test.ts
describe('recap', () => {
  const P = (id: string, net: number, x: Partial<NightHandPlayer> = {}): NightHandPlayer => ({
    playerId: id, name: id.toUpperCase(), seat: 0, hole: ['2c', '3d'], folded: false, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
    handName: 'High Card', handRank: 0, tripsNet: 0, pairsNet: 0, badBeatNet: 0, progressiveNet: 0, pairsCombo: null, badBeatCombo: null,
    progressiveHand: null, pairsMultiplier: null, badBeatMultiplier: null, ...x,
  });
  const H = (n: number, players: NightHandPlayer[], decisions: NightHand['decisions'] = []): NightHand =>
    ({ handId: `h${n}`, handNumber: n, startedAt: n * 1000, settledAt: n * 1000 + 500, community: ['As', 'Kd', '9h', '5c', '2s'], dealerHand: 'Pair', players, decisions });

  describe('night recap', () => {
    const hands = [
      H(1, [P('a', 2000), P('b', -1500, { folded: true })], [{ playerId: 'a', phase: 'preflop', correct: true }]),
      H(2, [P('a', 4000, { handName: 'Full House', handRank: 6, hole: ['Ks', 'Kc'], tripsNet: 4000 }), P('b', -3000)]),
      H(3, [P('a', -1000), P('b', 500, { handName: 'Flush', handRank: 5, pairsNet: 2500, pairsCombo: 'Suited', pairsMultiplier: 5 })]),
      H(4, [P('a', 0), P('b', 0, { folded: true, handName: 'Four of a Kind', handRank: 7 })]),
    ];
    const r = buildRecap({ nightId: 'n', tableName: 'T', startedAt: 0, endedAt: null }, hands, new Map([['b', 300_000]]));

    it('totals, ordering and records', () => {
      expect(r.hands).toBe(4);
      expect(r.players.map((p) => [p.name, p.net, `${p.wins}-${p.losses}-${p.pushes}`, p.folds])).toEqual([['A', 5000, '2-1-1', 0], ['B', -4000, '1-2-1', 2]]);
      expect(r.biggestWin).toMatchObject({ name: 'A', amount: 4000, handNumber: 2, hole: ['Ks', 'Kc'] });
      expect(r.biggestLoss).toMatchObject({ name: 'B', amount: -3000 });
      expect(r.lastHandAt).toBe(4500);
    });
    it('best hands skip folded hands; bonus hits are sorted by amount', () => {
      expect(r.bestHands.map((b) => b.handName)).toEqual(['Full House', 'Flush']);   // folded quads don't count
      expect(r.players[1].bestHand).toBe('Flush');
      expect(r.bonusHits.map((b) => [b.bet, b.amount, b.detail])).toEqual([['Trips+', 4000, 'Full House'], ['Ultimate Pairs', 2500, 'Suited 5:1']]);
    });
    it('awards: streak, folds, debt with a pawn item', () => {
      const fun = Object.fromEntries(r.fun.map((f) => [f.label, f.text]));
      expect(fun['Hottest streak']).toBe('A — 2 wins in a row');
      expect(fun['Most folds']).toMatch(/^B — 2 folds/);
      expect(fun['Deepest in debt']).toMatch(/^B — \$3,000 in markers\. Time to pawn/);
      expect(fun['Sharpest player']).toBeUndefined();                                 // needs 5+ decisions
    });
  });
});

// ==================================================================== roast.test.ts
// §32 Dealer Roast Engine: content validation, rendering, viewer limits and the server director.
describe('roast', () => {
  const norm = (t: string) => t.toLowerCase().replace(/\{\w+\}/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  describe('§32.13 dialogue library — content validation', () => {
    const authored = Object.keys(CONTENT) as (keyof typeof CONTENT)[];
    it('every authored category has at least 15 distinct, non-placeholder lines for every one of the 12 dealers', () => {
      expect(authored.length).toBeGreaterThan(0);
      for (const cat of authored) for (const d of ROAST_DEALERS) {
        const ls = linesFor(d, cat);
        expect(ls.length, `${d}.${cat}`).toBeGreaterThanOrEqual(15);
        expect(new Set(ls.map((l) => norm(l.text))).size, `${d}.${cat} has near-duplicates`).toBe(ls.length);
        for (const l of ls) expect(l.text, l.id).not.toMatch(/\b(todo|tbd|lorem|placeholder|xxx)\b|\.\.\.$/i);
      }
    });
    it('no two dealers share a line, and a line is never just another line with a different name', () => {
      const seen = new Map<string, string>();
      for (const l of LINES) {
        const k = norm(l.text);
        expect(seen.get(k), `${l.id} duplicates ${seen.get(k)}`).toBeUndefined();
        seen.set(k, l.id);
      }
    });
    it('no joke is recycled across dealers: no 9-word run (names and swearing ignored) appears for 4+ dealers in a situation', () => {
      const seen = new Map<string, Set<string>>();
      for (const l of LINES) {
        const w = l.text.toLowerCase().replace(/\{\w+\}/g, ' ').replace(/\bfucking\b|\bfuck\b/g, ' ').replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
        for (let i = 0; i + 9 <= w.length; i++) {
          const k = `${l.cat}|${w.slice(i, i + 9).join(' ')}`;
          (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(l.dealer);
        }
      }
      const shared = [...seen].filter(([, d]) => d.size >= 4).map(([k]) => k);
      expect(shared).toEqual([]);
    });
    it('every line is tagged: id, dealer, category, intensity 1–4, facts from the known list, profanity, size, priority, cooldown, style', () => {
      for (const l of LINES) {
        expect(l.id).toBe(`${l.dealer}.${l.cat}.${l.id.split('.')[2]}`);
        expect([1, 2, 3, 4]).toContain(l.level);
        for (const f of l.facts) expect(FACTS as readonly string[], `${l.id} uses {${f}}`).toContain(f);
        expect([0, 1, 2, 3]).toContain(l.profanity);
        expect(['short', 'medium', 'long']).toContain(l.size);
        expect(l.priority).toBeGreaterThan(0); expect(l.cooldown).toBeGreaterThan(0);
        expect(['normal', 'shout', 'quiet', 'rant']).toContain(l.style);
      }
    });
    it('lower intensities have their own lines: every dealer/category has Smartass lines and lines at or below Asshole', () => {
      for (const cat of authored) for (const d of ROAST_DEALERS) {
        const ls = linesFor(d, cat);
        expect(ls.filter((l) => l.level === 1).length, `${d}.${cat} Smartass`).toBeGreaterThanOrEqual(2);
        expect(ls.filter((l) => l.level <= 2).length, `${d}.${cat} ≤ Asshole`).toBeGreaterThanOrEqual(5);
        expect(ls.filter((l) => l.level === 4).length, `${d}.${cat} No Mercy`).toBeGreaterThanOrEqual(3);
      }
    });
    it('No Mercy and Complete Menace lines actually swear; Smartass lines stay mild', () => {
      for (const l of LINES) {
        if (l.level === 1) expect(l.profanity, l.id).toBeLessThanOrEqual(2);
        if (l.level === 4) expect(l.profanity, l.id).toBeGreaterThanOrEqual(2);
      }
      const sev = LINES.filter((l) => l.level >= 3 && l.profanity === 3).length / LINES.filter((l) => l.level >= 3).length;
      expect(sev).toBeGreaterThan(0.75);
    });
    it('keeps to gameplay: no slurs, no protected characteristics, no self-harm, sexual or violent threats', () => {
      const banned = /\b(retard\w*|fag\w*|cunt|whore|slut|rape\w*|kill (yourself|urself)|suicid\w*|cancer|autis\w*|spastic|tranny|gay|lesbian|n[i1]gg\w*|kike|spic|chink|bitch\w*|stroke|lobotom\w*|ugly|fat|bald|disabled|cripple)\b/i;
      for (const l of LINES) expect(l.text, l.id).not.toMatch(banned);
    });
    it('the status report counts exactly what was authored', () => {
      const r = contentReport();
      expect(r.total).toBe(LINES.length);
      expect(r.complete.sort()).toEqual([...authored].sort());
      expect(r.incomplete.length).toBe(CATEGORIES.length - authored.length);
      console.log(`[roast library] ${r.total} lines · complete: ${r.complete.join(', ')} · not yet written: ${r.incomplete.join(', ')}`);
      expect(PRIMARY.length).toBe(25);
    });
    it('§32.13 library is complete: 25 primary situations × 12 dealers × 15 = 4,500 lines, plus 10 additional pools (1,800) and 5 Blackjack bonus situations (900)', () => {
      const r = contentReport();
      expect(r.incomplete).toEqual([]);
      expect(LINES.filter((l) => (PRIMARY as readonly string[]).includes(l.cat)).length).toBe(4500);
      expect(LINES.filter((l) => (EXTRA as readonly string[]).includes(l.cat)).length).toBe(1800);
      expect(LINES.filter((l) => (BONUS as readonly string[]).includes(l.cat)).length).toBe(900);    // §34.11 Blackjack bonus outcomes
      expect(r.total).toBe(7200);
      expect(new Set(LINES.map((l) => l.id)).size).toBe(7200);
    });
  });

  describe('§32 rendering and profanity filter', () => {
    it('fills verified facts and leaves nothing unknown when the facts are supplied', () => {
      expect(fill('{name} had {total}.', { name: 'Tom', total: '20' })).toBe('Tom had 20.');
    });
    it('the clean filter removes every swear word from every line, keeping shouted lines shouted', () => {
      for (const l of LINES) expect(profanityOf(cleanText(l.text)), l.id).toBe(0);
      expect(cleanText('YOU HAD TWENTY, YOU DUMB FUCK.')).toBe('YOU HAD TWENTY, YOU DUMB FLIP.');
      expect(cleanText('What the fuck, asshole?')).toBe('What the flip, clown?');
      expect(profanityOf('Hello, Michelle, nice shell.')).toBe(0);              // no false positives inside words
    });
  });

  describe('§32.11 what each viewer sees (local limits only)', () => {
    const lib = { LINE, linesFor };
    const top = linesFor('vincent', 'hit20').find((l) => l.level === 4)!;
    const payload: RoastPayload = { lineId: top.id, dealer: 'vincent', cat: 'hit20', level: 4, vars: { name: 'Tom', dealer: 'Vincent' }, size: top.size, seed: 12345, targetId: 'p1' };
    it('mute hides it; Professional shows the plain text', () => {
      expect(viewRoast(payload, 'Tom hits.', { mute: true, max: 4, profanity: true }, lib)).toBeNull();
      expect(viewRoast(payload, 'Tom hits.', { mute: false, max: 0, profanity: true }, lib)!.text).toBe('Tom hits.');
    });
    it('a lower limit gets a gentler line from the same dealer and situation — the same one on every device', () => {
      const a = viewRoast(payload, 'x', { mute: false, max: 1, profanity: true }, lib)!;
      const b = viewRoast(payload, 'x', { mute: false, max: 1, profanity: true }, lib)!;
      expect(a.lineId).toBe(b.lineId);
      expect(LINE.get(a.lineId!)!.level).toBe(1);
      expect(LINE.get(a.lineId!)!.dealer).toBe('vincent');
    });
    it('profanity off cleans whatever is shown; one viewer\'s settings never change the payload others receive', () => {
      const before = JSON.stringify(payload);
      const s = viewRoast(payload, 'x', { mute: false, max: 4, profanity: false }, lib)!;
      expect(profanityOf(s.text)).toBe(0);
      expect(JSON.stringify(payload)).toBe(before);
    });
  });

  // ---------------------------------------------------------------- director
  const dec = (o: Partial<DecisionRecord>): DecisionRecord => ({ phase: 'preflop', action: 'check', recommended: 'check', correct: true, reason: '', timedOut: false, graded: true, ...o } as DecisionRecord);
  function rig(attitude: 'professional' | 'smartass' | 'asshole' | 'menace' | 'nomercy' = 'nomercy', dealer = 'vincent') {
    const said: { p: RoastPayload; text: string }[] = [];
    let t = 1_000_000, seed = 7;
    const store = new MemoryStore();
    const d = new RoastDirector({
      emit: (p, text) => said.push({ p, text }), attitude: () => attitude, dealer: () => ({ id: dealer, name: dealer[0].toUpperCase() + dealer.slice(1) }),
      rand: (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; }, now: () => (t += 1000), store, tableCode: 'TBL',
    });
    return { d, said, store };
  }
  const P = (o: Partial<RoundPlayer> & { pid: string }): RoundPlayer => ({ name: o.pid.toUpperCase(), opening: 1000, mainNet: 0, sideNet: 0, totalNet: 0, decisions: [], folded: false, ...o });
  let hn = 0;
  const round = (game: RoundFacts['game'], players: RoundPlayer[]): RoundFacts => ({ handId: `h${++hn}`, nightId: 'n1', game, players });

  describe('§32 director: triggers, consent, caps and repetition', () => {
    it('Blackjack hit on 20 (verified) roasts the right player by name; nothing is said about players who opted out', async () => {
      const { d, said } = rig();
      d.setConsent('a', { targeting: true, max: 4 });
      expect(d.midHand('a', 'Ann', 'hit20', '20')).toBe(true);
      expect(said[0].p).toMatchObject({ cat: 'hit20', targetId: 'a', vars: { name: 'Ann' } });
      expect(said[0].p.size).toBe('short');                                       // mid-hand: short only
      expect(d.midHand('b', 'Bo', 'hit20', '20')).toBe(false);                    // Bo never opted in
      expect(said).toHaveLength(1);
    });
    it('a player\'s own maximum caps lines aimed at them, even at a No Mercy table', () => {
      const { d, said } = rig('nomercy');
      d.setConsent('a', { targeting: true, max: 1 });
      for (let i = 0; i < 10; i++) d.midHand('a', 'Ann', 'hit20');
      expect(said.length).toBeGreaterThan(0);
      for (const s of said) expect(s.p.level).toBeLessThanOrEqual(1);
    });
    it('a Professional table never roasts; the host attitude caps everyone', () => {
      const p = rig('professional'); p.d.setConsent('a', { targeting: true, max: 4 });
      expect(p.d.midHand('a', 'Ann', 'hit20')).toBe(false);
      const s = rig('smartass'); s.d.setConsent('a', { targeting: true, max: 4 });
      for (let i = 0; i < 6; i++) s.d.midHand('a', 'Ann', 'hit20');
      for (const x of s.said) expect(x.p.level).toBe(1);
    });
    it('never repeats a line within the last 100 comments; when a situation runs dry the dealer stays quiet', () => {
      const { d, said } = rig();
      d.setConsent('a', { targeting: true, max: 4 });
      for (let i = 0; i < 40; i++) d.midHand('a', 'Ann', 'hit20');
      const ids = said.map((s) => s.p.lineId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(linesFor('vincent', 'hit20').filter((l) => l.size === 'short').length);
    });
    it('the dealer\'s own lines are used — never another dealer\'s', () => {
      for (const dealer of ROAST_DEALERS) {
        const { d, said } = rig('nomercy', dealer);
        d.setConsent('a', { targeting: true, max: 4 });
        d.midHand('a', 'Ann', 'hit20');
        expect(said[0].p.lineId.startsWith(`${dealer}.hit20.`)).toBe(true);
        expect(said[0].p.dealer).toBe(dealer);
      }
    });
    it('settled hit-20 is not roasted twice when it was already roasted mid-hand', async () => {
      const { d, said } = rig();
      d.setConsent('a', { targeting: true, max: 4 });
      d.midHand('a', 'Ann', 'hit20');
      await d.afterRound(round('bj', [P({ pid: 'a', name: 'Ann', mainNet: -1000, totalNet: -1000, decisions: [dec({ phase: 'bj-1' as never, action: 'hit' as never, recommended: 'stand' as never, correct: false })], bj: { hit20: true, split10: false, busted: true, total: '29' } })]));
      expect(said.filter((s) => s.p.cat === 'hit20')).toHaveLength(1);
    });
    it('no fabricated mistakes: an ungraded or correct decision never produces a mistake roast', async () => {
      const { d, said } = rig();
      d.setConsent('a', { targeting: true, max: 4 });
      for (let i = 0; i < 20; i++) {
        await d.afterRound(round('bj', [P({ pid: 'a', name: 'Ann', mainNet: -1000, totalNet: -1000,
          decisions: [dec({ phase: 'bj-1' as never, action: 'hit' as never, recommended: 'double' as never, correct: false, graded: false })], bj: { hit20: false, split10: false, busted: false } })]));
      }
      expect(said.filter((s) => ['wrongWin', 'wrongLoss', 'badDouble', 'hit20', 'split10', 'ignoresStrategy', 'groupMistakes'].includes(s.p.cat))).toEqual([]);
    });
    it('wrong-call-win counts quoted by a dealer are the real verified count for tonight at this table', async () => {
      const { d, said } = rig();
      d.setConsent('a', { targeting: true, max: 4 });
      let checked = 0;
      for (let i = 1; i <= 8; i++) {
        const before = said.length;
        await d.afterRound(round('uth', [P({ pid: 'a', name: 'Ann', mainNet: 2000, totalNet: 2000, decisions: [dec({ phase: 'preflop', action: 'play4', recommended: 'check', correct: false })] })]));
        for (const x of said.slice(before)) {
          // Whatever the dealer said this round, any count it carries is exactly i (and absent until there are 2).
          expect(x.p.vars.wcw).toBe(i >= 2 ? String(i) : undefined);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
    it('grudges only name events that really happened, as plain past-tense facts', () => {
      expect(grudgePhrase({ kind: 'hit20' })).toBe('hit on twenty');
      expect(grudgePhrase({ kind: 'bigLoss', amount: 125_000 })).toBe('dropped $1,250 in a single hand');
    });
    it('rivalry: a dealer quotes the real number of hands it has dealt a consenting player on earlier shifts, and only at 25+', async () => {
      let fired = 0;
      for (let k = 0; k < 12; k++) {
        const { d, said, store } = rig('nomercy');
        for (let i = 0; i < 30 + k; i++) await store.bumpRivalry('vincent', 'a', { witnessed: 1 });
        await store.bumpRivalry('vincent', 'b', { witnessed: 24 });
        d.setConsent('a', { targeting: true, max: 4 }); d.setConsent('b', { targeting: true, max: 4 });
        for (let r = 0; r < 3; r++) await d.afterRound(round('uth', [P({ pid: 'a', name: 'Ann' }), P({ pid: 'b', name: 'Bo' })]));
        const riv = said.filter((x) => x.p.cat === 'rivalry');
        expect(riv.length).toBeLessThanOrEqual(1);                                   // once per shift at most
        for (const x of riv) { expect(x.p.targetId).toBe('a'); expect(x.p.vars.witnessed).toBe(String(30 + k)); }
        fired += riv.length;
        expect((await store.rivalries('vincent', ['a'])).get('a')!.witnessed).toBe(30 + k + 3);   // +1 per settled hand
      }
      expect(fired).toBeGreaterThan(0);
      const { d, said, store } = rig('nomercy');                                       // opted out → never
      for (let i = 0; i < 40; i++) await store.bumpRivalry('vincent', 'c', { witnessed: 1 });
      for (let r = 0; r < 3; r++) await d.afterRound(round('uth', [P({ pid: 'c' })]));
      expect(said.filter((x) => x.p.cat === 'rivalry')).toEqual([]);
    });
    it('a broken store never throws into the table engine', async () => {
      const { d } = rig();
      (d as unknown as { c: { store: { qualityHands: () => never } } }).c.store.qualityHands = () => { throw new Error('db down'); };
      await expect(d.afterRound(round('uth', [P({ pid: 'a' })]))).resolves.toBe(0);
    });
  });
});

// ==================================================================== sidebets.test.ts
describe('sidebets', () => {
  const C = (s: string) => s.split(' ').map(cardToInt);
  const $ = (d: number) => d * 100;
  const B4 = PAIRS_VARIANTS['up-bonus4'];
  const B2 = PAIRS_VARIANTS['up-bonus2'];
  const NOT_ACES = C('7c 8d');
  const up = (hole: string, v = B4, dealer = NOT_ACES) => evaluatePairs(v, C(hole), dealer);

  describe('Ultimate Pairs — Bonus 4 (default)', () => {
    it('A♥ A♦ pays 100:1', () => expect(up('Ah Ad').payout).toBe(100));
    it('A♦ A♥ in either order pays 100:1', () => expect(up('Ad Ah').payout).toBe(100));
    it('other pocket aces pay 30:1', () => {
      for (const h of ['As Ac', 'Ah As', 'Ad Ac', 'Ah Ac']) expect(up(h).payout, h).toBe(30);
    });
    it('suited ace-face pays 20:1', () => {
      for (const h of ['As Ks', 'Qh Ah', 'Ad Jd']) expect(up(h).payout, h).toBe(20);
    });
    it('unsuited ace-face pays 10:1', () => {
      for (const h of ['As Kd', 'Qh Ac', 'Ad Js']) expect(up(h).payout, h).toBe(10);
    });
    it('pocket 2s through Kings pay 4:1', () => {
      for (const h of ['2c 2d', '7h 7s', 'Tc Td', 'Kh Kc']) expect(up(h).payout, h).toBe(4);
    });
    it('non-qualifying hands lose', () => {
      for (const h of ['Kc Qc', 'As 9s', 'Ah Tc', '7c 2d', 'Kd Jd']) expect(up(h).won, h).toBe(false);
    });
    it('only the highest payout applies (A♥A♦ = 100, not 100 + 30)', () => {
      const r = up('Ah Ad');
      expect(r.payout).toBe(100);
      expect(r.label).toBe('A♥ A♦');
    });
    it('ignores the dealer’s cards: no 1,000:1 row exists in this variant', () => {
      expect(up('As Ac', B4, C('Ah Ad')).payout).toBe(30);
    });
  });

  describe('Ultimate Pairs — Bonus 2 (alternate, complete table)', () => {
    it('player and dealer both holding aces pays 1,000:1', () => expect(up('As Ac', B2, C('Ah Ad')).payout).toBe(1000));
    it('player aces without dealer aces pay 30:1', () => expect(up('As Ac', B2).payout).toBe(30));
    it('A♥A♦ has no special row in Bonus 2', () => expect(up('Ah Ad', B2).payout).toBe(30));
    it('pays its own rows, never Bonus 4’s', () => {
      expect(up('As Ks', B2).payout).toBe(25);
      expect(up('As Qs', B2).payout).toBe(20);
      expect(up('As Kd', B2).payout).toBe(15);
      expect(up('Jh Jc', B2).payout).toBe(10);
      expect(up('As Jd', B2).payout).toBe(5);
      expect(up('Th Tc', B2).payout).toBe(3);
      expect(up('2h 2c', B2).payout).toBe(3);
    });
    it('the in-hand preview never confirms a dealer-dependent payout', () => {
      const p = previewPairs(B2, C('As Ac'));
      expect(p.payout).toBe(30);
      expect(p.pendingUpgrade).toEqual({ label: 'Player and dealer both hold aces', payout: 1000 });
      expect(previewPairs(B2, C('Ks Kc')).pendingUpgrade).toBeNull();
    });
  });

  describe('Ultimate Pairs settlement', () => {
    it('returns the stake separately from the profit', () => {
      const w = settlePairs($(5), 'up-bonus4', C('Ah Ad'), NOT_ACES);
      expect(w).toMatchObject({ stake: $(5), net: $(500), credit: $(505), multiplier: 100, result: 'win', variant: 'up-bonus4' });
    });
    it('still pays after the player folds the main game', () => {
      const s = settleCards(C('As Ac'), C('Kh Kd'), C('2c 7d 9h Js 4c'), { ante: $(10), play: 0, folded: true, pairs: $(5) });
      expect(s.outcome).toBe('fold');
      expect(s.pairs.net).toBe($(150));
      expect(s.net).toBe(-$(20) + $(150));
    });
    it('refuses to settle without the hole cards', () => {
      expect(() => settlePairs($(5), 'up-bonus4', undefined, undefined)).toThrow();
    });
  });

  describe('Bad Beat — Bonus 01 (default)', () => {
    const bb = (player: string, dealer: string, board: string, extra: { folded?: boolean; badBeatVariant?: 'bb-01' | 'bb-02'; stake?: number } = {}) =>
      settleCards(C(player), C(dealer), C(board), { ante: $(10), play: extra.folded ? 0 : $(10), trips: $(5), badBeat: extra.stake ?? $(5), folded: extra.folded, badBeatVariant: extra.badBeatVariant });

    it('player loses with Three of a Kind → 9:1', () => {
      const s = bb('9c 3d', 'Kd Kc', '9h 9s 2c 5d Kh');
      expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Three of a Kind', 'Full House', 'lose']);
      expect(s.badBeat).toMatchObject({ result: 'win', multiplier: 9, net: $(45), combo: 'Player Three of a Kind' });
    });
    it('player loses with a Straight → 20:1', () => {
      const s = bb('8s 4d', 'Ah 3c', '5h 6h 7c Kh 2h');
      expect([s.playerHand, s.dealerHand]).toEqual(['Straight', 'Flush']);
      expect(s.badBeat.multiplier).toBe(20);
    });
    it('player loses with a Full House → 40:1', () => {
      const s = bb('9c 3d', 'Kh 4s', '9h 9s Kc Kd 2c');
      expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Full House', 'Full House', 'lose']);
      expect(s.badBeat.multiplier).toBe(40);
    });
    it('dealer loses with Three of a Kind → 9:1', () => {
      const s = bb('Kd Kc', '9c 3d', '9h 9s 2c 5d Kh');
      expect(s.outcome).toBe('win');
      expect(s.badBeat).toMatchObject({ result: 'win', multiplier: 9, combo: 'Dealer Three of a Kind' });
    });
    it('dealer loses with Four of a Kind → 500:1', () => {
      const s = bb('Kh Ks', '9c 9d', '9h 9s Kc Kd 2c');
      expect([s.playerHand, s.dealerHand, s.outcome]).toEqual(['Four of a Kind', 'Four of a Kind', 'win']);
      expect(s.badBeat.multiplier).toBe(500);
    });
    it('a tie between qualifying hands pays nothing', () => {
      const s = bb('2c 3d', '4c 5d', '9h 9s 9c Kd Kh');
      expect([s.playerHand, s.outcome]).toEqual(['Full House', 'push']);
      expect(s.badBeat.result).toBe('lose');
      expect(s.badBeat.note).toBe('Tied hands');
    });
    it('a losing hand below Three of a Kind pays nothing', () => {
      const s = bb('Kd 3c', '9c 4d', '9h 9s 2c 5d Kh');
      expect([s.playerHand, s.dealerHand]).toEqual(['Two Pair', 'Three of a Kind']);
      expect(s.badBeat.result).toBe('lose');
    });
    it('stays live after a fold and compares the real seven-card hands', () => {
      const folded = bb('9c 3d', 'Kd Kc', '9h 9s 2c 5d Kh', { folded: true }); // folded trips, dealer full house
      expect(folded.outcome).toBe('fold');
      expect(folded.badBeat.multiplier).toBe(9);
      const foldedBetter = bb('Kd Kc', '9c 3d', '9h 9s 2c 5d Kh', { folded: true }); // folded full house beats dealer trips
      expect(foldedBetter.badBeat).toMatchObject({ result: 'win', combo: 'Dealer Three of a Kind' });
      const foldedWeak = bb('3c 4d', 'Kd Kc', '9h 9s 2c 5d Kh', { folded: true });
      expect(foldedWeak.badBeat.result).toBe('lose'); // a fold is not a bad beat by itself
    });
    it('dealer non-qualification does not decide the bet', () => {
      const s = bb('9c 9d', '3h 5s', '2c 7d 9h Js 4c');
      expect(s.dealerQualifies).toBe(false);
      expect(s.ante.result).toBe('push');
      expect(s.badBeat.result).toBe('lose'); // loser is a high-card hand
      expect(s.trips.net).toBe($(15));
    });
    it('enforces the Trips+ companion wager', () => {
      const limits = { minAnte: $(5), maxAnte: $(100), maxTrips: $(25), maxPairs: $(25), maxBadBeat: $(25), badBeatVariant: 'bb-01' as const };
      expect(validateInitialBet({ ante: $(10), trips: 0, pairs: 0, badBeat: $(5) }, $(1000), limits)).toMatch(/Trips\+/);
      expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: 0, badBeat: $(5) }, $(1000), limits)).toBeNull();
      expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) }, $(44), limits)).toMatch(/\$45/);
      expect(validateInitialBet({ ante: $(10), trips: $(5), pairs: 0, badBeat: $(30) }, $(1000), limits)).toMatch(/Bad Beat/);
    });
    it('settles a straight-flush bad beat exactly: $25 × 10,000 = $250,000', () => {
      const s = bb('4h 2c', '9h 2d', '5h 6h 7h 8h Kc', { stake: $(25) });
      expect([s.playerHand, s.dealerHand]).toEqual(['Straight Flush', 'Straight Flush']);
      expect(s.badBeat).toMatchObject({ net: $(250_000), credit: $(250_025), multiplier: 10000 });
      expect(Number.isSafeInteger(s.net)).toBe(true);
      expect(bb('4h 2c', '9h 2d', '5h 6h 7h 8h Kc', { stake: $(25), badBeatVariant: 'bb-02' }).badBeat.net).toBe($(187_500));
    });
  });

  describe('main game loses while side bets win', () => {
    it('nets each wager independently and keeps base and side results separate', () => {
      const board = C('9h 2s Kc Kd 2c');
      expect(handName(evaluate([...C('9c 9d'), ...board]))).toBe('Full House');
      const s = settleCards(C('9c 9d'), C('Kh 4s'), board, { ante: $(10), play: $(10), trips: $(5), pairs: $(5), badBeat: $(5) });
      expect(s.outcome).toBe('lose');
      expect(s.baseNet).toBe(-$(30));
      expect(s.trips.net).toBe($(40));     // full house 8:1
      expect(s.pairs.net).toBe($(20));     // pocket 9s 4:1
      expect(s.badBeat.net).toBe($(200));  // losing full house 40:1
      expect(s.sideNet).toBe($(260));
      expect(s.net).toBe($(230));
      expect(s.net).toBe(s.totalCredit - s.totalStake);
    });
  });

  describe('variant registry', () => {
    it('every variant documents its source, companions and fold handling', () => {
      for (const v of [...Object.values(PAIRS_VARIANTS), ...Object.values(BAD_BEAT_VARIANTS)]) {
        expect(v.source.url).toMatch(/^https:\/\//);
        expect(v.requires).toContain('ante');
        expect(v.foldHandling).toBe('stays-live');
        expect(v.rows.length).toBeGreaterThan(3);
      }
      expect(BAD_BEAT_VARIANTS['bb-01'].requires).toContain('trips');
    });
  });
});

// ==================================================================== tcp.test.ts
describe('tcp', () => {
  const c = (s: string) => s.split(' ').map(cardToInt);
  const E = (s: string) => evaluate3(c(s));
  const name = (s: string) => tcpHandName(E(s));

  describe('three-card evaluator', () => {
    it('names every category', () => {
      expect(name('9h Th Jh')).toBe('Straight Flush');
      expect(name('7c 7d 7s')).toBe('Three of a Kind');
      expect(name('9h Tc Jd')).toBe('Straight');
      expect(name('2h 9h Kh')).toBe('Flush');
      expect(name('Kc Kd 4s')).toBe('Pair');
      expect(name('Ac 9d 4s')).toBe('High Card');
    });
    it('ranks Straight above Flush (unlike five-card poker)', () => {
      expect(E('4c 5d 6s')).toBeGreaterThan(E('Ah Kh 9h'));
      expect(E('Ah Kh 9h')).toBeGreaterThan(E('Ac Ad Ks'));        // flush beats pair
      expect(E('2c 2d 2h')).toBeGreaterThan(E('Ac Kd Qs'));        // trips beat a straight
    });
    it('A-K-Q is the highest straight, A-2-3 the lowest', () => {
      expect(name('Ac Kd Qs')).toBe('Straight');
      expect(name('Ac 2d 3s')).toBe('Straight');
      expect(E('Ac Kd Qs')).toBeGreaterThan(E('Kc Qd Js'));
      expect(E('Ac 2d 3s')).toBeLessThan(E('2c 3d 4s'));
      expect(name('Ac Kd 2s')).toBe('High Card');                   // no wrap-around
      expect(E('Ah 2h 3h')).toBeLessThan(E('2s 3s 4s'));            // steel wheel is the lowest straight flush
    });
    it('compares trips by rank, pairs by pair then kicker, flush and high card by descending ranks, exact ties', () => {
      expect(E('8c 8d 8s')).toBeGreaterThan(E('7c 7d 7s'));
      expect(E('9c 9d 2s')).toBeGreaterThan(E('8c 8d As'));
      expect(E('9c 9d 5s')).toBeGreaterThan(E('9h 9s 4c'));
      expect(E('Kh 9h 3h')).toBeGreaterThan(E('Ks 9s 2s'));
      expect(E('Kh Jc 3d')).toBeGreaterThan(E('Ks Tc 9d'));
      expect(E('Kh Jc 3d')).toBe(E('Ks Jd 3c'));
    });
    it('dealer qualifies with Queen high or better; Jack high does not', () => {
      expect(tcpQualifies(E('Qc 4d 2s'))).toBe(true);
      expect(tcpQualifies(E('Jc Td 8s'))).toBe(false);
      expect(tcpQualifies(E('2c 2d 3s'))).toBe(true);
      expect(tcpQualifies(E('Ac 3d 2s'))).toBe(true);              // A-2-3 is a straight
    });
  });

  describe('Three Card Poker settlement', () => {
    const base = { ante: 1000, play: 1000, pairPlus: 0, sixCard: 0, folded: false };
    it('dealer does not qualify: Ante 1:1, Play pushes', () => {
      const s = settleTcp({ ...base, player: c('5c 7d 9s'), dealer: c('Jc Td 8h') });
      expect([s.ante.net, s.play.net, s.net, s.outcome, s.dealerQualifies]).toEqual([1000, 0, 1000, 'win', false]);
    });
    it('qualified dealer: player wins both, loses both, or ties and pushes', () => {
      expect(settleTcp({ ...base, player: c('Kc Kd 4s'), dealer: c('Qc 9d 2s') }).net).toBe(2000);
      expect(settleTcp({ ...base, player: c('Kc Jd 4s'), dealer: c('Ac 9d 2s') }).net).toBe(-2000);
      const tie = settleTcp({ ...base, player: c('Kh Jc 3d'), dealer: c('Ks Jd 3c') });
      expect([tie.outcome, tie.net]).toEqual(['push', 0]);
    });
    it('Ante Bonus pays even when the dealer wins; never after a fold', () => {
      const s = settleTcp({ ...base, player: c('4c 5d 6s'), dealer: c('2h 2d 2s') });
      expect(s.outcome).toBe('lose');
      expect(s.anteBonus).toMatchObject({ result: 'win', net: 1000, multiplier: 1 });
      expect(s.net).toBe(-2000 + 1000);
      expect(settleTcp({ ...base, player: c('9h Th Jh'), dealer: c('Qc 9d 2s') }).anteBonus.net).toBe(5000);
      expect(settleTcp({ ...base, player: c('7c 7d 7s'), dealer: c('Qc 9d 2s') }).anteBonus.net).toBe(4000);
      const f = settleTcp({ ...base, play: 0, folded: true, player: c('7c 7d 7s'), dealer: c('Qc 9d 2s') });
      expect([f.anteBonus.result, f.net, f.outcome]).toEqual(['none', -1000, 'fold']);
    });
    it('Pair Plus: every category, and it still pays after a fold', () => {
      const pp = (hand: string) => settleTcp({ ...base, play: 0, folded: true, pairPlus: 500, player: c(hand), dealer: c('Ac Ad Kh') }).pairPlus;
      expect(pp('9h Th Jh').net).toBe(500 * 40);
      expect(pp('7c 7d 7s').net).toBe(500 * 30);
      expect(pp('9h Tc Jd').net).toBe(500 * 6);
      expect(pp('2h 9h Kh').net).toBe(500 * 3);
      expect(pp('Kc Ks 4s').net).toBe(500);
      expect(pp('Qc 9d 4s')).toMatchObject({ result: 'lose', net: -500 });
      expect(Object.values(PAIR_PLUS)).toEqual([40, 30, 6, 3, 1]);
      expect(Object.values(ANTE_BONUS)).toEqual([5, 4, 1]);
    });
    it('Six Card Bonus uses five-card ranks on the best five of six, and pays after a fold', () => {
      const six = (p: string, d: string) => settleTcp({ ...base, play: 0, folded: true, sixCard: 500, player: c(p), dealer: c(d) });
      const cases: [string, string, string, number][] = [
        ['As Ks Qs', 'Js Ts 2d', 'Royal Flush', 1000], ['9s 8s 7s', '6s 5s 2d', 'Straight Flush', 200], ['9s 9h 9d', '9c 2s 3d', 'Four of a Kind', 100],
        ['9s 9h 9d', '4c 4s 3d', 'Full House', 20], ['2h 7h 9h', 'Jh Kh 3c', 'Flush', 15], ['9s Th Jd', 'Qc Ks 2d', 'Straight', 10],
        ['9s 9h 9d', 'Ac 2s 5d', 'Three of a Kind', 7],
      ];
      for (const [p, d, hand, m] of cases) {
        const s = six(p, d);
        expect(s.sixCardHand, hand).toBe(hand);
        expect(s.sixCard.net, hand).toBe(500 * m);
      }
      expect(six('9s 9h 4d', '4c 2s 3d').sixCard).toMatchObject({ result: 'lose', net: -500 });     // two pair loses
      // Three-card ranks would call 4-5-6 + 7-8-x a straight over a flush; five-card ranks see the 5-card straight.
      expect(six('4h 5c 6d', '7s 8h Kd').sixCardHand).toBe('Straight');
      expect(Object.values(SIX_CARD)).toEqual([1000, 200, 100, 20, 15, 10, 7]);
    });
  });

  describe('Three Card Poker strategy', () => {
    it('basic strategy: Queen-6-4 or better plays', () => {
      expect(tcpBasicPlay(c('Qc 6d 4s'))).toBe(true);
      expect(tcpBasicPlay(c('Qc 6d 3s'))).toBe(false);
      expect(tcpBasicPlay(c('Qc 7d 2s'))).toBe(true);
      expect(tcpBasicPlay(c('Jc Td 8s'))).toBe(false);
      expect(tcpBasicPlay(c('Kc 3d 2s'))).toBe(true);
      expect(tcpBasicPlay(c('2c 2d 3s'))).toBe(true);
    });
    it('exact enumeration over all 18,424 dealer hands agrees with Q-6-4', () => {
      const q64 = tcpExactEV(c('Qc 6d 4s')), q63 = tcpExactEV(c('Qc 6d 3s'));
      expect(q64.combos).toBe(18424);
      expect(q64.wins + q64.losses + q64.ties + q64.noQualify).toBe(18424);
      expect(q64.play).toBeGreaterThan(-1);       // play beats folding (−1 Ante)
      expect(q63.play).toBeLessThan(-1);
    });
  });

  describe('display names', () => {
    it('say the rank that matters', async () => {
      const { tcpDescribe } = await import('../../src/shared/tcp');
      expect(tcpDescribe(E('Qd 8c 3h'))).toBe('Queen High');
      expect(tcpDescribe(E('Jd 8c 3h'))).toBe('Jack High');
      expect(tcpDescribe(E('Kc Kd 4s'))).toBe('Pair of Kings');
      expect(tcpDescribe(E('7c 7d 7s'))).toBe('Three Sevens');
      expect(tcpDescribe(E('9h Th Jh'))).toBe('Straight Flush');
    });
  });
});

// ==================================================================== §33–§39 payout audit (pay tables, rankings, progressives, BJ side bets)
import * as T3 from '../../src/shared/tcp';
import * as RU from '../../src/shared/rules';
import * as SB from '../../src/shared/sidebets';
import * as PG from '../../src/shared/progressive';
import * as BS from '../../src/shared/bjsides';
import * as EV from '../../src/shared/evaluator';
import { cardToInt as c2i } from '../../src/shared/cards';
// @ts-expect-error — plain ESM script, no type declarations (kept that way so the file budget stays small)
import { countFiles, FILE_CAP } from '../../scripts/count-files.mjs';

const C3 = (s: string) => s.split(' ').map(c2i);
describe('payouts', () => {
  describe('§35 Three Card Poker ranking defect', () => {
    it('exact reproduction: 8♠ 8♥ 8♦ beats A♣ J♣ 6♣ — Ante 1:1, Play 1:1, Ante Bonus 4:1, Pair Plus on the selected table, Progressive independent', () => {
      const player = C3('8s 8h 8d'), dealer = C3('Ac Jc 6c');
      expect(T3.tcpHandName(T3.evaluate3(player))).toBe('Three of a Kind');
      expect(T3.tcpHandName(T3.evaluate3(dealer))).toBe('Flush');
      for (const pp of Object.keys(T3.PAIR_PLUS_VARIANTS)) {
        const st = T3.settleTcp({ ante: 500, play: 500, pairPlus: 500, sixCard: 0, folded: false, player, dealer, pairPlusVariant: pp,
          progressive: 500, progressiveAward: { amount: 50_000, combo: 'Three of a Kind', label: 'Three of a Kind pays $500 for $5' } });
        expect(st.outcome).toBe('win');
        expect(st.dealerQualifies).toBe(true);
        expect(st.ante).toMatchObject({ result: 'win', net: 500, credit: 1000 });
        expect(st.play).toMatchObject({ result: 'win', net: 500, credit: 1000 });
        expect(st.anteBonus).toMatchObject({ result: 'win', net: 2000, multiplier: 4 });
        const m = T3.PAIR_PLUS_VARIANTS[pp].table['Three of a Kind']!;
        expect(st.pairPlus).toMatchObject({ result: 'win', net: 500 * m, credit: 500 + 500 * m });
        expect(st.progressive).toMatchObject({ result: 'win', credit: 50_000, net: 49_500 });   // for 1: the $5 is not returned
        expect(st.net).toBe(st.totalCredit - st.totalStake);
      }
      // PT7 at the High Roller ($5) profile: Three of a Kind is 100 for 1 → 500 chips total, nothing else returned.
      const p = PG.progSetup('tcp-pt7', 'high-roller');
      expect(p.variant.evaluate({ hole: player, suit: 0 })).toBe('Three of a Kind');
      const r = PG.resolveMeter(p, [{ playerId: 'a', seat: 0, combo: 'Three of a Kind' }], p.seed);
      expect(r.awards.get('a')!.amount).toBe(50_000);
      expect(r.meterAfter).toBe(p.seed);
    });
    it('reversed: the dealer’s Three of a Kind beats the player’s Flush; Pair Plus and the Progressive still pay on the player’s Flush/none', () => {
      const st = T3.settleTcp({ ante: 500, play: 500, pairPlus: 500, sixCard: 0, folded: false, player: C3('Ac Jc 6c'), dealer: C3('8s 8h 8d'), pairPlusVariant: 'pp-8', progressive: 500, progressiveAward: null });
      expect(st.outcome).toBe('lose');
      expect(st.ante.net + st.play.net).toBe(-1000);
      expect(st.anteBonus.result).toBe('none');                      // Ante Bonus is Straight or better
      expect(st.pairPlus).toMatchObject({ result: 'win', multiplier: 3 });   // Flush 3:1 on pp-8
      expect(st.progressive).toMatchObject({ result: 'lose', net: -500 });
      expect(PG.progSetup('tcp-pt7', 'casino').variant.evaluate({ hole: C3('Ac Jc 6c'), suit: 0 })).toBeNull();
    });
    it('all six categories against each other, in Three Card order', () => {
      const H: [string, string][] = [['High Card', 'Ks 9d 4c'], ['Pair', '5s 5d 2c'], ['Flush', '2h 7h Jh'], ['Straight', '4s 5d 6c'], ['Three of a Kind', '3s 3d 3c'], ['Straight Flush', '9c Tc Jc']];
      for (let i = 0; i < H.length; i++) for (let j = 0; j < H.length; j++) {
        const a = T3.evaluate3(C3(H[i][1])), b = T3.evaluate3(C3(H[j][1]));
        expect(T3.tcpHandName(a)).toBe(H[i][0]);
        expect(Math.sign(a - b), `${H[i][0]} vs ${H[j][0]}`).toBe(Math.sign(i - j));
      }
    });
    it('kickers, A-K-Q and A-2-3 straights, ties, qualification', () => {
      const s = (x: string) => T3.evaluate3(C3(x));
      expect(s('Ks Qd 4c')).toBeGreaterThan(s('Ks Jd 9c'));
      expect(s('As Ad 3c')).toBeGreaterThan(s('Ks Kd Qc'));
      expect(s('9s 9d Ac')).toBeGreaterThan(s('9h 9c Kd'));
      expect(s('2h 7h Kh')).toBeGreaterThan(s('2c 8c Qc'));
      expect(T3.tcpHandName(s('As Kd Qc'))).toBe('Straight');
      expect(T3.tcpHandName(s('As 2d 3c'))).toBe('Straight');
      expect(s('As Kd Qc')).toBeGreaterThan(s('Ks Qd Jc'));
      expect(s('As 2d 3c')).toBeLessThan(s('2s 3d 4c'));            // A-2-3 is the lowest straight
      expect(T3.tcpHandName(s('Ks As 2s'))).toBe('Flush');           // no wrap-around
      expect(s('Kh Qd 4c')).toBe(s('Ks Qc 4d'));                     // tie
      const tie = T3.settleTcp({ ante: 500, play: 500, pairPlus: 0, sixCard: 0, folded: false, player: C3('Kh Qd 4c'), dealer: C3('Ks Qc 4d') });
      expect(tie).toMatchObject({ outcome: 'push', ante: { result: 'push' }, play: { result: 'push' } });
      expect(T3.tcpQualifies(s('Qs 6d 4c'))).toBe(true);
      expect(T3.tcpQualifies(s('Js Td 8c'))).toBe(false);
      const nq = T3.settleTcp({ ante: 500, play: 500, pairPlus: 0, sixCard: 0, folded: false, player: C3('2s 5d 9c'), dealer: C3('Js Td 8c') });
      expect(nq).toMatchObject({ outcome: 'win', ante: { net: 500 }, play: { result: 'push', net: 0 } });
    });
    it('the stored history rank keeps Three Card order (the old five-card map put Flush above Three of a Kind)', () => {
      const r = T3.TCP_STORED_RANK;
      expect(r['Straight Flush']).toBeGreaterThan(r['Three of a Kind']);
      expect(r['Three of a Kind']).toBeGreaterThan(r.Straight);
      expect(r.Straight).toBeGreaterThan(r.Flush);
      expect(r.Flush).toBeGreaterThan(r.Pair);
    });
    it('A-K-Q suited is a Mini Royal only for Mini Royal Pair Plus tables and progressives — never a five-card Royal Flush', () => {
      const akq = C3('As Ks Qs');
      expect(T3.tcpHandName(T3.evaluate3(akq))).toBe('Straight Flush');
      expect(T3.isMiniRoyal(akq)).toBe(true);
      expect(T3.pairPlusPay('pp-1', akq)).toEqual({ combo: 'Straight Flush', mult: 40 });
      expect(T3.pairPlusPay('pp-mr4', akq)).toEqual({ combo: 'Mini Royal', mult: 200 });
      expect(PG.PROG_VARIANTS['tcp-pt7'].evaluate({ hole: akq, suit: 0 })).toBe('A-K-Q (jackpot suit)');
      expect(PG.PROG_VARIANTS['tcp-pt7'].evaluate({ hole: C3('Ah Kh Qh'), suit: 0 })).toBe('A-K-Q suited');
    });
    it('every Pair Plus table: each payable category pays its row, nothing else pays', () => {
      const hands: Record<string, string> = { 'Straight Flush': '9c Tc Jc', 'Three of a Kind': '3s 3d 3c', Straight: '4s 5d 6c', Flush: '2h 7h Jh', Pair: '5s 5d 2c' };
      for (const v of Object.values(T3.PAIR_PLUS_VARIANTS)) {
        for (const [cat, cards] of Object.entries(hands)) expect(T3.pairPlusPay(v.id, C3(cards)), `${v.id} ${cat}`).toEqual({ combo: cat, mult: v.table[cat as 'Pair'] });
        expect(T3.pairPlusPay(v.id, C3('Ks 9d 4c'))).toBeNull();
      }
    });
    it('Six Card Bonus: every paying combination uses standard five-card ranks (best five of six)', () => {
      const six = (p: string, d: string) => T3.settleTcp({ ante: 100, play: 0, pairPlus: 0, sixCard: 100, folded: true, player: C3(p), dealer: C3(d) }).sixCard;
      expect(six('As Ks Qs', 'Js Ts 2d')).toMatchObject({ combo: 'Royal Flush', multiplier: 1000 });
      expect(six('9s 8s 7s', '6s 5s 2d')).toMatchObject({ combo: 'Straight Flush', multiplier: 200 });
      expect(six('9s 9h 9d', '9c 5s 2d')).toMatchObject({ combo: 'Four of a Kind', multiplier: 100 });
      expect(six('9s 9h 9d', '5c 5s 2d')).toMatchObject({ combo: 'Full House', multiplier: 20 });
      expect(six('2h 7h Jh', '4h 9h Kc')).toMatchObject({ combo: 'Flush', multiplier: 15 });
      expect(six('4s 5d 6c', '7h 8c Kd')).toMatchObject({ combo: 'Straight', multiplier: 10 });
      expect(six('3s 3d 3c', 'Kh 8c 2d')).toMatchObject({ combo: 'Three of a Kind', multiplier: 7 });
      expect(six('3s 3d 9c', 'Kh 8c 2d')).toMatchObject({ result: 'lose' });
    });
  });

  describe('§36 Ultimate Texas Hold’em pay tables', () => {
    const rank = (cards: string) => EV.evaluate(cards.split(' ').map(c2i));
    const sevens: Record<string, string> = {
      'Royal Flush': 'As Ks Qs Js Ts 2d 3c', 'Straight Flush': '9s 8s 7s 6s 5s 2d 3c', 'Four of a Kind': '9s 9h 9d 9c 5s 2d 3c', 'Full House': '9s 9h 9d 5c 5s 2d 3h',
      Flush: '2h 7h Jh 4h 9h Kc 3d', Straight: '4s 5d 6c 7h 8c Kd 2s', 'Three of a Kind': '3s 3d 3c Kh 8c 2d 9s',
    };
    it('all five Trips configurations (UTH-01 … UTH-05): every row, and Two Pair loses', () => {
      const exp: Record<string, number[]> = { 'Royal Flush': [50, 50, 50, 50, 50], 'Straight Flush': [40, 40, 40, 40, 40], 'Four of a Kind': [30, 30, 30, 20, 30],
        'Full House': [9, 8, 8, 7, 7], Flush: [7, 6, 7, 6, 6], Straight: [4, 5, 4, 5, 5], 'Three of a Kind': [3, 3, 3, 3, 3] };
      (['uth-01', 'uth-02', 'uth-03', 'uth-04', 'uth-05'] as const).forEach((v, i) => {
        for (const [hand, cards] of Object.entries(sevens)) expect(RU.settleTrips(100, rank(cards), v), `${v} ${hand}`).toMatchObject({ result: 'win', net: 100 * exp[hand][i] });
        expect(RU.settleTrips(100, rank('9s 9h 5d 5c Ks 2d 3h'), v).result).toBe('lose');
      });
      expect(RU.DEFAULT_TRIPS_VARIANT).toBe('uth-02');
    });
    it('Blind: 500 / 50 / 10 / 3 / 3:2 / 1 on a winning hand; a win below a Straight pushes', () => {
      expect(RU.BLIND_PAYTABLE).toEqual({ 'Royal Flush': [500, 1], 'Straight Flush': [50, 1], 'Four of a Kind': [10, 1], 'Full House': [3, 1], Flush: [3, 2], Straight: [1, 1] });
    });
    const P = (s: string) => s.split(' ').map(c2i);
    it('all six Ultimate Pairs schedules: first matching row only, A♥A♦ specials, both-aces only on UP-02, and losses', () => {
      const pay = (v: SB.PairsVariant['id'], hole: string, dealer = '2c 7d') => { const r = SB.evaluatePairs(SB.PAIRS_VARIANTS[v], P(hole), P(dealer)); return r.won ? r.payout : 0; };
      // UP-01 / UP-02
      for (const v of ['up-01', 'up-bonus2'] as const) {
        expect(pay(v, 'Ah Ad')).toBe(30); expect(pay(v, 'As Ks')).toBe(25); expect(pay(v, 'As Qs')).toBe(20); expect(pay(v, 'As Jh'.replace('h', 's'))).toBe(20);
        expect(pay(v, 'As Kd')).toBe(15); expect(pay(v, 'Ks Kd')).toBe(10); expect(pay(v, 'Js Jd')).toBe(10); expect(pay(v, 'As Qd')).toBe(5); expect(pay(v, 'Ts Td')).toBe(3);
        expect(pay(v, '2s 2d')).toBe(3); expect(pay(v, 'As Td')).toBe(0); expect(pay(v, 'Ks Qs')).toBe(0);
      }
      expect(pay('up-bonus2', 'As Ad', 'Ac Ah')).toBe(1000);
      expect(pay('up-01', 'As Ad', 'Ac Ah')).toBe(30);
      expect(SB.evaluatePairs(SB.PAIRS_VARIANTS['up-bonus2'], P('As Ad'), null).payout).toBe(30);   // never confirmed before the dealer's cards are known
      // UP-03 … UP-06
      const t: Record<string, [number, number, number, number]> = { 'up-03': [30, 30, 5, 30], 'up-bonus4': [100, 30, 4, 30], 'up-05': [50, 25, 5, 25], 'up-06': [25, 25, 5, 25] };
      for (const [v, [ahad, aa, pair, aceSpadeClub]] of Object.entries(t) as [SB.PairsVariant['id'], number[]][]) {
        expect(pay(v, 'Ah Ad'), `${v} A♥A♦`).toBe(ahad);
        expect(pay(v, 'As Ac'), `${v} other aces`).toBe(aceSpadeClub ?? aa);
        expect(pay(v, 'As Ks')).toBe(20); expect(pay(v, 'As Jd')).toBe(10); expect(pay(v, 'Ks Kd')).toBe(pair); expect(pay(v, '2s 2d')).toBe(pair);
        expect(pay(v, 'As 9s')).toBe(0);
      }
    });
    it('all three Bad Beat schedules pay on the losing hand (kickers count, ties never qualify, below Three of a Kind loses)', () => {
      const col: Record<string, [number, number, number]> = { 'Straight Flush': [10000, 7500, 2500], 'Four of a Kind': [500, 500, 500], 'Full House': [40, 50, 50],
        Flush: [25, 30, 30], Straight: [20, 20, 20], 'Three of a Kind': [9, 9, 9] };
      const losing: Record<string, string> = { 'Straight Flush': '9s 8s 7s 6s 5s 2d 3c', 'Four of a Kind': '9s 9h 9d 9c 5s 2d 3c', 'Full House': '9s 9h 9d 5c 5s 2d 3h',
        Flush: '2h 7h Jh 4h 9h Kc 3d', Straight: '4s 5d 6c 7h 8c Kd 2s', 'Three of a Kind': '3s 3d 3c Kh 8c 2d 9s' };
      (['bb-01', 'bb-02', 'bb-03'] as const).forEach((v, i) => {
        for (const [hand, cards] of Object.entries(losing)) {
          const r = SB.evaluateBadBeat(SB.BAD_BEAT_VARIANTS[v], rank(cards), rank('As Ks Qs Js Ts 2d 3c'));
          expect(r, `${v} ${hand}`).toMatchObject({ won: true, payout: col[hand][i], loser: 'player' });
          const d = SB.evaluateBadBeat(SB.BAD_BEAT_VARIANTS[v], rank('As Ks Qs Js Ts 2d 3c'), rank(cards));
          expect(d).toMatchObject({ won: true, payout: col[hand][i], loser: 'dealer' });
        }
        expect(SB.evaluateBadBeat(SB.BAD_BEAT_VARIANTS[v], rank('9s 9h 9d 5c 5s 2d 3h'), rank('9s 9h 9d 5c 5s 2d 3h')).won).toBe(false);
        expect(SB.evaluateBadBeat(SB.BAD_BEAT_VARIANTS[v], rank('9s 9h 5d 5c Ks 2d 3h'), rank('As Ks Qs Js Ts 2d 3c')).won).toBe(false);
      });
      // kicker decides who lost: same trips, different kicker
      const r = SB.evaluateBadBeat(SB.BAD_BEAT_VARIANTS['bb-01'], rank('3s 3d 3c Kh 8c 2d 9s'), rank('3s 3d 3c Ah 8c 2d 9s'));
      expect(r).toMatchObject({ won: true, loser: 'player', payout: 9 });
    });
    it('UTH Progressive V2: hidden Royal takes the meter (+ Envy to others), board Royal is a fixed 1,000 for 1, SF 250, Quads 75, Full House 10; highest only', () => {
      const v = PG.PROG_VARIANTS['uth-v2'];
      expect(v.evaluate({ hole: P('As Ks'), board: P('Qs Js Ts 2d 3c') })).toBe('Royal Flush (hidden)');
      expect(v.evaluate({ hole: P('2h 3h'), board: P('As Ks Qs Js Ts') })).toBe('Royal Flush (board)');
      expect(v.evaluate({ hole: P('9s 8s'), board: P('7s 6s 5s 2d 3c') })).toBe('Straight Flush');
      expect(v.evaluate({ hole: P('9s 9h'), board: P('9d 9c 5s 2d 3c') })).toBe('Four of a Kind');
      expect(v.evaluate({ hole: P('9s 9h'), board: P('9d 5c 5s 2d 3h') })).toBe('Full House');
      expect(v.evaluate({ hole: P('2h 7h'), board: P('Jh 4h 9h Kc 3d') })).toBeNull();      // Flush pays nothing on V2
      const p = PG.progSetup('uth-v2', 'casino');
      const r = PG.resolveMeter(p, [
        { playerId: 'a', seat: 0, combo: 'Royal Flush (hidden)' }, { playerId: 'b', seat: 1, combo: 'Royal Flush (board)' },
        { playerId: 'c', seat: 2, combo: 'Straight Flush' }, { playerId: 'd', seat: 3, combo: null }], 5_000_000);
      expect(r.awards.get('a')).toMatchObject({ base: 5_000_000, envy: 0, fromMeter: true });
      expect(r.awards.get('b')).toMatchObject({ base: 100_000, envy: 10_000, amount: 110_000 });       // the board royal never drains the meter
      expect(r.awards.get('c')).toMatchObject({ base: 25_000, envy: 10_000 });
      expect(r.awards.get('d')).toMatchObject({ base: 0, envy: 10_000, amount: 10_000 });
      expect(r.meterAfter).toBe(p.seed);
      expect(r.hits).toHaveLength(1);
    });
    it('Five Card Progressive (original) is unchanged at its published $5 profile', () => {
      const p = PG.progSetup('five-card-5', 'casino');
      expect([p.wager, p.seed, p.contribution, p.meterId]).toEqual([500, 1_000_000, 350, 'five-card-5']);
    });
  });

  describe('§37 progressive service', () => {
    const P = (s: string) => s.split(' ').map(c2i);
    it('separate meter ids per game, variant and profile; High Roller is $5 with a $25,000 start and scaled fixed awards', () => {
      const ids = PG.ALL_SETUPS.map((s) => s.meterId);
      expect(new Set(ids).size).toBe(ids.length);
      const hr = PG.progSetup('bj-213-16', 'high-roller'), pub = PG.progSetup('bj-213-16', 'casino');
      expect([hr.wager, hr.seed, hr.custom, pub.wager, pub.seed, pub.custom]).toEqual([500, 2_500_000, true, 100, 200_000, false]);
      const a = PG.resolveMeter(hr, [{ playerId: 'x', seat: 0, combo: 'Straight Flush' }], hr.seed).awards.get('x')!;
      const b = PG.resolveMeter(pub, [{ playerId: 'x', seat: 0, combo: 'Straight Flush' }], pub.seed).awards.get('x')!;
      expect(a.amount).toBe(b.amount * 5);
      expect(PG.PROG_DEFAULT).toEqual({ uth: 'uth-v2', tcp: 'tcp-pt7', bj: 'bj-213-16' });
    });
    it('percentage awards, multiple winners in seat order, never negative and never below the seed', () => {
      const p = PG.progSetup('five-card-5', 'casino');
      const r = PG.resolveMeter(p, [{ playerId: 'b', seat: 3, combo: 'Straight Flush' }, { playerId: 'a', seat: 1, combo: 'Royal Flush' }], 2_000_050);
      expect(r.hits.map((h) => h.playerId)).toEqual(['a', 'b']);       // seat order: the royal takes it all first
      expect(r.awards.get('a')!.base).toBe(2_000_000);                 // whole dollars, rounded down
      expect(r.hits[1].meterBefore).toBe(p.seed + 50);
      expect(r.awards.get('b')!.base).toBe(Math.floor((p.seed + 50) * 0.1 / 100) * 100);
      expect(r.meterAfter).toBeGreaterThanOrEqual(p.seed);
      expect(r.awards.get('a')!.envy).toBe(150_000);                   // b's Straight Flush pays Envy to a
    });
    it('21+3 Progressive (PT-PRG-213-16): Mini Royal in the jackpot suit, other Mini Royal, SF, trips (suited trips too), straight; flush loses', () => {
      const v = PG.PROG_VARIANTS['bj-213-16'];
      const e = (p: string, up: string, suit = 0) => v.evaluate({ hole: P(p), upcard: c2i(up), suit });
      expect(e('As Ks', 'Qs')).toBe('Mini Royal (jackpot suit)');
      expect(e('As Ks', 'Qs', 1)).toBe('Mini Royal');
      expect(e('9h Th', 'Jh')).toBe('Straight Flush');
      expect(e('7d 7d', '7d')).toBe('Three of a Kind');
      expect(e('7d 7s', '7c')).toBe('Three of a Kind');
      expect(e('4s 5d', '6c')).toBe('Straight');
      expect(e('2h 7h', 'Jh')).toBeNull();
      expect(v.rows.map((r) => r.amount ?? r.pct)).toEqual([100, 50_000, 7_500, 3_000, 500]);
    });
  });

  describe('§34 Blackjack side bets', () => {
    const ctx = (player: string, dealer: string, final = true, natural = false): BS.BjSideContext => ({ player: player.split(' '), dealer: dealer.split(' '), dealerFinal: final, playerNatural: natural });
    const pay = (id: string, c: BS.BjSideContext, v?: string) => BS.settleBjSide(id, v ?? BS.BJ_SIDE[id].variants[0].id, 500, c);
    it('catalog: six All Bets wagers + Lucky Ladies + Match the Dealer playable; unverified ones are unavailable with a reason', () => {
      expect(BS.PLAYABLE_BJ_SIDES.map((d) => d.id)).toEqual(['perfect-player', 'perfect-dealer', 'twentyone3', 'top3', 'buster', 'lucky-lucky', 'lucky-ladies', 'match-dealer']);
      for (const d of BS.BJ_SIDES.filter((x) => x.status === 'unavailable')) { expect(d.unavailable).toBeTruthy(); expect(d.variants).toEqual([]); }
      for (const d of BS.PLAYABLE_BJ_SIDES) { expect(d.sources.length).toBeGreaterThan(0); expect(d.variants.length).toBeGreaterThan(0); }
      expect(BS.BJ_SIDES.find((d) => d.id === 'lucky-ladies')!.variants.map((v) => v.id)).not.toContain('pt-fltll-04');
    });
    it('Perfect Player / Dealer Pairs: perfect (identical cards across decks), coloured, mixed, none', () => {
      expect(pay('perfect-player', ctx('8h 8h', '2c 3d'))).toMatchObject({ result: 'win', pays: 25, credit: 500 * 26 });
      expect(pay('perfect-player', ctx('8h 8d', '2c 3d'))).toMatchObject({ pays: 12 });
      expect(pay('perfect-player', ctx('8h 8s', '2c 3d'))).toMatchObject({ pays: 6 });
      expect(pay('perfect-player', ctx('8h 9h', '2c 3d'))).toMatchObject({ result: 'lose', net: -500 });
      expect(pay('perfect-player', ctx('Kh Kh', '2c 3d'), 'pa-b')).toMatchObject({ pays: 30 });
      expect(pay('perfect-dealer', ctx('2c 3d', 'Qs Qs'))).toMatchObject({ pays: 25 });
      expect(pay('perfect-dealer', ctx('2c 3d', 'Qs Qc'))).toMatchObject({ pays: 12 });
      expect(pay('perfect-dealer', ctx('2c 3d', 'Qs Qd'))).toMatchObject({ pays: 6 });
      expect(BS.resolvableNow('dealer-hole', false, false)).toBe(false);      // never resolved before the hole card is shown
    });
    it('21+3 and Top 3: every row, highest only, and both win on the same cards', () => {
      const t = (p: string, up: string) => ctx(p, `${up} 2c`);
      expect(pay('twentyone3', t('7d 7d', '7d'))).toMatchObject({ pays: 100, combo: 'suited-trips' });
      expect(pay('twentyone3', t('9h Th', 'Jh'))).toMatchObject({ pays: 40 });
      expect(pay('twentyone3', t('7d 7s', '7c'))).toMatchObject({ pays: 30 });
      expect(pay('twentyone3', t('4s 5d', '6c'))).toMatchObject({ pays: 10 });
      expect(pay('twentyone3', t('Qs Kd', 'Ac'))).toMatchObject({ pays: 10 });
      expect(pay('twentyone3', t('As 2d', '3c'))).toMatchObject({ pays: 10 });
      expect(pay('twentyone3', t('2h 7h', 'Jh'))).toMatchObject({ pays: 5 });
      expect(pay('twentyone3', t('2h 7d', 'Jh'))).toMatchObject({ result: 'lose' });
      expect(pay('top3', t('7d 7d', '7d'))).toMatchObject({ pays: 270 });
      expect(pay('top3', t('9h Th', 'Jh'))).toMatchObject({ pays: 180 });
      expect(pay('top3', t('7d 7s', '7c'))).toMatchObject({ pays: 90 });
      expect(pay('top3', t('4s 5d', '6c'))).toMatchObject({ result: 'lose' });
      expect(pay('top3', t('7d 7d', '7d'), 'pa-b')).toMatchObject({ pays: 1000 });
      const both = t('Qh Qh', 'Qh');
      expect([pay('twentyone3', both).credit, pay('top3', both).credit]).toEqual([500 * 101, 500 * 271]);
    });
    it('Buster Blackjack counts the dealer’s busted cards, pays the Blackjack tiers, and loses when the dealer does not bust or is not finished', () => {
      expect(pay('buster', ctx('Ts 7d', 'Ts 6d 6c'))).toMatchObject({ pays: 2, combo: '3-4' });
      expect(pay('buster', ctx('Ts 7d', '2s 3d 4c 3h Tc'))).toMatchObject({ pays: 4 });
      expect(pay('buster', ctx('Ts 7d', '2s 2d 2c 3h 4c Tc'))).toMatchObject({ pays: 18 });
      expect(pay('buster', ctx('Ts 7d', 'As 2d 2c 2h 3c 4c Tc'))).toMatchObject({ pays: 50 });
      expect(pay('buster', ctx('As Kd', 'As 2d 2c 2h 3c 4c Tc', true, true))).toMatchObject({ pays: 800 });
      expect(pay('buster', ctx('Ts 7d', 'As Ad 2c 2h 2d 3c 4c Td'))).toMatchObject({ pays: 250 });
      expect(pay('buster', ctx('As Kd', 'As Ad 2c 2h 2d 3c 4c Td', true, true))).toMatchObject({ pays: 2000 });
      expect(pay('buster', ctx('Ts 7d', 'Ts 7d'))).toMatchObject({ result: 'lose' });          // dealer stood without drawing
      expect(pay('buster', ctx('Ts 7d', 'Ts 6d 6c', false))).toMatchObject({ result: 'lose' }); // never paid before the hand is complete
    });
    it('Lucky Lucky: special 7-7-7 / 6-7-8 combinations, then totals with Blackjack ace counting; not poker', () => {
      const L = (p: string, up: string) => pay('lucky-lucky', ctx(p, `${up} 2c`));
      expect(L('7h 7h', '7h')).toMatchObject({ pays: 200 });
      expect(L('6s 7s', '8s')).toMatchObject({ pays: 100 });
      expect(L('7h 7d', '7c')).toMatchObject({ pays: 50 });
      expect(L('8h 6d', '7c')).toMatchObject({ pays: 25 });
      expect(L('9s Qs', '2s')).toMatchObject({ pays: 15 });
      expect(L('As As', '9s')).toMatchObject({ pays: 15 });                // A+A+9 = 21 (11+1+9), suited
      expect(L('9s Qd', '2s')).toMatchObject({ pays: 3 });
      expect(L('Ks Qd', 'Ah')).toMatchObject({ pays: 3 });                 // 10+10+A(1) = 21
      expect(L('Ks 8d', '2h')).toMatchObject({ pays: 2, combo: '20' });
      expect(L('Ks 7d', '2h')).toMatchObject({ pays: 2, combo: '19' });
      expect(L('4s 5d', '6c')).toMatchObject({ result: 'lose' });          // a straight is not a Lucky Lucky win
    });
    it('Lucky Ladies (PT-FLTLL-01/02/03): Q♥ pair with dealer Blackjack, Q♥ pair, matched, suited, any 20', () => {
      const exp = { 'pt-fltll-01': [1000, 200, 20, 20, 4], 'pt-fltll-02': [1000, 150, 25, 10, 4], 'pt-fltll-03': [1000, 125, 20, 9, 4] };
      for (const [v, [dbj, qh, m, s, a]] of Object.entries(exp)) {
        expect(pay('lucky-ladies', ctx('Qh Qh', 'As Kd'), v)).toMatchObject({ pays: dbj });
        expect(pay('lucky-ladies', ctx('Qh Qh', '9s Kd'), v)).toMatchObject({ pays: qh });
        expect(pay('lucky-ladies', ctx('Ks Ks', '9s Kd'), v)).toMatchObject({ pays: m });
        expect(pay('lucky-ladies', ctx('Ks Qs', '9s Kd'), v)).toMatchObject({ pays: s });
        expect(pay('lucky-ladies', ctx('Ks Qd', '9s Kd'), v)).toMatchObject({ pays: a });
        expect(pay('lucky-ladies', ctx('As 9d', '9s Kd'), v)).toMatchObject({ pays: a });   // soft 20 is a 20
        expect(pay('lucky-ladies', ctx('Ks 9d', '9s Kd'), v)).toMatchObject({ result: 'lose' });
      }
    });
    it('Match the Dealer (six-deck table): suited and unsuited matches combine into one payout', () => {
      const M = (p: string, up: string) => pay('match-dealer', ctx(p, `${up} 2c`));
      expect(M('7h 7h', '7h')).toMatchObject({ pays: 22 });
      expect(M('7h 7d', '7h')).toMatchObject({ pays: 15 });
      expect(M('7h 2d', '7h')).toMatchObject({ pays: 11 });
      expect(M('7s 7d', '7h')).toMatchObject({ pays: 8 });
      expect(M('7s 2d', '7h')).toMatchObject({ pays: 4 });
      expect(M('8s 2d', '7h')).toMatchObject({ result: 'lose' });
    });
    it('host configuration: presets, custom validation, and bet validation (closed wager, limits, whole dollars, bankroll)', () => {
      const all = BS.bjSidesPreset('allbets');
      expect(BS.enabledBjSides(all).map((d) => d.id)).toEqual([...BS.ALL_BETS_SIX]);
      expect(BS.enabledBjSides(BS.bjSidesPreset('classic'))).toEqual([]);
      expect(BS.parseBjSidesConfig({ preset: 'custom', bets: { 'super-sevens': { on: true } } })).toMatch(/not available/);
      expect(BS.parseBjSidesConfig({ preset: 'custom', bets: { top3: { variant: 'made-up' } } })).toMatch(/Unknown pay table/);
      expect(BS.parseBjSidesConfig({ preset: 'custom', bets: { top3: { on: true, min: 500, max: 100 } } })).toMatch(/at least the minimum/);
      const custom = BS.parseBjSidesConfig({ preset: 'custom', bets: { 'lucky-ladies': { on: true, variant: 'pt-fltll-02', min: 500, max: 5000 } } }) as BS.BjSidesConfig;
      expect(custom.bets['lucky-ladies']).toEqual({ on: true, variant: 'pt-fltll-02', min: 500, max: 5000 });
      expect(BS.validateBjSides({ 'lucky-ladies': 100 }, custom)).toMatch(/Minimum/);
      expect(BS.validateBjSides({ 'lucky-ladies': 550 }, custom)).toMatch(/whole dollars/);
      expect(BS.validateBjSides({ top3: 500 }, custom)).toMatch(/not open/);
      expect(BS.validateBjSides({ 'hot-3': 500 }, custom)).toMatch(/not offered/);
      const lim = { minAnte: 500, maxAnte: 10_000, bjSides: all, progressiveWager: 500 };
      const bet = { ...RU.NO_BETS, ante: 2500, progressive: 500, bjSides: { 'perfect-player': 500, 'perfect-dealer': 500, twentyone3: 500, top3: 500, buster: 500, 'lucky-lucky': 500 } };
      expect(RU.validateBjBet(bet, 6000, lim)).toBeNull();                   // $25 + 6×$5 + $5 = $60
      expect(RU.validateBjBet(bet, 5900, lim)).toMatch(/Not enough chips/);  // insufficient bankroll
      expect(RU.validateBjBet({ ...bet, progressive: 100 }, 6000, lim)).toMatch(/fixed \$5/);
    });
  });

  describe('§33 file budget', () => {
    it(`the project has no more than ${FILE_CAP} tracked files`, () => {
      const r = countFiles();
      console.log(`[file count] ${r.total} tracked files (cap ${r.cap}) · ${r.areas.map((a: { name: string; count: number }) => `${a.name} ${a.count}`).join(' · ')}`);
      expect(r.total).toBeLessThanOrEqual(99);
      expect(r.files.some((f: string) => f.startsWith('node_modules/') || f.startsWith('dist/'))).toBe(false);
    });
  });
});

describe('music', () => {
  const ok = { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', name: 'Song', artist: 'Band', art: 'https://i.scdn.co/image/ab67616d00001e02abc123', durationMs: 200_000, progressMs: 30_000, isPlaying: true };
  it('accepts a plain Spotify track and keeps only safe fields', () => {
    expect(parseMusicNow({ ...ok, extra: 'x' })).toEqual(ok);
    expect(parseMusicNow({ ...ok, progressMs: 999_999 })!.progressMs).toBe(200_000);          // clamped to the track
    expect(parseMusicNow({ ...ok, name: 'A\u0000B'.padEnd(300, 'z') })!.name).toHaveLength(120);
  });
  it('rejects anything that is not a Spotify track URI or has bad numbers', () => {
    for (const uri of ['spotify:episode:4uLU6hMCjMI75M1A2tKUQC', 'spotify:track:short', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC<'])
      expect(parseMusicNow({ ...ok, uri })).toBeNull();
    expect(parseMusicNow({ ...ok, durationMs: -1 })).toBeNull();
    expect(parseMusicNow({ ...ok, progressMs: Number.NaN })).toBeNull();
    expect(parseMusicNow(null)).toBeNull();
  });
  it('only Spotify CDN artwork is kept (no arbitrary image URLs reach other players)', () => {
    expect(parseMusicNow({ ...ok, art: 'https://evil.example/x.png' })!.art).toBeNull();
    expect(parseMusicNow({ ...ok, art: 'javascript:alert(1)' })!.art).toBeNull();
  });
  it('listener position follows the host clock while playing and holds while paused', () => {
    const m = { ...ok, hostId: 'h', hostName: 'H', at: 1_000 };
    expect(musicPosition(m, 6_000)).toBe(35_000);
    expect(musicPosition({ ...m, isPlaying: false }, 60_000)).toBe(30_000);
    expect(musicPosition(m, 10_000_000)).toBe(200_000);
    expect(musicPosition(m, 0)).toBe(30_000);                                                  // clock skew never rewinds
  });
});
