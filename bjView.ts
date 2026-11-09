// §27.8 Blackjack table pieces: fanned hands with totals, split hands side by side, active-hand highlight,
// dealer row, shoe and discard tray. Rendering only — every card and total comes from the server's view.
import type { BjHandView, SeatBj, TableView } from '../../shared/protocol.js';
import { cardEl } from '../cardView.js';
import { h, money } from '../dom.js';

const OUTCOME: Record<string, string> = { blackjack: 'Blackjack!', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust', surrender: 'Surrender' };

/** One hand: overlapping cards, total badge, bet, and the result once settled. */
export function bjHandEl(x: BjHandView, opts: { active?: boolean; size?: 'sm' | 'md' | 'big'; index?: number; count?: number } = {}) {
  const cards = h('div', { class: 'bj-cards' }, ...x.cards.map((c, i) => { const el = cardEl(c, opts.size === 'big' ? 'big' : 'sm'); el.style.setProperty('--i', String(i)); return el; }));
  const total = h('span', { class: `bj-total ${x.total.startsWith('Bust') ? 'bust' : x.total === 'Blackjack' ? 'natural' : ''}` }, x.total);
  return h('div', { class: `bj-hand ${opts.active ? 'active' : ''} ${x.done ? 'done' : ''} ${x.outcome ? `o-${x.outcome}` : ''}`, 'data-n': String(x.cards.length) },
    opts.count && opts.count > 1 ? h('span', { class: 'bj-idx' }, `Hand ${(opts.index ?? 0) + 1}`) : null,
    cards,
    h('div', { class: 'bj-meta' }, total, h('span', { class: 'bj-bet' }, money(x.bet), x.doubled ? h('small', {}, ' ×2') : null)),
    x.outcome ? h('span', { class: `bj-out ${x.net! > 0 ? 'pos' : x.net! < 0 ? 'neg' : ''}` }, `${OUTCOME[x.outcome]} ${x.net ? money(x.net, true) : ''}`.trim()) : null);
}

/** All of a seat's hands (compact at the table; large in your dock). */
export function bjSeatEl(b: SeatBj | undefined, size: 'sm' | 'big' = 'sm') {
  if (!b) return h('div', { class: 'bj-seat-hands empty' });
  const n = b.hands.length;
  return h('div', { class: `bj-seat-hands n${n} ${size}` },
    ...b.hands.map((x, i) => bjHandEl(x, { active: b.active === i, size, index: i, count: n })),
    b.insurance ? h('span', { class: 'bj-ins' }, `Ins. ${money(b.insurance)}${b.insuranceNet !== undefined ? ` ${money(b.insuranceNet, true)}` : ''}`) : null);
}
export const bjKey = (b: SeatBj | undefined) => JSON.stringify(b ?? null);

/** Dealer row: upcard, hidden hole card, then every card drawn. */
export function bjDealerEl(v: TableView) {
  const cards = v.dealer.cards;
  return h('div', { class: 'bj-dealer' },
    h('div', { class: 'bj-cards dealer' }, ...cards.map((c, i) => { const el = cardEl(c, ''); el.style.setProperty('--i', String(i)); return el; })),
    v.bj?.dealerTotal ? h('span', { class: `bj-total ${v.bj.dealerTotal.startsWith('Bust') ? 'bust' : ''}` }, v.dealer.cards.includes(null) ? `Shows ${v.bj.dealerTotal}` : v.bj.dealerTotal) : null);
}

/** Shoe fill and discard tray, drawn from the public counts only. */
export function bjShoeText(v: TableView) {
  const s = v.bj?.shoe;
  if (!s) return '';
  const left = s.total - s.dealt;
  return `${left} cards left in the shoe · ${s.discards} in the discard tray · reshuffle after ${s.cut}`;
}

// ------------------------------------------------------------------ §34.2 / §34.10 Bonus Bets (Blackjack)
import type { SeatView } from '../../shared/protocol.js';
import type { InitialBets } from '../../shared/rules.js';
import { BJ_SIDE, BJ_SIDES, enabledBjSides, sumSides, type BjSidesConfig } from '../../shared/bjsides.js';
import { bjSideTable, progTable } from './help.js';
import { modal } from '../dom.js';

const PRESET_KEY = 'uth.bjBonusPreset';
const loadPreset = (): Record<string, number> | null => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? 'null'); } catch { return null; } };
const savePreset = (x: Record<string, number>) => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(x)); return true; } catch { return false; } };

