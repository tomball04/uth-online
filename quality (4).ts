// §31 "Decision Quality vs. Results" panel and the hand-history filter (incl. "Wrong Call Wins").
// Everything shown here comes from the server's classification; this file only displays it.
import { api } from '../api.js';
import { h, money } from '../dom.js';
import { cardEl } from '../cardView.js';
import type { Classified, HistoryFilter, QHand, QualitySummary } from '../../shared/quality.js';

type Game = 'all' | 'uth' | 'tcp' | 'bj';
type Sum = Omit<QualitySummary, 'byGame'>;
const GAME_SHORT = { uth: 'Ultimate Hold’em', tcp: 'Three Card Poker', bj: 'Blackjack' } as const;
const ACT: Record<string, string> = { play4: 'Raise 4×', play3: 'Raise 3×', play2: 'Bet 2×', play1: 'Call 1×', check: 'Check', fold: 'Fold', play: 'Play',
  hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender', insure: 'Take insurance', 'no-insurance': 'Decline insurance' };
const PH: Record<string, string> = { preflop: 'Pre-flop', flop: 'Flop', river: 'River', decide: 'Play or fold', 'bj-ins': 'Insurance' };
const phaseName = (p: string) => PH[p] ?? (p.startsWith('bj-') ? `Decision ${p.slice(3)}` : p);
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
let scope: 'lifetime' | 'session' = 'lifetime';
let filter: HistoryFilter = 'wrong-wins';

export function qualitySection(game: Game): HTMLElement {
  const sec = h('section', { class: 'card-sec quality', 'data-testid': 'quality' }, h('h2', {}, 'Decision Quality vs. Results'), h('p', { class: 'muted' }, 'Loading…'));
  const q = game === 'all' ? '' : `?game=${game}`;
  void api<{ lifetime: QualitySummary; session: QualitySummary; sessionStart: number | null }>(`/api/stats/quality${q}`).then((r) => {
    const draw = () => {
      const s: Sum = scope === 'lifetime' ? r.lifetime : r.session;
      const box = (cls: string, title: string, n: number, sub: string) => h('div', { class: `qbox ${cls}`, 'data-q': cls },
        h('span', { class: 'qn' }, n.toLocaleString()), h('b', {}, title), h('small', {}, sub));
      sec.replaceChildren(...[
        h('h2', {}, 'Decision Quality vs. Results'),
        h('div', { class: 'tabs scope-tabs', role: 'tablist' }, ...(['lifetime', 'session'] as const).map((k) => h('button', {
          class: `tab ${scope === k ? 'on' : ''}`, role: 'tab', 'aria-selected': String(scope === k), onclick: () => { scope = k; draw(); } },
          k === 'lifetime' ? 'Lifetime' : 'This session'))),
        s.hands === 0 ? h('p', { class: 'muted' }, scope === 'session' ? 'No hands in this session yet.' : 'No completed hands yet.') : null,
        h('div', { class: 'qgrid' },
          h('span', { class: 'qaxis qx1' }, 'Won'), h('span', { class: 'qaxis qx2' }, 'Lost'),
          h('span', { class: 'qaxis qy1' }, 'Wrong call'), h('span', { class: 'qaxis qy2' }, 'Right call'),
          box('wrong-win', 'Wrong Call Wins', s.wrongWins, 'Lucky — the mistake still cost EV'),
          box('wrong-loss', 'Wrong Call Losses', s.wrongLosses, 'Mistake, and it lost'),
          box('right-win', 'Right Call Wins', s.rightWins, 'Correct, and it won'),
          box('right-loss', 'Right Call Losses', s.rightLosses, 'Correct — the cards didn’t cooperate')),
        h('p', { class: 'qrecon' }, `${s.hands} completed round${s.hands === 1 ? '' : 's'} = ${s.wrongWins + s.wrongLosses + s.rightWins + s.rightLosses} above + `,
          h('b', {}, `${s.wrongPushes + s.rightPushes} push${s.wrongPushes + s.rightPushes === 1 ? '' : 'es'}`), ` (${s.wrongPushes} wrong, ${s.rightPushes} right) + `,
          h('b', {}, `${s.ungraded} ungraded`), ' (no decision the strategy can grade — e.g. a blackjack, or an option you couldn’t afford).'),
        h('div', { class: 'figs qfigs' },
          fig('Wrong Call Win Rate', pct(s.wrongWinRate), `${s.wrongWins} of ${s.wrongHands} hands with a wrong call`),
          fig('Right Call Win Rate', pct(s.rightWinRate), `${s.rightWins} of ${s.rightHands} hands played correctly`),
          fig('Hands with a deviation', s.wrongHands.toLocaleString(), `${s.mistakes} separate mistake${s.mistakes === 1 ? '' : 's'}`),
          fig('Expected value lost', money(s.evLostCents), s.evUnknown ? `${s.evUnknown} mistake${s.evUnknown === 1 ? '' : 's'} without an EV figure` : 'Fixed when the decision was made'),
          fig('Profit from Wrong Call Wins', money(s.wrongWinProfit, true), 'Luck, not a good decision')),
        h('p', { class: 'qmoral' }, 'Winning a hand and playing it correctly are not the same thing. A wrong call that wins is still a mistake — its EV cost doesn’t change because the cards fell your way. A right call that loses is still right.'),
        game === 'all' && Object.keys(r.lifetime.byGame).length > 1 ? byGameTable(scope === 'lifetime' ? r.lifetime : r.session) : null,
        historyBlock(game)].filter((x) => !!x) as HTMLElement[]);
    };
    draw();
  }).catch((e) => sec.replaceChildren(h('h2', {}, 'Decision Quality vs. Results'), h('p', { class: 'muted' }, e.message)));
  return sec;
}

const fig = (label: string, value: string, sub: string) => h('div', { class: 'fig' }, h('small', { class: 'fig-s' }, sub), h('span', { class: 'fig-v' }, value), h('span', { class: 'fig-l' }, label));

function byGameTable(s: QualitySummary) {
  return h('div', { class: 'qscroll' }, h('table', { class: 'tables side-table' },
    h('thead', {}, h('tr', {}, ...['Game', 'Rounds', 'Wrong wins', 'Wrong losses', 'Right wins', 'Right losses', 'Pushes', 'Ungraded', 'Wrong-call win rate', 'EV lost'].map((t) => h('th', {}, t)))),
    h('tbody', {}, ...(['uth', 'tcp', 'bj'] as const).filter((g) => s.byGame[g]).map((g) => {
      const x = s.byGame[g]!;
      return h('tr', {}, h('td', {}, GAME_SHORT[g]), ...[x.hands, x.wrongWins, x.wrongLosses, x.rightWins, x.rightLosses, x.wrongPushes + x.rightPushes, x.ungraded].map((n) => h('td', { class: 'num' }, String(n))),
        h('td', { class: 'num' }, pct(x.wrongWinRate)), h('td', { class: 'num' }, money(x.evLostCents)));
    }))));
}

const FILTERS: [HistoryFilter, string][] = [['wrong-wins', 'Wrong Call Wins'], ['wrong-losses', 'Wrong Call Losses'], ['right-losses', 'Right Call Losses'], ['wrong', 'All wrong calls'], ['ungraded', 'Ungraded'], ['all', 'All hands']];

function historyBlock(game: Game) {
  const list = h('div', { class: 'qhist' });
  const wrap = h('div', { class: 'qhist-wrap' }, h('h3', {}, 'Hand history'),
    h('div', { class: 'chips-row', role: 'group', 'aria-label': 'Filter hands' }, ...FILTERS.map(([f, t]) => h('button', {
      class: `chip-f ${filter === f ? 'on' : ''}`, 'aria-pressed': String(filter === f), 'data-filter': f,
      onclick: (e: Event) => { filter = f; wrap.querySelectorAll('.chip-f').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); }); load(); } }, t))),
    list);
  const load = () => {
    list.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    void api<{ total: number; hands: (QHand & Classified)[] }>(`/api/stats/history?filter=${filter}&limit=50${game === 'all' ? '' : `&game=${game}`}`).then((r) => {
      list.replaceChildren(
        h('p', { class: 'muted' }, r.total ? `${r.total} hand${r.total === 1 ? '' : 's'}${r.total > r.hands.length ? ` · newest ${r.hands.length} shown` : ''}` : 'No hands match this filter yet.'),
        ...r.hands.map(handRow));
    }).catch((e) => list.replaceChildren(h('p', { class: 'muted' }, e.message)));
  };
  load();
  return wrap;
}

