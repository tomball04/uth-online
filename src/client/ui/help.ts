import { BLIND_PAYTABLE, RULES_VERSION, TRIPS_PAYTABLE } from '../../shared/rules.js';
import type { TableConfig } from '../../shared/protocol.js';
import { BAD_BEAT_VARIANTS, PAIRS_VARIANTS, type BadBeatVariant, type PairsVariant } from '../../shared/sidebets.js';
import { PROGRESSIVE } from '../../shared/progressive.js';
import { ANTE_BONUS, PAIR_PLUS, SIX_CARD, TCP_RULES_VERSION, TCP_SOURCES } from '../../shared/tcp.js';
import { h, modal, money } from '../dom.js';

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
      h('li', {}, h('b', {}, 'Blind: '), 'pays the table below when you win with a straight or better, pushes on other wins and ties, loses when you lose. As in a casino, the 3 to 2 flush payout is rounded down to the dollar (a $25 Blind on a flush pays $37).'),
      h('li', {}, h('b', {}, 'Trips+: '), 'pays on your own hand, win or lose — even if you fold.'),
      h('li', {}, h('b', {}, 'Ultimate Pairs: '), 'pays on your two hole cards alone — a pair, or an ace with a king, queen or jack. Still pays if you fold.'),
      h('li', {}, h('b', {}, 'Bad Beat: '), 'pays when the losing hand at showdown is Three of a Kind or better, whether that’s yours or the dealer’s. Ties lose. Needs a Trips+ bet. Your real seven-card hand counts even if you folded.'),
      h('li', {}, h('b', {}, '$5 Progressive: '), 'a fixed $5 bet on a jackpot shared by every table. It is decided by your two cards and the flop, pays even if you fold later, and the $5 is not returned on a win. A royal flush takes the whole jackpot.')),
    h('div', { class: 'pay-grid' },
      h('div', {}, h('h4', {}, 'Blind'), pay(Object.entries(BLIND_PAYTABLE).map(([k, [n, d]]) => [k, `${n} to ${d}`]))),
      h('div', {}, h('h4', {}, 'Trips+'), pay(Object.entries(TRIPS_PAYTABLE).map(([k, n]) => [k, `${n} to 1`])))),
    h('h3', {}, 'Bonus bet pay tables'),
    h('p', {}, 'Each table uses one complete pay table for each bonus bet. The ones in use are shown at the table under Pay tables.'),
    h('div', { class: 'pay-grid' }, ...Object.values(PAIRS_VARIANTS).map(pairsTable)),
    h('div', { class: 'pay-grid' }, ...Object.values(BAD_BEAT_VARIANTS).map(badBeatTable)),
    h('div', { class: 'pay-grid' }, progressiveTable()),
    h('h3', {}, 'After the round'),
    h('p', {}, 'Once a hand is settled every player’s cards are turned face up, folded hands included, the way a dealer spreads them at a real table. Nobody sees another player’s cards while the hand is being played.'),
    h('h3', {}, 'Three Card Poker'),
    h('p', {}, 'The host can switch the table to Three Card Poker between hands. Everyone keeps their seat and chips.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Place an Ante. Pair Plus and Six Card Bonus are optional. Keep enough free for a Play bet equal to your Ante.'),
      h('li', {}, 'You and the dealer each get three cards. Decide once: Play 1× or Fold. Standard strategy: play Queen-6-4 or better.'),
      h('li', {}, 'The dealer qualifies with Queen high or better. If not, your Ante pays 1:1 and Play pushes. If so, the higher hand wins Ante and Play 1:1; a tie pushes.'),
      h('li', {}, 'Three-card ranks: Straight Flush, Three of a Kind, Straight, Flush, Pair, High Card — a straight beats a flush. A-2-3 is the lowest straight, A-K-Q the highest.')),
    h('div', { class: 'pay-grid' }, ...tcpTables()),
    h('h3', {}, 'Timers'),
    h('p', {}, 'At multiplayer tables the server runs a decision clock. If yours runs out you check pre-flop and on the flop, and fold on the river (or play basic strategy, if you turn that on in Settings). Disconnecting doesn’t stop the table; your seat is held for two minutes.'),
    h('h3', {}, 'Keyboard'),
    h('p', {}, '4, 3, 2, 1 to play that multiple · C to check · F to fold · Enter to deal in.'),
    h('p', { class: 'muted' }, 'Chips are virtual and have no cash value.'));
  modal('How to play', body, { wide: true });
}