export interface BonusDeps {
  view: () => TableView | null;
  me: () => SeatView | null;
  draft: () => InitialBets;
  setDraft: (b: InitialBets) => void;
  chip: () => number;
  toast: (m: string, k?: 'error' | 'success' | 'info') => void;
}

/**
 * One Main Bet circle stays on the felt; every Blackjack bonus lives behind one "Bonus Bets" button: a panel
 * beside the dock on desktop, a bottom sheet on phones. Compact cards scroll sideways; each shows its stake,
 * limits, best payout and status. Results appear only when the server has recorded them.
 */
export function bonusBets(d: BonusDeps) {
  const btn = h('button', { class: 'bb-btn', 'aria-expanded': 'false', 'aria-controls': 'bb-panel' });
  const panel = h('section', { class: 'bb-panel', id: 'bb-panel', 'aria-label': 'Bonus bets', hidden: true });
  const root = h('div', { class: 'bj-bonus g-bj' }, btn, panel);
  const setOpen = (open: boolean) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); root.classList.toggle('open', open); if (open) render(); };
  btn.onclick = () => setOpen(panel.hidden);

  const affordable = (b: InitialBets) => {
    const s = d.me();
    return !!s && b.ante + sumSides(b.bjSides) + (b.progressive || 0) <= s.balance;
  };
  const change = (next: InitialBets, msg?: string) => {
    if (!affordable(next)) return d.toast('Not enough chips for that — the main bet and every bonus bet are paid up front.', 'error');
    d.setDraft(next); if (msg) d.toast(msg, 'success'); render();
  };
  const sides = () => ({ ...(d.draft().bjSides ?? {}) });

  function render() {
    const v = d.view(), s = d.me();
    const cfg: BjSidesConfig | undefined = v?.config.bjSides;
    if (!v || v.config.game !== 'bj' || !cfg) { root.hidden = true; return; }
    root.hidden = false;
    const open = enabledBjSides(cfg);
    const prog = v.config.bjProg?.on ? v.jackpot : null;
    const betting = v.phase === 'betting' && !!s && s.status !== 'ready' && s.status !== 'sitting-out';
    const live = s?.bj?.sides ?? [];
    const draftSides = d.draft().bjSides ?? {};
    const total = betting ? sumSides(draftSides) + (d.draft().progressive || 0)
      : live.reduce((t, x) => t + x.stake, 0) + (s?.bj?.prog?.stake ?? 0);
    btn.replaceChildren(h('span', {}, 'Bonus Bets'), h('b', {}, total ? money(total) : open.length || prog ? `${open.length + (prog ? 1 : 0)} open` : 'none'));
    btn.disabled = !open.length && !prog;
    if (panel.hidden) return;
    const chip = d.chip();
    const card = (id: string) => {
      const def = BJ_SIDE[id], set = cfg.bets[id];
      const variant = def.variants.find((x) => x.id === set.variant) ?? def.variants[0];
      const amt = betting ? draftSides[id] ?? 0 : live.find((x) => x.id === id)?.stake ?? 0;
      const res = live.find((x) => x.id === id);
      const status = res?.result ? (res.result === 'win' ? `Won — ${res.label} ${res.pays}:1 (${money(res.net!, true)})` : 'Lost')
        : !betting && amt ? (def.phase === 'dealer-hole' ? 'Waiting for the hole card' : def.phase === 'final-draw' ? 'Waiting for the dealer’s hand' : 'Settling…')
        : betting ? (amt ? 'Placed' : 'Not placed') : 'Locked';
      return h('div', { class: `bb-card ${amt ? 'on' : ''} ${res?.result ?? ''}`, 'data-side': id },
        h('div', { class: 'bb-name' }, def.short, h('small', {}, `up to ${variant.rows[0].pays.toLocaleString('en-US')}:1`)),
        h('div', { class: 'bb-amt' }, amt ? money(amt) : '—'),
        h('div', { class: 'bb-lim muted tiny' }, `${money(set.min)}–${money(set.max)}`),
        h('div', { class: 'bb-status tiny' }, status),
        betting ? h('div', { class: 'bb-act' },
          h('button', { class: 'btn small', 'aria-label': `Add ${money(chip)} to ${def.name}`, onclick: () => {
            const cur = sides(); const next = (cur[id] ?? 0) + chip;
            if (next < set.min) cur[id] = set.min; else cur[id] = next;
            if (cur[id] > set.max) return d.toast(`The maximum ${def.name} bet here is ${money(set.max)}.`, 'error');
            change({ ...d.draft(), bjSides: cur });
          } }, `+${money(chip)}`),
          amt ? h('button', { class: 'btn small', 'aria-label': `Clear ${def.name}`, onclick: () => { const cur = sides(); delete cur[id]; change({ ...d.draft(), bjSides: cur }); } }, 'Clear') : null) : null,
        h('button', { class: 'link tiny', onclick: () => modal(def.name, h('div', { class: 'help' }, bjSideTable(def, set.variant, set))) }, 'Pay table'));
    };
    const progCard = prog ? (() => {
      const amt = betting ? d.draft().progressive : s?.bj?.prog?.stake ?? 0;
      const pr = s?.bj?.prog;
      return h('div', { class: `bb-card prog ${amt ? 'on' : ''}`, 'data-side': 'progressive' },
        h('div', { class: 'bb-name' }, '21+3 Progressive', h('small', {}, `meter ${money(prog.amount)}${prog.custom ? ' · custom' : ''}`)),
        h('div', { class: 'bb-amt' }, amt ? money(amt) : '—'),
        h('div', { class: 'bb-lim muted tiny' }, `fixed ${money(prog.wager)}`),
        h('div', { class: 'bb-status tiny' }, pr ? (pr.amount !== undefined ? (pr.amount > 0 ? `Won ${money(pr.amount)} — ${pr.label}` : 'Lost') : pr.combo ? `${pr.combo} — paid at settlement` : 'No qualifying hand') : betting ? (amt ? 'Placed' : 'Not placed') : 'Locked'),
        betting ? h('div', { class: 'bb-act' }, h('button', { class: 'btn small', onclick: () => change({ ...d.draft(), progressive: d.draft().progressive ? 0 : prog.wager }) }, amt ? 'Remove' : `Bet ${money(prog.wager)}`)) : null,
        h('button', { class: 'link tiny', onclick: () => modal('21+3 Progressive', h('div', { class: 'help' }, progTable('bj', v.config.bjProg.variant, v.config.bjProg.profile, prog.amount, ['♠ Spades', '♥ Hearts', '♦ Diamonds', '♣ Clubs'][v.config.jackpotSuit]))) }, 'Pay table'));
    })() : null;
    const last = v.you.lastBet?.bjSides;
    panel.replaceChildren(
      h('header', { class: 'bb-head' }, h('b', {}, 'Bonus Bets'),
        h('span', { class: 'muted tiny' }, betting ? `Chip ${money(chip)} · total ${money(total)}` : `Locked · total ${money(total)}`),
        h('button', { class: 'bb-close', 'aria-label': 'Close bonus bets', onclick: () => setOpen(false) }, '×')),
      open.length || prog ? h('div', { class: 'bb-cards', role: 'list' }, ...open.map((x) => card(x.id)), progCard ?? '')
        : h('p', { class: 'muted' }, 'Classic Blackjack: the host has not opened any side bets.'),
      !betting ? '' : h('div', { class: 'bb-tools' },
        h('button', { class: 'link', disabled: !last || !Object.keys(last).length, onclick: () => {
          const keep: Record<string, number> = {}, dropped: string[] = [];
          for (const [id, a] of Object.entries(last ?? {})) { const st = cfg.bets[id]; if (st?.on && a >= st.min && a <= st.max) keep[id] = a; else dropped.push(BJ_SIDE[id]?.name ?? id); }
          change({ ...d.draft(), bjSides: keep }, dropped.length ? `Repeated — not open any more: ${dropped.join(', ')}.` : 'Previous bonuses repeated.');
        } }, 'Repeat previous'),
        h('button', { class: 'link', onclick: () => { const cur = sides(); if (!Object.keys(cur).length) return d.toast('Place a bonus bet first.', 'info'); d.toast(savePreset(cur) ? 'Bonus preset saved on this device.' : 'Couldn’t save on this device.', 'success'); } }, 'Save preset'),
        h('button', { class: 'link', disabled: !loadPreset(), onclick: () => {
          const pre = loadPreset() ?? {}; const keep: Record<string, number> = {};
          for (const [id, a] of Object.entries(pre)) { const st = cfg.bets[id]; if (st?.on && typeof a === 'number' && a >= st.min && a <= st.max) keep[id] = a; }
          change({ ...d.draft(), bjSides: keep }, 'Preset loaded (only bets open at this table).');
        } }, 'Use preset'),
        h('button', { class: 'link', onclick: () => change({ ...d.draft(), bjSides: {}, progressive: 0 }, 'Bonus bets cleared.') }, 'Clear all')),
      h('p', { class: 'muted tiny' }, 'Each bonus is its own wager with its own result — it never changes the cards or the dealer’s play. Pay tables are set by the host and only change between hands.'));
  }
  return { root, render, setOpen };
}

