import { describe, expect, it } from 'vitest';
import {
  CATALOG, COLLECTIONS, DEFAULT_APPEARANCE, ITEM, REWARDS, SLOTS, fitEquipped, parseAppearance, randomAvatar, validateEquipped,
} from '../../src/shared/cosmetics';
import { renderAvatar, renderItemPreview } from '../../src/shared/avatarSvg';
import { Cosmetics } from '../../src/server/cosmetics';
import { MemoryStore } from '../../src/server/memoryStore';

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
    for (const it of CATALOG) expect(renderItemPreview(it.id), it.id).toMatch(/^<svg/);
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