const n = (x: number) => x.toLocaleString('en-US');
/** Three Card Poker pay tables: Ante Bonus, Pair Plus, Six Card Bonus. */
export function tcpTables() {
  const rows = (o: Partial<Record<string, number>>) => Object.entries(o).map(([k, v]) => [k, `${v!.toLocaleString('en-US')} to 1`] as [string, string]);
  return [
    h('div', {}, h('h4', {}, 'Ante Bonus'), payRows(rows(ANTE_BONUS)), h('p', { class: 'muted tiny' }, 'Automatic with a Play bet, paid on the Ante even if the dealer wins. Not after a fold.')),
    h('div', {}, h('h4', {}, 'Pair Plus'), payRows(rows(PAIR_PLUS)), h('p', { class: 'muted tiny' }, 'Your three cards only. Pays even if you fold.')),
    h('div', {}, h('h4', {}, 'Six Card Bonus'), payRows(rows(SIX_CARD)), h('p', { class: 'muted tiny' }, 'Best five of your three + the dealer’s three, normal poker ranks. Pays even if you fold.')),
  ];
}

const payRows = (rows: [string, string][]) => h('table', { class: 'paytable' }, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))));
const sourceLine = (v: PairsVariant | BadBeatVariant) => h('p', { class: 'muted tiny' }, 'Source: ',
  h('a', { href: v.source.url, target: '_blank', rel: 'noopener' }, v.source.title), `, ${v.source.section}.`);

export function pairsTable(v: PairsVariant) {
  return h('div', {}, h('h4', {}, v.name), payRows(v.rows.map((r) => [r.label, `${n(r.payout)} to 1`])),
    h('p', { class: 'muted tiny' }, 'Only the highest winning line pays. Settles at showdown; stays live if you fold.'), sourceLine(v));
}
export function badBeatTable(v: BadBeatVariant) {
  return h('div', {}, h('h4', {}, v.name), payRows(v.rows.map((r) => [`Losing ${r.losing}`, `${n(r.payout)} to 1`])),
    h('p', { class: 'muted tiny' }, 'Pays on the losing hand. Ties lose. Requires Ante, Blind and Trips+. Stays live if you fold.'), sourceLine(v));
}

export function progressiveTable(jackpot?: number) {
  const rows: [string, string][] = PROGRESSIVE.rows.map((r) => [r.hand,
    r.kind === 'meter' ? (r.pct === 100 ? `100% of jackpot${jackpot ? ` (${money(jackpot)})` : ''}` : `${r.pct}% of jackpot`) : money(r.amount!)]);
  const envy = Object.entries(PROGRESSIVE.envy).map(([k, v]) => `${money(v!)} for each ${k}`).join(', ');
  return h('div', {}, h('h4', {}, `${PROGRESSIVE.name} — ${money(PROGRESSIVE.wager)}`), payRows(rows),
    h('p', { class: 'muted tiny' }, `${PROGRESSIVE.cards}. Envy bonus to every other progressive bettor at the table: ${envy}. `
      + `Awards are paid instead of the $5, not in addition to it. Percentages are paid in whole dollars. The jackpot starts at ${money(PROGRESSIVE.seed)} and `
      + `${money(PROGRESSIVE.contribution)} of every $5 goes on the meter. Stays live if you fold.`),
    h('p', { class: 'muted tiny' }, 'Sources: ', ...PROGRESSIVE.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)]),
      '. Seed, meter rate and fold handling are this site’s choices.'));
}

