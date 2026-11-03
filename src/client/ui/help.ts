import { BLIND_PAYTABLE, TRIPS_PAYTABLE } from '../../shared/rules.js';
import { h, modal } from '../dom.js';

export function openHelp() {
  const pay = (rows: [string, string][]) => h('table', { class: 'paytable' },
    ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))));
  const body = h('div', { class: 'help' },
    h('p', {}, 'Everyone at the table plays their own hand against the dealer. You never bet against the other players, and you all share the same five community cards and the same dealer hand.'),
    h('h3', {}, 'A hand, step by step'),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Bet. '), 'Place an Ante. An equal Blind bet goes down automatically. Trips+ is an optional side bet. You need enough left over for a 1× Play bet.'),
      h('li', {}, h('b', {}, 'Pre-flop. '), 'Look at your two cards. Play 4× or 3× your Ante, or check.'),
      h('li', {}, h('b', {}, 'Flop. '), 'Three community cards. If you checked, play 2× or check again.'),
      h('li', {}, h('b', {}, 'River. '), 'The last two cards. If you still haven’t played, play 1× or fold (you lose Ante and Blind).'),
      h('li', {}, h('b', {}, 'Showdown. '), 'The dealer turns over two cards. Best five cards from seven win.')),
    h('h3', {}, 'How each bet is paid'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Play: '), 'pays 1 to 1 if you beat the dealer, pushes on a tie.'),
      h('li', {}, h('b', {}, 'Ante: '), 'pays 1 to 1 if you win, but pushes when the dealer doesn’t have at least a pair.'),
      h('li', {}, h('b', {}, 'Blind: '), 'pays the table below when you win with a straight or better, pushes on other wins and ties, loses when you lose.'),
      h('li', {}, h('b', {}, 'Trips+: '), 'pays on your own hand, win or lose — even if you fold.')),
    h('div', { class: 'pay-grid' },
      h('div', {}, h('h4', {}, 'Blind'), pay(Object.entries(BLIND_PAYTABLE).map(([k, [n, d]]) => [k, `${n} to ${d}`]))),
      h('div', {}, h('h4', {}, 'Trips+'), pay(Object.entries(TRIPS_PAYTABLE).map(([k, n]) => [k, `${n} to 1`])))),
    h('h3', {}, 'Timers'),
    h('p', {}, 'At multiplayer tables the server runs a decision clock. If yours runs out you check pre-flop and on the flop, and fold on the river (or play basic strategy, if you turn that on in Settings). Disconnecting doesn’t stop the table; your seat is held for two minutes.'),
    h('h3', {}, 'Keyboard'),
    h('p', {}, '4, 3, 2, 1 to play that multiple · C to check · F to fold · Enter to deal in.'),
    h('p', { class: 'muted' }, 'Chips are virtual and have no cash value.'));
  modal('How to play', body, { wide: true });
}
