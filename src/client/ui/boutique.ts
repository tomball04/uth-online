// Casino Boutique (§24.7–24.9): catalog, try-on, purchases, inventory, ways to earn and history.
// Prices and ownership come from the server; this page never decides either.
import { CATEGORIES, ITEM, fitEquipped, ownsItem, validateEquipped, type Equipped } from '../../shared/cosmetics.js';
import { renderAvatar, renderItemPreview } from '../../shared/avatarSvg.js';
import { catalog, credits, loadMine, purchase, saveAvatar, type Catalog, type CatalogItem, type Mine } from '../cosmetics.js';
import { h, modal, toast } from '../dom.js';
import { chipBrowser } from './chipBrowser.js';

type View = string; // category id | 'inventory' | 'earn' | 'history'
const WEARABLE = new Set(['outfit', 'hat', 'eyewear', 'earrings', 'necklace', 'watch', 'neckwear', 'lapel', 'frame', 'background']);
const RARITY: Record<string, string> = { standard: 'Standard', fine: 'Fine', rare: 'Rare', legendary: 'Legendary' };

export function mountBoutique(root: HTMLElement, nav: (p: string) => void) {
  let cat: Catalog | null = null;
  let mine: Mine | null = null;
  let view: View = 'featured';
  let tryOn: Equipped = {};
  let chips: ReturnType<typeof chipBrowser> | null = null;
  const focus = new URLSearchParams(location.search).get('item');

  const wallet = h('span', { class: 'credits-pill' });
  const nav2 = h('nav', { class: 'bq-nav', 'aria-label': 'Boutique sections' });
  const grid = h('div', { class: 'bq-main' });
  const mirror = h('div', { class: 'bq-mirror-img' });
  const mirrorNote = h('div', { class: 'bq-mirror-note' });

  root.replaceChildren(h('main', { class: 'boutique' },
    h('header', { class: 'page-head' },
      h('button', { class: 'ghost back-btn', onclick: () => nav('/') }, '← Lobby'),
      h('h1', {}, 'Casino Boutique'),
      h('div', { class: 'head-right' }, wallet, h('button', { class: 'btn small', onclick: () => nav('/avatar') }, 'Edit avatar'))),
    h('p', { class: 'bq-note' }, 'Style Credits are earned by playing and learning — they’re not chips. They can’t be bought, bet, transferred or cashed out, and nothing here changes your odds or payouts.'),
    h('div', { class: 'bq-grid' },
      nav2,
      grid,
      h('aside', { class: 'bq-mirror', 'aria-label': 'Try-on mirror' }, h('h2', {}, 'Mirror'), mirror, mirrorNote,
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { tryOn = {}; drawMirror(); } }, 'Clear'),
          h('button', { class: 'btn small gold', onclick: () => wearTried() }, 'Wear this look'))))));

  (async () => {
    try {
      [cat, mine] = await Promise.all([catalog(), loadMine(true)]);
      if (focus && ITEM.get(focus)) { view = ITEM.get(focus)!.category; tryItem(focus); }
      drawAll();
      if (focus) setTimeout(() => document.getElementById(`item-${focus}`)?.scrollIntoView({ block: 'center' }), 50);
    } catch (e: any) { grid.replaceChildren(h('p', { class: 'muted' }, e.message ?? 'Couldn’t load the Boutique.')); }
  })();

  const owned = () => new Set(mine?.owned.map((o) => o.itemId) ?? []);
  const has = (it: CatalogItem) => ownsItem(owned(), it.id);

  function drawAll() { drawNav(); drawMain(); drawMirror(); mirrorAside().hidden = view === 'chips' || view === 'earn' || view === 'history'; }
  const mirrorAside = () => root.querySelector('.bq-mirror') as HTMLElement;

  function drawNav() {
    wallet.textContent = mine ? credits(mine.balance) : '';
    const btn = (id: View, text: string) => h('button', { class: `bq-tab ${view === id ? 'on' : ''}`, onclick: () => { view = id; drawAll(); } }, text);
    const cats = [...CATEGORIES.filter((c) => c.id === 'featured'), ...CATEGORIES.filter((c) => c.id !== 'featured')];
    nav2.replaceChildren(...cats.map((c) => btn(c.id, c.name)), h('hr'), btn('inventory', 'Your items'), btn('earn', 'Ways to earn'), btn('history', 'Credit history'));
  }

  function drawMirror() {
    if (!mine) return;
    const eq = fitEquipped({ ...mine.avatar.equipped, ...tryOn });
    mirror.innerHTML = renderAvatar({ appearance: mine.avatar.appearance, equipped: eq }, {});
    const tried = Object.values(tryOn).map((id) => ITEM.get(id!)!).filter(Boolean);
    const unowned = tried.filter((it) => !it.free && !owned().has(it.id));
    mirrorNote.replaceChildren(tried.length ? h('span', {}, `Trying on: ${tried.map((t) => t.name).join(', ')}.`) : h('span', { class: 'muted' }, 'Tap “Try on” to see an item on your avatar.'),
      ...(unowned.length ? [h('div', { class: 'muted tiny' }, `Not yours yet: ${unowned.map((t) => t.name).join(', ')}.`)] : []));
  }

  function tryItem(id: string) {
    const it = ITEM.get(id);
    if (!it || !WEARABLE.has(it.slot)) return;
    tryOn = { ...tryOn, [it.slot]: id };
    if ((it.needsCollar || it.needsJacket) && mine) {
      const outfit = ITEM.get(tryOn.outfit ?? mine.avatar.equipped.outfit ?? '');
      if (!(it.needsJacket ? outfit?.jacket : outfit?.collar)) tryOn.outfit = it.needsJacket ? 'blazer-grey' : 'shirt-white';
    }
    drawMirror();
  }

  async function wearTried() {
    if (!mine) return;
    const eq = fitEquipped({ ...mine.avatar.equipped, ...tryOn });
    const err = validateEquipped(eq, (id) => owned().has(id));
    if (err) { toast(err, 'info'); return; }
    try { await saveAvatar({ ...mine.avatar, equipped: eq, preset: 'custom' }); mine = await loadMine(); tryOn = {}; drawAll(); toast('You’re wearing it.', 'success'); }
    catch (e: any) { toast(e.message, 'error'); }
  }

  function card(it: CatalogItem) {
    const own = has(it);
    const img = h('span', { class: 'bq-img' });
    img.innerHTML = WEARABLE.has(it.slot) && mine
      ? renderAvatar({ appearance: mine.avatar.appearance, equipped: fitEquipped({ ...mine.avatar.equipped, [it.slot]: it.id, ...(it.needsJacket ? { outfit: 'blazer-grey' } : it.needsCollar && !ITEM.get(mine.avatar.equipped.outfit ?? '')?.collar ? { outfit: 'shirt-white' } : {}) }) }, { frame: it.slot === 'frame' })
      : renderItemPreview(it.id);
    const price = it.free ? 'Free' : it.unlock ? 'Earned' : credits(it.price);
    const action = own ? h('span', { class: 'owned-badge' }, it.free ? 'Free · yours' : '✓ Owned')
      : it.unlock ? h('span', { class: 'muted tiny' }, unlockText(it.unlock))
      : !it.available ? h('span', { class: 'muted tiny' }, 'Not available')
      : h('button', { class: 'btn small gold', onclick: () => confirmBuy(it) }, `Buy · ${it.price}`);
    return h('article', { class: `bq-card r-${it.rarity} ${own ? 'is-owned' : ''} ${focus === it.id ? 'focus' : ''}`, id: `item-${it.id}` },
      img,
      h('div', { class: 'bq-info' },
        h('h3', {}, it.name),
        h('div', { class: 'bq-meta' }, h('span', { class: `rar rar-${it.rarity}` }, RARITY[it.rarity]), it.collection ? h('span', { class: 'coll' }, cat!.collections.find((c) => c.id === it.collection)?.name ?? '') : null, h('span', { class: 'price' }, price)),
        h('p', { class: 'muted tiny' }, it.description),
        h('div', { class: 'row' }, WEARABLE.has(it.slot) ? h('button', { class: 'btn small ghost', onclick: () => tryItem(it.id) }, 'Try on') : null, action)));
  }

  function unlockText(u: string) {
    if (u.startsWith('collection:')) return `Complete the ${cat!.collections.find((c) => `collection:${c.id}` === u)?.name ?? ''} collection`;
    const r = cat!.rewards.find((x) => x.id === u);
    return r ? `Earned: ${r.name}` : 'Earned';
  }

  function drawMain() {
    if (!cat || !mine) return;
    if (view === 'featured') {
      grid.replaceChildren(h('h2', {}, 'Featured collections'),
        h('p', { class: 'muted' }, 'Own every piece of a collection to unlock its exclusive frame. Purely cosmetic.'),
        ...cat.collections.map((c) => {
          const its = cat!.items.filter((i) => i.collection === c.id);
          const n = its.filter((i) => owned().has(i.id)).length;
          const rew = cat!.items.find((i) => i.id === c.reward)!;
          const img = h('span', { class: 'bq-img sm' }); img.innerHTML = renderAvatar({ appearance: mine!.avatar.appearance, equipped: { ...mine!.avatar.equipped, frame: rew.id } }, {});
          return h('section', { class: 'bq-collection' },
            h('header', {}, img, h('div', {}, h('h3', {}, c.name), h('p', { class: 'muted tiny' }, c.description),
              h('div', { class: 'progress' }, h('span', { style: `width:${(100 * n) / its.length}%` })), h('div', { class: 'tiny' }, `${n} of ${its.length} · reward: ${rew.name}${owned().has(rew.id) ? ' ✓' : ''}`))),
            h('div', { class: 'bq-cards' }, ...its.map(card)));
        }));
      return;
    }
    if (view === 'inventory') {
      const mineItems = cat.items.filter((i) => owned().has(i.id));
      grid.replaceChildren(h('h2', {}, 'Your items'),
        mineItems.length ? h('div', { class: 'bq-cards' }, ...mineItems.map(card)) : h('p', { class: 'muted' }, 'Nothing bought yet. Free basics are always in the Character Creator.'),
        h('p', { class: 'muted tiny' }, 'Items stay yours forever, even if they leave the Boutique.'));
      return;
    }
    if (view === 'earn') {
      const got = new Set(mine.rewards.map((r) => r.rewardId));
      grid.replaceChildren(h('h2', {}, 'Ways to earn Style Credits'),
        h('p', { class: 'muted' }, 'Rewards come from playing, learning and showing up — never from how much you bet, win or lose.'),
        h('ul', { class: 'earn-list' }, ...cat.rewards.map((r) => h('li', { class: !r.once ? 'repeat' : got.has(r.id) ? 'done' : '' },
          h('span', { class: 'earn-mark' }, !r.once ? '↻' : got.has(r.id) ? '✓' : '○'),
          h('div', {}, h('b', {}, r.name), h('div', { class: 'muted tiny' }, r.description)),
          h('span', { class: 'earn-amt' }, `+${r.credits}`)))));
      return;
    }
    if (view === 'history') {
      grid.replaceChildren(h('h2', {}, 'Credit history'),
        mine.history.length ? h('table', { class: 'tables hist' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', { class: 'num' }, 'Credits'), h('th', { class: 'num' }, 'Balance'))),
          h('tbody', {}, ...mine.history.map((t) => h('tr', {},
            h('td', {}, new Date(t.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
            h('td', {}, t.kind === 'purchase' ? `Bought ${ITEM.get(t.itemId ?? '')?.name ?? t.note}` : t.note || 'Reward'),
            h('td', { class: `num ${t.amount >= 0 ? 'pos' : 'neg'}` }, t.amount >= 0 ? `+${t.amount}` : `−${-t.amount}`),
            h('td', { class: 'num' }, String(t.balanceAfter))))))
          : h('p', { class: 'muted' }, 'No credits yet.'));
      return;
    }
    if (view === 'chips') {
      chips ??= chipBrowser({ mine: () => mine!, items: cat.items, buy: (it) => confirmBuy(it), refresh: async () => { mine = await loadMine(); drawNav(); chips?.redraw(); } });
      chips.redraw();
      grid.replaceChildren(chips.root);
      return;
    }
    const list = cat.items.filter((i) => i.category === view && (i.available || owned().has(i.id)));
    grid.replaceChildren(h('h2', {}, CATEGORIES.find((c) => c.id === view)?.name ?? ''), h('div', { class: 'bq-cards' }, ...list.map(card)));
  }

  function confirmBuy(it: CatalogItem) {
    if (!mine) return;
    const after = mine.balance - it.price;
    const img = h('span', { class: 'bq-img' });
    img.innerHTML = WEARABLE.has(it.slot) ? renderAvatar({ appearance: mine.avatar.appearance, equipped: fitEquipped({ ...mine.avatar.equipped, [it.slot]: it.id }) }, {}) : renderItemPreview(it.id);
    const go = h('button', { class: 'btn gold', disabled: after < 0 }, `Buy for ${it.price}`) as HTMLButtonElement;
    const m = modal('Confirm purchase', h('div', { class: 'stack buy-confirm' }, img,
      h('p', {}, h('b', {}, it.name), ` costs ${credits(it.price)}.`),
      after >= 0 ? h('p', { class: 'muted' }, `You’ll have ${credits(after)} left.`) : h('p', { class: 'neg' }, `You need ${it.price - mine.balance} more credits. See Ways to earn.`),
      h('div', { class: 'row' }, go, h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'))));
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Buying…';
      try {
        const r = await purchase(it.id);
        mine = await loadMine();
        m.close(); drawAll(); chips?.redraw();
        const bonus = r.bonus ? ITEM.get(r.bonus) : null;
        toast(r.status === 'owned' ? `You already own ${it.name}.` : `${it.name} is yours.${bonus ? ` Collection complete — ${bonus.name} unlocked!` : ''}`, 'success', 5000);
        if (WEARABLE.has(it.slot) && r.status !== 'owned') offerWear(it);
      } catch (e: any) { toast(e.message, 'error'); go.disabled = false; go.textContent = `Buy for ${it.price}`; }
    });
  }

  function offerWear(it: CatalogItem) {
    const m = modal('Wear it now?', h('div', { class: 'stack' }, h('p', {}, `Put on ${it.name}?`),
      h('div', { class: 'row' },
        h('button', { class: 'btn gold', onclick: async () => { m.close(); tryOn = {}; tryItem(it.id); await wearTried(); } }, 'Wear it'),
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Later'))));
  }

  return { dispose() {} };
}