/** The pay tables in force at one table — shown before anyone bets. */
export function openPayTables(c: TableConfig, jackpot?: number) {
  if (c.game === 'tcp') {
    modal(`Pay tables at ${c.name}`, h('div', { class: 'help' },
      h('p', {}, h('b', {}, 'Three Card Poker. '), 'Dealer qualifies with Queen high or better. Not qualified: Ante pays 1:1, Play pushes. Otherwise higher hand wins Ante and Play 1:1; a tie pushes.'),
      h('div', { class: 'pay-grid' }, ...tcpTables()),
      h('p', { class: 'muted' }, `Bonus limits: Pair Plus up to $${c.maxPairPlus / 100}, Six Card Bonus up to $${c.maxSixCard / 100}. The Hold’em progressive doesn’t run during Three Card Poker; its jackpot is kept for when the table switches back.`),
      h('p', { class: 'muted tiny' }, `Rules ${TCP_RULES_VERSION}. Sources: `, ...TCP_SOURCES.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)]))), { wide: true });
    return;
  }
  modal(`Pay tables at ${c.name}`, h('div', { class: 'help' },
    h('div', { class: 'pay-grid' },
      h('div', {}, h('h4', {}, 'Blind'), payRows(Object.entries(BLIND_PAYTABLE).map(([k, [a, b]]) => [k, `${a} to ${b}`]))),
      h('div', {}, h('h4', {}, 'Trips+'), payRows(Object.entries(TRIPS_PAYTABLE).map(([k, x]) => [k, `${x} to 1`])))),
    h('div', { class: 'pay-grid' }, pairsTable(PAIRS_VARIANTS[c.pairsVariant]), badBeatTable(BAD_BEAT_VARIANTS[c.badBeatVariant])),
    c.progressive ? h('div', { class: 'pay-grid' }, progressiveTable(jackpot)) : h('p', { class: 'muted' }, 'The progressive is switched off at this table.'),
    h('p', { class: 'muted' }, `Blind flush (3 to 2) is rounded down to the dollar. Bonus limits: Trips+ up to $${c.maxTrips / 100}, Ultimate Pairs up to $${c.maxPairs / 100}, Bad Beat up to $${c.maxBadBeat / 100}. Pay tables only change between hands, and every change is announced in chat.`),
    h('p', { class: 'muted tiny' }, `Rules version ${RULES_VERSION}. Every hand records the rules version and pay tables it was played under.`)),
    { wide: true });
}

/** Form fields for choosing pay tables and bonus limits (create table + host settings). */
export function sideBetFields(c?: Partial<TableConfig>) {
  const sel = (name: string, label: string, opts: { id: string; name: string }[], val?: string) =>
    h('label', {}, label, h('select', { name }, ...opts.map((o) => h('option', { value: o.id, selected: o.id === val }, o.name))));
  const num = (name: string, label: string, value: number) => h('label', {}, label, h('input', { name, type: 'number', value, min: 0, step: 1 }));
  return [
    sel('pairsVariant', 'Ultimate Pairs pay table', Object.values(PAIRS_VARIANTS), c?.pairsVariant ?? 'up-bonus4'),
    sel('badBeatVariant', 'Bad Beat pay table', Object.values(BAD_BEAT_VARIANTS), c?.badBeatVariant ?? 'bb-01'),
    num('maxPairs', 'Maximum Ultimate Pairs ($)', (c?.maxPairs ?? 2500) / 100),
    num('maxBadBeat', 'Maximum Bad Beat ($)', (c?.maxBadBeat ?? 2500) / 100),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'progressive', checked: c?.progressive !== false }), ' Offer the $5 Progressive (linked jackpot)'),
  ];
}

export function readSideBetFields(fd: FormData) {
  const d = (k: string) => Math.round(Number(fd.get(k)) * 100);
  return { pairsVariant: String(fd.get('pairsVariant')), badBeatVariant: String(fd.get('badBeatVariant')), maxPairs: d('maxPairs'), maxBadBeat: d('maxBadBeat'),
    progressive: fd.get('progressive') === 'on' };
}
