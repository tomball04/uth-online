// Server side of §24: catalog prices, Style Credit rewards, purchases and saved looks.
// The server alone decides ownership and balances. Nothing here reads or writes casino chips.

import {
  CATALOG, COLLECTIONS, DEFAULT_AVATAR, ITEM, OUTFIT_PRESETS, REWARD, REWARDS, cleanEquipped, collectionItems, fitEquipped,
  parseAppearance, validateEquipped, type AvatarData, type Equipped, type Item, type OutfitPreset, type PublicLook,
} from '../shared/cosmetics.js';
import type { Store } from './store.js';

export interface CosmeticsConfig {
  /** Price overrides by item id (whole credits). */
  prices?: Record<string, number>;
  /** Reward overrides by reward id (whole credits). */
  rewards?: Record<string, number>;
  /** Items to hide from the Boutique (already-owned copies stay usable). */
  unavailable?: string[];
}

/** Reads overrides from env JSON: COSMETIC_PRICES, STYLE_REWARDS, COSMETIC_UNAVAILABLE. Bad JSON is ignored. */
export function cosmeticsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CosmeticsConfig {
  const j = <T>(k: string): T | undefined => { try { return env[k] ? JSON.parse(env[k]!) as T : undefined; } catch { console.warn(`[cosmetics] ignoring invalid ${k}`); return undefined; } };
  return { prices: j('COSMETIC_PRICES'), rewards: j('STYLE_REWARDS'), unavailable: j('COSMETIC_UNAVAILABLE') };
}

export type ClientEvent = 'tutorial' | 'trainer';
export class CosmeticError extends Error {}

export interface CatalogItem extends Item { price: number; owned?: boolean }

export class Cosmetics {
  private prices = new Map<string, number>();
  private rewardAmt = new Map<string, number>();
  private hidden: Set<string>;
  /** Serializes reward checks per player so concurrent settlements can't race the same reward. */
  private chains = new Map<string, Promise<unknown>>();

  constructor(private store: Store, cfg: CosmeticsConfig = {}) {
    for (const it of CATALOG) {
      const o = cfg.prices?.[it.id];
      this.prices.set(it.id, Number.isInteger(o) && o! >= 0 ? o! : it.price);
    }
    for (const r of REWARDS) {
      const o = cfg.rewards?.[r.id];
      this.rewardAmt.set(r.id, Number.isInteger(o) && o! >= 0 ? o! : r.credits);
    }
    this.hidden = new Set(Array.isArray(cfg.unavailable) ? cfg.unavailable : []);
  }

  price(id: string) { return this.prices.get(id) ?? Infinity; }
  rewardCredits(id: string) { return this.rewardAmt.get(id) ?? 0; }

  catalog(): CatalogItem[] {
    return CATALOG.map((it) => ({ ...it, price: this.price(it.id), available: it.available && !this.hidden.has(it.id) }));
  }
  rewards() { return REWARDS.map((r) => ({ ...r, credits: this.rewardCredits(r.id) })); }

  private serial<T>(pid: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(pid) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.chains.set(pid, next);
    next.finally(() => { if (this.chains.get(pid) === next) this.chains.delete(pid); }).catch(() => {});
    return next;
  }

  private async ownedSet(pid: string) {
    const st = await this.store.getCosmetics(pid);
    return { st, owned: new Set(st.owned.map((o) => o.itemId)) };
  }

  /** Grant a once-only reward (and any item it unlocks). Safe to call repeatedly. */
  private async reward(pid: string, id: string, key = `reward:${id}:${pid}`) {
    const r = REWARD.get(id);
    if (!r) return false;
    const items = CATALOG.filter((i) => i.unlock === id).map((i) => i.id);
    const res = await this.store.grant(pid, { key, rewardId: id, amount: this.rewardCredits(id), items, method: 'reward', note: r.name });
    return res.applied;
  }

  /** New and returning players get the welcome allowance once. */
  welcome(pid: string) { return this.serial(pid, () => this.reward(pid, 'welcome')); }

  /** Rewards for things done in the browser that the server can't observe. Each pays once. */
  async event(pid: string, ev: ClientEvent) {
    if (ev !== 'tutorial' && ev !== 'trainer') throw new CosmeticError('Unknown event.');
    return this.serial(pid, () => this.reward(pid, ev));
  }
  tableTalk(pid: string) { return this.serial(pid, () => this.reward(pid, 'table-talk')); }

  /**
   * After a hand settles. Reads only counts (hands, games, nights, decision accuracy) — never wager sizes,
   * profit, losses or jackpots — so playing bigger or losing more can't earn more.
   */
  afterHand(pid: string, nightId: string | null) {
    return this.serial(pid, async () => {
      const f = await this.store.rewardFacts(pid, nightId);
      const got: string[] = [];
      const give = async (id: string, ok: boolean, key?: string) => { if (ok && (await this.reward(pid, id, key))) got.push(id); };
      await give('first-hand', f.hands >= 1);
      await give('hands-25', f.hands >= 25);
      await give('hands-100', f.hands >= 100);
      await give('both-games', f.games.includes('uth') && f.games.includes('tcp'));
      await give('game-night', f.friendHands >= 1);
      await give('return-night', f.nights >= 2);
      await give('student', f.decisions >= 20 && f.correct / f.decisions >= 0.75);
      if (nightId) await give('session', f.nightHands >= 10, `reward:session:${nightId}:${pid}`);
      return got;
    });
  }

