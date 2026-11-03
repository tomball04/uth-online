import { RANK_LABEL, SUIT_SYMBOL } from '../shared/cards.js';
import { h } from './dom.js';

const SUIT_NAME: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_NAME: Record<string, string> = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten' };

/** A playing card element. `card` null = face down. Size via CSS var --cw on a parent. */
export function cardEl(card: string | null, extra = ''): HTMLElement {
  const el = h('div', { class: `card ${extra}` });
  setCard(el, card);
  return el;
}

export function setCard(el: HTMLElement, card: string | null) {
  el.dataset.card = card ?? '';
  el.replaceChildren();
  if (!card) {
    el.classList.add('back');
    el.setAttribute('aria-label', 'Face-down card');
    el.removeAttribute('data-suit');
    return;
  }
  el.classList.remove('back');
  const r = card[0], s = card[1];
  el.dataset.suit = s;
  el.setAttribute('aria-label', `${RANK_NAME[r] ?? RANK_LABEL[r]} of ${SUIT_NAME[s]}`);
  el.append(
    h('span', { class: 'idx' }, h('b', {}, RANK_LABEL[r]), h('i', {}, SUIT_SYMBOL[s])),
    h('span', { class: 'pip' }, SUIT_SYMBOL[s]),
    h('span', { class: 'idx idx-b' }, h('b', {}, RANK_LABEL[r]), h('i', {}, SUIT_SYMBOL[s])),
  );
}
