// Client side of §24. The server owns balances and ownership; this module only fetches, caches and asks.
import { api } from './api.js';
import type { AvatarData, COLLECTIONS, Item, OutfitPreset, PublicLook, REWARDS } from '../shared/cosmetics.js';
import { renderAvatar, type Pose } from '../shared/avatarSvg.js';
import { h, initials } from './dom.js';

export interface CatalogItem extends Item { price: number }
export interface Catalog { items: CatalogItem[]; rewards: (typeof REWARDS)[number][]; collections: (typeof COLLECTIONS)[number][] }
export interface StyleTx { id: number; kind: 'earn' | 'purchase'; amount: number; balanceAfter: number; itemId: string | null; rewardId: string | null; note: string; at: number }
export interface Mine { balance: number; owned: { itemId: string; method: string; at: number }[]; avatar: AvatarData; rewards: { rewardId: string; at: number }[]; history: StyleTx[] }

let catalogP: Promise<Catalog> | null = null;
export const catalog = () => (catalogP ??= api<Catalog>('/api/catalog').catch((e) => { catalogP = null; throw e; }));

let mine: Mine | null = null;
const listeners = new Set<(m: Mine) => void>();
export const onMine = (fn: (m: Mine) => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { if (mine) listeners.forEach((l) => l(mine!)); };

export async function loadMine(force = false): Promise<Mine> {
  if (mine && !force) return mine;
  mine = await api<Mine>('/api/me/cosmetics');
  emit();
  return mine;
}
export const cachedMine = () => mine;
export function setBalance(balance: number) { if (mine) { mine = { ...mine, balance }; emit(); } }

export async function saveAvatar(data: AvatarData) {
  const r = await api<{ avatar: AvatarData; balance: number }>('/api/me/avatar', { method: 'PUT', body: JSON.stringify(data) });
  await loadMine(true);
  return r.avatar;
}
export async function wearOutfit(preset: OutfitPreset) {
  const r = await api<{ avatar: AvatarData }>('/api/me/outfit', { method: 'POST', body: JSON.stringify({ preset }) });
  await loadMine(true);
  return r.avatar;
}

/**
 * Buy with an idempotency key. If the network drops mid-request we retry with the SAME key, so the server
 * charges at most once; a 'duplicate' answer means the first attempt already went through.
 */
export async function purchase(itemId: string): Promise<{ status: string; balance: number; bonus: string | null }> {
  const key = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await api<{ status: string; balance: number; bonus: string | null }>('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId, key }) });
      await loadMine(true);
      return r;
    } catch (e: any) {
      last = e;
      if (e?.status) throw e;              // the server answered: don't retry
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

const sentEvents = new Set<string>();
/** Tell the server about something it can't see (opening How to Play, trying the trainer). Pays once. */
export function styleEvent(event: 'tutorial' | 'trainer') {
  if (sentEvents.has(event)) return;
  sentEvents.add(event);
  api<{ applied: boolean; balance: number }>('/api/me/event', { method: 'POST', body: JSON.stringify({ event }) })
    .then((r) => { if (r.applied) { setBalance(r.balance); earnedToast([event]); } }).catch(() => sentEvents.delete(event));
}

let toastFn: ((rewards: string[]) => void) | null = null;
export const setEarnedToast = (fn: (rewards: string[]) => void) => { toastFn = fn; };
export const earnedToast = (rewards: string[]) => toastFn?.(rewards);

/** A portrait element. Falls back to initials when no look is saved. The SVG is built from enumerated values only. */
export function portrait(look: PublicLook | null | undefined, name: string, opts: { pose?: Pose; frame?: boolean; cls?: string } = {}) {
  const el = h('span', { class: `portrait ${opts.cls ?? ''}`, role: 'img', 'aria-label': `${name}’s avatar` });
  setPortrait(el, look, name, opts);
  return el;
}
export function setPortrait(el: HTMLElement, look: PublicLook | null | undefined, name: string, opts: { pose?: Pose; frame?: boolean } = {}) {
  const key = look ? JSON.stringify([look, opts.pose, opts.frame]) : `i:${name}`;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!look) { el.textContent = initials(name); el.classList.add('initials'); return; }
  el.classList.remove('initials');
  el.innerHTML = renderAvatar(look, { pose: opts.pose, frame: opts.frame });   // safe: enumerated values only (see avatarSvg.ts)
  if (el.querySelector('.bx')) watchOffscreen(el);
}

// §29: animated borders pause while their portrait is scrolled out of view (or the tab is hidden).
let io: IntersectionObserver | null = null;
function watchOffscreen(el: HTMLElement) {
  if (typeof IntersectionObserver === 'undefined') return;
  io ??= new IntersectionObserver((es) => { for (const e of es) (e.target as HTMLElement).classList.toggle('paused', !e.isIntersecting); });
  io.observe(el);
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('paused', document.hidden); });

export const credits = (n: number) => `${n.toLocaleString('en-US')} credits`;

// Looks for recaps, replays and history (players who may not be seated now). Batched and cached.
const lookCache = new Map<string, PublicLook | null>();
let pending = new Map<string, ((l: PublicLook | null) => void)[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flushLooks() {
  const batch = pending; pending = new Map(); flushTimer = null;
  const ids = [...batch.keys()];
  for (let i = 0; i < ids.length; i += 24) {
    const chunk = ids.slice(i, i + 24);
    api<{ looks: Record<string, PublicLook> }>(`/api/looks?ids=${chunk.map(encodeURIComponent).join(',')}`)
      .then((r) => chunk.forEach((id) => { const l = r.looks[id] ?? null; lookCache.set(id, l); batch.get(id)!.forEach((f) => f(l)); }))
      .catch(() => chunk.forEach((id) => batch.get(id)!.forEach((f) => f(null))));
  }
}
/** A portrait that fills itself in once the player's look arrives. */
export function lazyPortrait(playerId: string, name: string, cls = '') {
  const el = portrait(lookCache.get(playerId) ?? null, name, { cls });
  if (lookCache.has(playerId)) return el;
  const list = pending.get(playerId) ?? [];
  list.push((l) => setPortrait(el, l, name));
  pending.set(playerId, list);
  flushTimer ??= setTimeout(flushLooks, 0);
  return el;
}