  /** Buy an item. `key` is the client's idempotency key: retrying the same purchase never charges twice. */
  async buy(pid: string, itemId: unknown, key: unknown) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new CosmeticError('Missing purchase key.');
    const it = typeof itemId === 'string' ? ITEM.get(itemId) : undefined;
    if (!it) throw new CosmeticError('That item isn’t in the Boutique.');
    if (it.free) throw new CosmeticError(`${it.name} is free — no need to buy it.`);
    if (it.unlock) throw new CosmeticError(`${it.name} can’t be bought; it’s earned.`);
    if (!it.available || this.hidden.has(it.id)) throw new CosmeticError(`${it.name} isn’t available right now.`);
    const price = this.price(it.id);
    return this.serial(pid, async () => {
      const r = await this.store.purchase(pid, it.id, price, `buy:${pid}:${key}`, it.name);
      if (r.status === 'insufficient') throw new CosmeticError(`Not enough Style Credits — ${it.name} costs ${price}.`);
      let bonus: string | null = null;
      if (r.status === 'ok' && it.collection) bonus = await this.collectionBonus(pid, it.collection);
      return { ...r, item: it.id, bonus };
    });
  }

  /** Completing a collection grants its reward item (cosmetic only). */
  private async collectionBonus(pid: string, cid: string) {
    const col = COLLECTIONS.find((c) => c.id === cid);
    if (!col) return null;
    const { owned } = await this.ownedSet(pid);
    if (!collectionItems(cid).every((i) => owned.has(i.id))) return null;
    const res = await this.store.grant(pid, { key: `collection:${cid}:${pid}`, rewardId: null, amount: 0, items: [col.reward], method: 'collection', note: `${col.name} collection complete` });
    return res.applied ? col.reward : null;
  }

  /** Owned = bought, earned or a free item. */
  owns(owned: Set<string>, id: string) { const it = ITEM.get(id); return !!it && (!!it.free || owned.has(id)); }

  /** The player's saved look, or a default. */
  async look(pid: string): Promise<AvatarData> {
    const st = await this.store.getCosmetics(pid);
    return st.avatar ?? DEFAULT_AVATAR;
  }

  /**
   * Validate and save. Every value must be an enumerated appearance option or an item the server says this
   * player owns; anything else is rejected. Returns the saved data.
   */
  async save(pid: string, input: unknown): Promise<AvatarData> {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const appearance = parseAppearance(i.appearance);
    if (!appearance) throw new CosmeticError('Invalid appearance.');
    const { st, owned } = await this.ownedSet(pid);
    const owns = (id: string) => owned.has(id);
    const err = validateEquipped(i.equipped, owns);
    if (err) throw new CosmeticError(err);
    const equipped = cleanEquipped(i.equipped);
    const preset: OutfitPreset = OUTFIT_PRESETS.includes(i.preset as OutfitPreset) ? i.preset as OutfitPreset : 'custom';
    const outfits: Partial<Record<OutfitPreset, Equipped>> = {};
    if (i.outfits && typeof i.outfits === 'object') {
      for (const p of OUTFIT_PRESETS) {
        const o = (i.outfits as Record<string, unknown>)[p];
        if (o === undefined || o === null) continue;
        if (validateEquipped(o, owns)) throw new CosmeticError(`Your ${p} outfit uses an item you don’t own.`);
        outfits[p] = cleanEquipped(o);
      }
    }
    const data: AvatarData = { appearance, equipped, preset, outfits };
    await this.store.saveAvatar(pid, data);
    void st;
    await this.serial(pid, () => this.reward(pid, 'first-avatar'));
    return data;
  }

  /** Switch to a saved outfit preset (items re-checked against current ownership). */
  async wear(pid: string, preset: unknown): Promise<AvatarData> {
    if (!OUTFIT_PRESETS.includes(preset as OutfitPreset)) throw new CosmeticError('Unknown outfit.');
    const cur = await this.look(pid);
    const o = cur.outfits[preset as OutfitPreset];
    if (!o) throw new CosmeticError('That outfit is empty — save one first.');
    const { owned } = await this.ownedSet(pid);
    const equipped = fitEquipped(Object.fromEntries(Object.entries(o).filter(([, id]) => this.owns(owned, id!))) as Equipped);
    const data = { ...cur, equipped, preset: preset as OutfitPreset };
    await this.store.saveAvatar(pid, data);
    return data;
  }

  /** Public profile: look, owned item count, collections and rewards. No chips, balances or hand data. */
  async profile(pid: string) {
    const st = await this.store.getCosmetics(pid);
    const owned = new Set(st.owned.map((o) => o.itemId));
    const look: PublicLook | null = st.avatar ? { appearance: st.avatar.appearance, equipped: st.avatar.equipped } : null;
    return {
      playerId: pid, look,
      items: st.owned.length,
      collections: COLLECTIONS.filter((c) => collectionItems(c.id).every((i) => owned.has(i.id))).map((c) => c.id),
      achievements: st.rewards.filter((r) => r.rewardId !== 'session').map((r) => r.rewardId).filter((v, i, a) => a.indexOf(v) === i),
    };
  }
}
