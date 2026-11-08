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