function handRow(x: QHand & Classified) {
  const cards = (cs: string[]) => h('span', { class: 'qcards' }, ...cs.map((c) => cardEl(c, 'mini')));
  const tag = x.call === 'ungraded' ? 'Ungraded' : `${x.call === 'wrong' ? 'Wrong' : 'Right'} call · ${x.result === 'win' ? 'won' : x.result === 'loss' ? 'lost' : 'push'}`;
  const verdict = x.call === 'wrong' && x.result === 'win' ? 'Won despite the mistake — a lucky win, not a positive-EV decision.'
    : x.call === 'wrong' && x.result === 'loss' ? 'Lost, and the decision was a mistake.'
    : x.call === 'right' && x.result === 'loss' ? 'Lost despite playing it correctly.'
    : x.call === 'right' ? 'Played correctly.' : 'No decision here could be graded.';
  return h('article', { class: `qhand q-${x.call}-${x.result}`, 'data-hand': x.handId },
    h('header', {}, h('b', {}, `${GAME_SHORT[x.game]} · Hand #${x.handNumber}`), h('span', { class: `qtag q-${x.call}` }, tag),
      h('span', { class: `num ${x.mainNet < 0 ? 'neg' : x.mainNet > 0 ? 'pos' : ''}` }, `Main game ${money(x.mainNet, true)}`),
      x.totalNet !== x.mainNet ? h('small', { class: 'muted' }, ` (with side bets ${money(x.totalNet, true)})`) : null),
    h('div', { class: 'qboard' },
      x.game === 'bj' && x.bjHands?.length ? h('span', {}, h('small', {}, x.bjHands.length > 1 ? 'Your hands' : 'You'), ...x.bjHands.map(cards)) : h('span', {}, h('small', {}, 'You'), cards(x.hole)),
      x.community.length ? h('span', {}, h('small', {}, 'Board'), cards(x.community)) : null,
      x.dealer.length ? h('span', {}, h('small', {}, 'Dealer'), cards(x.dealer)) : null),
    x.mistakes.length ? h('ul', { class: 'qmist' }, ...x.mistakes.map((m) => h('li', {},
      h('b', {}, `${phaseName(m.phase)}: ${ACT[m.action] ?? m.action}`), ' — recommended ', h('b', {}, ACT[m.recommended] ?? m.recommended),
      m.evCents !== null ? h('span', { class: 'ev' }, m.evCents < 1 ? ' · EV cost under 1¢ (a near-tie, but still off the chart)' : ` · EV −${money(m.evCents)}${m.evCost !== null ? ` (${m.evCost.toFixed(3)} bets)` : ''}`) : h('span', { class: 'ev muted' }, ' · EV not calculable'),
      m.timedOut ? h('small', { class: 'muted' }, ' (timed out)') : null,
      h('p', { class: 'muted' }, m.reason)))) : null,
    h('p', { class: 'qverdict' }, verdict));
}
