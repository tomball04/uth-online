// Character Creator (§24.2–24.6): live preview, poses, randomize, per-category reset, restore saved, save, outfits.
import {
  BODY, BROWS, EYE_COLOR, EYES, FACE, FACIAL_HAIR, HAIR, HAIR_COLOR, ITEM, MOUTH, NOSE, OUTFIT_PRESETS, PRESET_NAME, SKIN,
  fitEquipped, ownsItem, randomAvatar, validateEquipped, type Appearance, type AvatarData, type Equipped, type OutfitPreset, type Slot,
} from '../../shared/cosmetics.js';
import { renderAvatar, renderItemPreview, type Pose } from '../../shared/avatarSvg.js';
import { catalog, credits, loadMine, saveAvatar, type CatalogItem, type Mine } from '../cosmetics.js';
import { h, toast } from '../dom.js';
import { session } from '../api.js';

type Tab = 'face' | 'hair' | 'clothing' | 'accessories' | 'frame' | 'table' | 'outfits';
const TABS: [Tab, string][] = [['face', 'Face'], ['hair', 'Hair'], ['clothing', 'Clothing'], ['accessories', 'Accessories'], ['frame', 'Frame & backdrop'], ['table', 'At the table'], ['outfits', 'Outfits']];
const TAB_SLOTS: Partial<Record<Tab, Slot[]>> = {
  clothing: ['outfit'], accessories: ['hat', 'eyewear', 'neckwear', 'lapel', 'earrings', 'necklace', 'watch'],
  frame: ['frame', 'background'], table: ['chips', 'cardBack', 'emotes', 'victory'],
};
const SLOT_NAME: Partial<Record<Slot, string>> = {
  outfit: 'Outfit', hat: 'Hat', eyewear: 'Eyewear', earrings: 'Earrings', necklace: 'Necklace', watch: 'Watch', neckwear: 'Tie, bow tie or scarf',
  lapel: 'Lapel & pocket', frame: 'Frame', background: 'Backdrop', chips: 'Poker chips', cardBack: 'Card backs', emotes: 'Reactions', victory: 'Victory animation',
};
const OPTIONAL: Slot[] = ['hat', 'eyewear', 'earrings', 'necklace', 'watch', 'neckwear', 'lapel'];
const label = (s: string) => s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function mountCreator(root: HTMLElement, nav: (p: string) => void) {
  let saved: AvatarData | null = null;
  let draft: AvatarData | null = null;
  let mine: Mine | null = null;
  let items: CatalogItem[] = [];
  let tab: Tab = 'face';
  let pose: Pose = 'front';
  let busy = false;

  const big = h('div', { class: 'cr-portrait' });
  const seatDemo = h('div', { class: 'cr-seat' });
  const wallet = h('span', { class: 'credits-pill' });
  const tabsEl = h('div', { class: 'cr-tabs', role: 'tablist' });
  const panel = h('div', { class: 'cr-panel-body' });
  const saveBtn = h('button', { class: 'btn gold', onclick: () => save() }, 'Save');
  const dirtyNote = h('span', { class: 'muted tiny cr-dirty' });
  const poses = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Pose' },
    ...(['left', 'front', 'right'] as Pose[]).map((p) => h('button', { class: 'seg-btn', 'data-p': p, onclick: () => { pose = p; drawPreview(); } }, p === 'front' ? 'Front' : p === 'left' ? '◂ Left' : 'Right ▸')));

  const owned = () => new Set(mine?.owned.map((o) => o.itemId) ?? []);
  const canUse = (id: string) => ownsItem(owned(), id);
  const dirty = () => !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  root.replaceChildren(h('main', { class: 'creator' },
    h('header', { class: 'page-head' },
      h('button', { class: 'ghost back-btn', 'aria-label': 'Back', onclick: () => leave('/') }, '← Lobby'),
      h('h1', {}, 'Character Creator'),
      h('div', { class: 'head-right' }, wallet, h('button', { class: 'btn small', onclick: () => leave('/boutique') }, 'Casino Boutique'))),
    h('div', { class: 'creator-grid' },
      h('section', { class: 'cr-preview' },
        big, poses,
        h('div', { class: 'cr-seat-wrap' }, h('span', { class: 'muted tiny' }, 'At the table'), seatDemo),
        h('div', { class: 'cr-actions' },
          h('button', { class: 'btn', onclick: () => randomize() }, '🎲 Randomize'),
          h('button', { class: 'btn', onclick: () => { if (saved) { draft = structuredClone(saved); drawAll(); } } }, 'Restore saved'),
          saveBtn),
        dirtyNote,
        h('p', { class: 'fine' }, 'Looks are cosmetic only. They never change cards, odds, payouts or chips.')),
      h('section', { class: 'cr-panel' }, tabsEl, panel))));

  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  function leave(path: string) {
    if (dirty() && !confirm('Leave without saving your changes?')) return;
    window.removeEventListener('beforeunload', beforeUnload);
    nav(path);
  }

  (async () => {
    try {
      const [c, m] = await Promise.all([catalog(), loadMine(true)]);
      items = c.items; mine = m;
      saved = structuredClone(m.avatar);
      draft = structuredClone(m.avatar);
      drawAll();
    } catch (e: any) { panel.replaceChildren(h('p', { class: 'muted' }, e.message ?? 'Couldn’t load your avatar.')); }
  })();

  function drawAll() { drawTabs(); drawPanel(); drawPreview(); }

  function drawPreview() {
    if (!draft) return;
    big.innerHTML = renderAvatar(draft, { pose });
    poses.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.p === pose));
    const name = session.me?.name ?? 'You';
    const av = h('div', { class: 'avatar' });
    av.innerHTML = renderAvatar(draft, {});
    seatDemo.replaceChildren(h('div', { class: 'plate demo-plate' }, av, h('div', { class: 'pinfo' }, h('div', { class: 'pname' }, name), h('div', { class: 'pbal' }, '$1,000'))));
    wallet.textContent = mine ? credits(mine.balance) : '';
    const d = dirty();
    saveBtn.toggleAttribute('disabled', !d || busy);
    dirtyNote.textContent = d ? 'Unsaved changes' : 'Saved';
  }

  function drawTabs() {
    tabsEl.replaceChildren(...TABS.map(([id, name]) => h('button', { class: `cr-tab ${tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(tab === id),
      onclick: () => { tab = id; drawTabs(); drawPanel(); } }, name)));
  }

  function setA<K extends keyof Appearance>(k: K, v: Appearance[K]) { draft!.appearance = { ...draft!.appearance, [k]: v }; draft!.preset = 'custom'; drawPanel(); drawPreview(); }
  function setSlot(slot: Slot, id: string | null) {
    const eq: Equipped = { ...draft!.equipped };
    if (id) eq[slot] = id; else delete eq[slot];
    draft!.equipped = slot === 'outfit' ? fitEquipped(eq) : eq;
    draft!.preset = 'custom';
    drawPanel(); drawPreview();
  }

  /** Small preview tiles: the option drawn on your own face. */
  function faceTile<K extends keyof Appearance>(k: K, v: Appearance[K], text: string) {
    const on = draft!.appearance[k] === v;
    const t = h('button', { class: `tile ${on ? 'on' : ''}`, 'aria-pressed': String(on), title: text, onclick: () => setA(k, v) });
    t.innerHTML = renderAvatar({ appearance: { ...draft!.appearance, [k]: v }, equipped: { outfit: draft!.equipped.outfit } }, { frame: false, background: false, crop: k === 'body' ? undefined : 'face' });
    t.append(h('span', { class: 'tile-name' }, text));
    return t;
  }
  function colorRow<K extends 'skin' | 'hairColor' | 'eyeColor'>(k: K, colors: readonly string[], text: string) {
    return h('div', { class: 'cr-row' }, h('h3', {}, text), h('div', { class: 'swatches' }, ...colors.map((c, i) =>
      h('button', { class: `swatch-dot big ${draft!.appearance[k] === i ? 'on' : ''}`, style: `--sw:${c}`, 'aria-label': `${text} ${i + 1}`, 'aria-pressed': String(draft!.appearance[k] === i), onclick: () => setA(k, i as Appearance[K]) }))));
  }
  function tiles<K extends keyof Appearance>(k: K, opts: readonly Appearance[K][], text: string) {
    return h('div', { class: 'cr-row' }, h('h3', {}, text), h('div', { class: 'tiles' }, ...opts.map((o) => faceTile(k, o, label(String(o))))));
  }
  function resetBtn(keys: (keyof Appearance)[], slots: Slot[] = []) {
    return h('button', { class: 'link small', onclick: () => {
      for (const k of keys) (draft!.appearance as any)[k] = saved!.appearance[k];
      for (const s of slots) { if (saved!.equipped[s]) draft!.equipped[s] = saved!.equipped[s]; else delete draft!.equipped[s]; }
      draft!.equipped = fitEquipped(draft!.equipped);
      drawPanel(); drawPreview();
    } }, 'Reset this section');
  }

  function itemTiles(slot: Slot) {
    const list = items.filter((i) => i.slot === slot && (i.available || canUse(i.id)));
    const cur = draft!.equipped[slot];
    const tilesEl = h('div', { class: 'tiles' });
    if (OPTIONAL.includes(slot)) {
      const none = h('button', { class: `tile none ${!cur ? 'on' : ''}`, onclick: () => setSlot(slot, null) }, h('span', { class: 'tile-x' }, '—'), h('span', { class: 'tile-name' }, 'None'));
      tilesEl.append(none);
    }
    for (const it of list) {
      const usable = canUse(it.id);
      const incompatible = validateEquipped({ ...draft!.equipped, [slot]: it.id }, () => true);
      const on = cur === it.id;
      const t = h('button', { class: `tile item ${on ? 'on' : ''} ${usable ? '' : 'locked'} r-${it.rarity}`, 'aria-pressed': String(on),
        title: usable ? (incompatible ?? it.description) : `${it.name} — ${it.unlock ? 'earned, not sold' : credits(it.price)} in the Boutique`,
        onclick: () => {
          if (!usable) { if (confirm(`${it.name} isn’t yours yet. Open the Casino Boutique?`)) leave(`/boutique?item=${it.id}`); return; }
          if (incompatible) { toast(incompatible, 'info'); return; }
          setSlot(slot, it.id);
        } });
      const look = { appearance: draft!.appearance, equipped: fitEquipped({ ...draft!.equipped, [slot]: it.id }) };
      if (slot === 'chips' || slot === 'cardBack' || slot === 'emotes' || slot === 'victory') t.append(itemSwatch(it));
      else {
        const box = h('span', { class: 'tile-img' });
        const crop = slot === 'hat' || slot === 'eyewear' || slot === 'earrings' ? 'face' as const : slot === 'neckwear' || slot === 'lapel' || slot === 'necklace' ? 'chest' as const : slot === 'watch' ? 'wrist' as const : undefined;
        box.innerHTML = renderAvatar(look, { frame: slot === 'frame', background: slot === 'background' || slot === 'frame', crop });
        t.append(box);
      }
      t.append(h('span', { class: 'tile-name' }, it.name));
      if (!usable) t.append(h('span', { class: 'tile-price' }, it.unlock ? '🔒 Earned' : `🔒 ${it.price}`));
      else if (incompatible) t.classList.add('dim');
      tilesEl.append(t);
    }
    return h('div', { class: 'cr-row' }, h('h3', {}, SLOT_NAME[slot]), tilesEl);
  }

  function drawPanel() {
    if (!draft || !saved) return;
    switch (tab) {
      case 'face':
        panel.replaceChildren(resetBtn(['skin', 'face', 'eyes', 'eyeColor', 'brows', 'nose', 'mouth', 'body']),
          colorRow('skin', SKIN, 'Skin tone'), tiles('face', FACE, 'Face shape'), tiles('eyes', EYES, 'Eyes'), colorRow('eyeColor', EYE_COLOR, 'Eye colour'),
          tiles('brows', BROWS, 'Eyebrows'), tiles('nose', NOSE, 'Nose'), tiles('mouth', MOUTH, 'Expression'), tiles('body', BODY, 'Build'));
        break;
      case 'hair':
        panel.replaceChildren(resetBtn(['hair', 'hairColor', 'facialHair']), tiles('hair', HAIR, 'Hairstyle'), colorRow('hairColor', HAIR_COLOR, 'Hair colour'), tiles('facialHair', FACIAL_HAIR, 'Facial hair'));
        break;
      case 'outfits': panel.replaceChildren(outfitsPanel()); break;
      default: {
        const slots = TAB_SLOTS[tab]!;
        panel.replaceChildren(resetBtn([], slots), ...slots.map((s) => itemTiles(s)));
        if (tab === 'table') panel.append(h('p', { class: 'muted tiny' }, 'Chips and card backs change only how your bets and face-down cards look to everyone. Chip values, cards and payouts never change. Hosts can turn table effects down.'));
      }
    }
  }

  function outfitsPanel() {
    return h('div', { class: 'outfits' },
      h('p', { class: 'muted' }, 'Keep up to three looks and switch between them. Your face and hair stay the same; the clothing and accessories change.'),
      ...OUTFIT_PRESETS.map((p: OutfitPreset) => {
        const o = draft!.outfits[p];
        const img = h('span', { class: 'tile-img' });
        img.innerHTML = renderAvatar({ appearance: draft!.appearance, equipped: o ?? {} }, {});
        return h('div', { class: `outfit-card ${draft!.preset === p ? 'on' : ''}` }, img,
          h('div', {}, h('b', {}, PRESET_NAME[p]), h('div', { class: 'muted tiny' }, o ? `${Object.keys(o).length} items` : 'Empty')),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', disabled: !o, onclick: () => {
              const usable = Object.fromEntries(Object.entries(o!).filter(([, id]) => canUse(id!))) as Equipped;
              draft!.equipped = fitEquipped(usable); draft!.preset = p; drawPanel(); drawPreview();
            } }, 'Wear'),
            h('button', { class: 'btn small ghost', onclick: () => { draft!.outfits = { ...draft!.outfits, [p]: { ...draft!.equipped } }; draft!.preset = p; drawPanel(); drawPreview(); toast(`Saved as ${PRESET_NAME[p]} — press Save to keep it.`); } }, 'Save current here')));
      }));
  }

  function randomize() {
    const r = randomAvatar();
    // Keep table extras (chips, card backs…) and owned frames; randomize face, hair and a free outfit.
    draft!.appearance = r.appearance;
    draft!.equipped = fitEquipped({ ...r.equipped, frame: draft!.equipped.frame, background: draft!.equipped.background, chips: draft!.equipped.chips, cardBack: draft!.equipped.cardBack, emotes: draft!.equipped.emotes, victory: draft!.equipped.victory });
    draft!.preset = 'custom';
    drawPanel(); drawPreview();
  }

  async function save() {
    if (!draft || busy) return;
    busy = true; drawPreview();
    try {
      const out = await saveAvatar(draft);
      mine = await loadMine();
      saved = structuredClone(out); draft = structuredClone(out);
      toast('Avatar saved. Everyone at your tables sees the new look.', 'success');
    } catch (e: any) { toast(e.message, 'error'); }
    busy = false; drawAll();
  }

  return { dispose() { window.removeEventListener('beforeunload', beforeUnload); } };
}

/** Swatch for non-wearable items (chips, card backs, reactions, victory animations). */
export function itemSwatch(it: { id: string; slot: string }) {
  const box = h('span', { class: `tile-img sw-${it.slot}` });
  box.innerHTML = renderItemPreview(it.id);   // built from catalog constants only
  return box;
}
