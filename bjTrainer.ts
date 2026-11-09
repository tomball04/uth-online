// §27.9 Blackjack practice trainer: random hands against a random upcard, graded by the same basic-strategy
// function the table uses (six decks, dealer stands on soft 17, double after split; surrender per table rules).
import { DEFAULT_BJ_RULES, bjAdvice, describeTotal, legalActions, newHand, type BjAction, type BjRules } from '../../shared/blackjack.js';
import { cardEl } from '../cardView.js';
import { h, modal } from '../dom.js';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const pick = <T,>(xs: readonly T[] | string) => xs[Math.floor(Math.random() * xs.length)] as T;
const card = () => `${pick<string>(RANKS)}${pick<string>(SUITS)}`;
const NAME: Record<BjAction, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

export function openBjTrainer(surrender = false) {
  const rules: BjRules = { ...DEFAULT_BJ_RULES, lateSurrender: surrender };
  let score = 0, total = 0;
  const board = h('div', { class: 'bjt-board' });
  const buttons = h('div', { class: 'row bjt-buttons' });
  const feedback = h('div', { class: 'bjt-feedback', 'aria-live': 'polite' });
  const tally = h('div', { class: 'muted tiny' });
  const focus = h('select', {}, ...[['any', 'Any hand'], ['hard', 'Hard totals'], ['soft', 'Soft totals'], ['pair', 'Pairs']].map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement;

  function deal() {
    let cards: string[];
    const f = focus.value;
    do {
      cards = [card(), card()];
      if (f === 'pair') cards[1] = cards[0][0] + pick<string>(SUITS);
      if (f === 'soft') cards[0] = 'A' + pick<string>(SUITS);
    } while ((f === 'hard' && (cards.some((c) => c[0] === 'A') || cards[0][0] === cards[1][0])) || describeTotal(cards) === 'Blackjack');
    const up = card();
    const hand = newHand(cards, 1000);
    const avail = legalActions(hand, 1, rules, true);
    const adv = bjAdvice(hand, up, avail, rules);
    board.replaceChildren(
      h('div', {}, h('div', { class: 'muted tiny' }, 'Dealer shows'), h('div', { class: 'cards-row' }, cardEl(up, 'big'))),
      h('div', {}, h('div', { class: 'muted tiny' }, `You have ${describeTotal(cards)}`), h('div', { class: 'cards-row' }, ...cards.map((c) => cardEl(c, 'big')))));
    feedback.replaceChildren();
    buttons.replaceChildren(...avail.map((a) => h('button', { class: 'btn', onclick: () => answer(a) }, NAME[a])));
    function answer(a: BjAction) {
      total++;
      const ok = a === adv.best;
      if (ok) score++;
      buttons.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      feedback.className = `bjt-feedback ${ok ? 'pos' : 'neg'}`;
      feedback.replaceChildren(h('b', {}, ok ? '✓ Correct. ' : `✗ Basic strategy says ${NAME[adv.best]}. `), adv.reason, h('div', {}, h('button', { class: 'btn gold small', onclick: deal }, 'Next hand')));
      tally.textContent = `${score} of ${total} correct (${Math.round((100 * score) / total)}%) this session`;
    }
  }
  focus.addEventListener('change', deal);
  modal('Blackjack practice', h('div', { class: 'stack bjt' },
    h('p', { class: 'muted' }, `Drill basic strategy for this table’s rules: ${rules.decks} decks, dealer stands on soft 17, double after split${surrender ? ', late surrender' : ''}. Practice hands use no chips.`),
    h('label', {}, 'Practice ', focus), board, buttons, feedback, tally));
  deal();
}
