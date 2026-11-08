// §28.3 Chip collection browser: 15 designs × 9 denominations, a turning 3-D preview, a preview on the felt,
// buy a set or a single chip, equip a whole tray or one denomination, unequip, set as default.
// Ownership and prices come from the server; values never change with the design.
import { CHIP_COLLECTIONS, DENOMS, DENOM_NAME, chipItemId, denomSlot, renderChip, type ChipCollectionId, type Denom } from '../../shared/chips.js';
import { ITEM, ownsItem, type Equipped } from '../../shared/cosmetics.js';
import { credits, saveAvatar, type CatalogItem, type Mine } from '../cosmetics.js';
import { h, toast } from '../dom.js';

export function chipBrowser(ctx: { mine: () => Mine; items: CatalogItem[]; buy: (it: CatalogItem) => void; refresh: () => Promise<void> }) {
  let col: ChipCollectionId = 'classic';
  let denom: Denom = 2_500;
  const root = h('div', { class: 'chip-browser' });
  const price = (id: string) => ctx.items.find((i) => i.id === id)?.price ?? 0;
  const owned = () => new Set(ctx.mine().owned.map((o) => o.itemId));
  const eq = () => ctx.mine().avatar.equipped as Record<string, string | undefined>;
  const current = (d: Denom): ChipCollectionId => {
    const o = eq()[denomSlot(d)];
    const m = o ? /^chip-([a-z]+)-/.exec(o) : null;
    if (m) return m[1] as ChipCollectionId;
    return (CHIP_COLLECTIONS.find((c) => c.setId === eq().chips)?.id ?? 'classic') as ChipCollectionId;
  };

  async function equip(next: Equipped, msg: string) {
    try { await saveAvatar({ ...ctx.mine().avatar, equipped: next, preset: 'custom' }); await ctx.refresh(); toast(msg, 'success'); }
    catch (e: any) { toast(e.message, 'error'); }
  }
  function draw() {
    const c = CHIP_COLLECTIONS.find((x) => x.id === col)!;
    const setOwned = ownsItem(owned(), c.setId);
    const single = chipItemId(col, denom);
    const singleOwned = ownsItem(owned(), single);
    const big = h('div', { class: 'chip3d', role: 'img', 'aria-label': `${c.name} ${DENOM_NAME[denom]}` });
    big.innerHTML = `<div class="chip3d-face">${renderChip(denom, col)}</div><div class="chip3d-edge"></div>`;
    const felt = h('div', { class: 'chip-felt', 'aria-label': 'Preview on the table' },
      h('div', { class: 'cf-spot' }, ...[0, 1, 2].map((i) => { const e = h('i', { style: `--i:${i}` }); e.innerHTML = renderChip(denom, col); return e; })),
      h('span', { class: 'cf-label' }, `Bet ${DENOM_NAME[denom]} ×3`));
    const tray = h('div', { class: 'chip-denoms', role: 'radiogroup', 'aria-label': 'Denomination' }, ...DENOMS.map((d) => {
      const b = h('button', { class: `cd ${d === denom ? 'on' : ''} ${ownsItem(owned(), chipItemId(col, d)) ? 'own' : ''}`, role: 'radio', 'aria-checked': String(d === denom), title: DENOM_NAME[d],
        onclick: () => { denom = d; draw(); } });
      b.innerHTML = renderChip(d, col);
      return b;
    }));
    const usingSet = eq().chips === c.setId;
    const usingHere = current(denom) === col;
    const actions = h('div', { class: 'row chip-actions' },
      setOwned ? null : h('button', { class: 'btn gold', onclick: () => ctx.buy(ctx.items.find((i) => i.id === c.setId)!) }, `Buy the set · ${credits(price(c.setId))}`),
      singleOwned ? null : h('button', { class: 'btn', onclick: () => ctx.buy(ctx.items.find((i) => i.id === single)!) }, `Buy ${DENOM_NAME[denom]} only · ${credits(price(single))}`),
      setOwned && !usingSet ? h('button', { class: 'btn gold', onclick: () => {
        const next = { ...ctx.mine().avatar.equipped, chips: c.setId } as Record<string, string | undefined>;
        for (const d of DENOMS) delete next[denomSlot(d)];
        equip(next as Equipped, `${c.name} is now your whole tray (and your default).`);
      } }, 'Use for the whole tray') : null,
      singleOwned && !usingHere ? h('button', { class: 'btn', onclick: () => equip({ ...ctx.mine().avatar.equipped, [denomSlot(denom)]: single } as Equipped, `${DENOM_NAME[denom]} chips now use ${c.name}.`) }, `Use for ${DENOM_NAME[denom]} only`) : null,
      eq()[denomSlot(denom)] ? h('button', { class: 'btn ghost', onclick: () => { const next = { ...ctx.mine().avatar.equipped } as Record<string, string | undefined>; delete next[denomSlot(denom)]; equip(next as Equipped, `${DENOM_NAME[denom]} chips back to your tray design.`); } }, `Unequip ${DENOM_NAME[denom]}`) : null,
      eq().chips && eq().chips !== 'chips-classic' && usingSet ? h('button', { class: 'btn ghost', onclick: () => equip({ ...ctx.mine().avatar.equipped, chips: 'chips-classic' } as Equipped, 'Back to Classic Vegas.') }, 'Unequip set') : null);
    root.replaceChildren(
      h('h2', {}, 'Chip collections'),
      h('p', { class: 'muted' }, 'Fifteen designs for every value from $1 to the $100,000 plaque. A design never changes what a chip is worth — a $500 Diamond Reserve chip is still exactly $500.'),
      h('div', { class: 'chip-cols' }, ...CHIP_COLLECTIONS.map((x) => {
        const b = h('button', { class: `chip-col ${x.id === col ? 'on' : ''}`, onclick: () => { col = x.id; draw(); } });
        b.innerHTML = `<span class="cc-chips">${([500, 2_500, 10_000] as Denom[]).map((d) => renderChip(d, x.id)).join('')}</span>`;
        b.append(h('b', {}, x.name), h('small', {}, ownsItem(owned(), x.setId) ? (eq().chips === x.setId ? 'In use' : 'Owned') : credits(price(x.setId))));
        return b;
      })),
      h('section', { class: 'chip-detail' },
        h('div', { class: 'chip-stage' }, big, felt),
        h('div', { class: 'chip-info' },
          h('h3', {}, `${c.name} — ${DENOM_NAME[denom]}`), h('p', { class: 'muted' }, c.blurb),
          tray,
          h('p', { class: 'tiny muted' }, (() => {
            const trayCol = CHIP_COLLECTIONS.find((x) => x.setId === eq().chips)?.name ?? 'Classic Vegas';
            const mixed = DENOMS.filter((d) => eq()[denomSlot(d)]).map((d) => `${DENOM_NAME[d]} in ${CHIP_COLLECTIONS.find((x) => x.id === current(d))!.name}`);
            return `Owned in this design: ${DENOMS.filter((d) => ownsItem(owned(), chipItemId(col, d))).length} of 9. Your tray: ${trayCol}${mixed.length ? ` (except ${mixed.join(', ')})` : ''}.`;
          })()),
          actions)));
  }
  draw();
  return { root, redraw: draw };
}
void ITEM;