/** §34.5 Host: Blackjack → Side Bets (Classic / All Bets / Custom), with per-wager tables and limits. */
export function bjSidesHost(v: TableView, call: (ev: 'host:settings', p: object) => Promise<{ ok: boolean; error?: string }>, toast: (m: string, k?: 'error' | 'success' | 'info') => void) {
  const cfg = v.config.bjSides;
  const inHand = !!v.handId && v.phase !== 'settled';
  const form = h('form', { class: 'bj-sides-form' });
  const presets = [['classic', 'Classic Blackjack', 'No side bets.'], ['allbets', 'All Bets Blackjack', 'Player Pairs, Dealer Pairs, 21+3, Top 3, Buster, Lucky Lucky (published tables, six-deck adaptation).'], ['custom', 'Custom Casino', 'Pick any available wager, table and limits.']] as const;
  form.append(h('div', { class: 'preset-row', role: 'radiogroup' }, ...presets.map(([id, name, note]) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'preset', value: id, checked: cfg.preset === id }), h('b', {}, ` ${name}`), h('small', { class: 'muted' }, ` — ${note}`)))));
  const rows = BJ_SIDES.map((def) => {
    if (def.status !== 'playable') return h('tr', { class: 'off' }, h('td', {}, def.name), h('td', { colspan: '4', class: 'muted tiny' }, `Unavailable — ${def.unavailable}`));
    const st = cfg.bets[def.id];
    return h('tr', { 'data-side': def.id },
      h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `on:${def.id}`, checked: !!st?.on }), ` ${def.name}`)),
      h('td', {}, def.variants.length > 1 ? h('select', { name: `variant:${def.id}` }, ...def.variants.map((x) => h('option', { value: x.id, selected: x.id === st?.variant }, x.name))) : h('span', { class: 'tiny' }, def.variants[0].name)),
      h('td', {}, h('input', { name: `min:${def.id}`, type: 'number', min: 1, step: 1, value: (st?.min ?? 100) / 100, 'aria-label': `${def.name} minimum` })),
      h('td', {}, h('input', { name: `max:${def.id}`, type: 'number', min: 1, step: 1, value: (st?.max ?? 2500) / 100, 'aria-label': `${def.name} maximum` })),
      h('td', {}, h('button', { type: 'button', class: 'link tiny', onclick: () => modal(def.name, h('div', { class: 'help' }, bjSideTable(def, st?.variant, st))) }, 'Rules')));
  });
  form.append(h('table', { class: 'bj-sides-table' }, h('tr', {}, h('th', {}, 'Wager'), h('th', {}, 'Pay table'), h('th', {}, 'Min $'), h('th', {}, 'Max $'), h('th', {}, '')), ...rows));
  form.append(h('p', { class: 'warn tiny' }, '⚠ Compatibility: the All Bets wagers are published for an EIGHT-deck game; here they run on the six-deck shoe as an adapted profile. Buster never makes the dealer draw extra cards: when every hand is already decided the dealer stands and Buster loses.'));
  form.append(h('button', { class: 'btn gold', disabled: inHand }, inHand ? 'Side bets can be changed between hands' : 'Save side bets'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const preset = String(fd.get('preset'));
    const bets: Record<string, object> = {};
    for (const def of BJ_SIDES) if (def.status === 'playable') bets[def.id] = { on: fd.get(`on:${def.id}`) === 'on', ...(fd.get(`variant:${def.id}`) ? { variant: String(fd.get(`variant:${def.id}`)) } : {}),
      min: Math.round(Number(fd.get(`min:${def.id}`)) * 100), max: Math.round(Number(fd.get(`max:${def.id}`)) * 100) };
    const r = await call('host:settings', { bjSides: { preset, bets } });
    toast(r.ok ? 'Side bets saved — they apply from the next hand.' : r.error ?? 'Could not save.', r.ok ? 'success' : 'error');
  });
  return h('section', { class: 'bj-sides-host' }, h('h3', {}, 'Blackjack → Side Bets'), form);
}
void sumSides;
