import { api } from '../api.js';
import { h, money, svg, toast } from '../dom.js';
import { pawnFor } from '../../shared/debt.js';
import { qualitySection } from './quality.js';

interface Stats {
  hands: number; net: number; wins: number; losses: number; pushes: number; folds: number; biggestWin: number; biggestLoss: number;
  bestHand: string | null; totalWagered: number; decisions: number; correctDecisions: number; evLost: number;
  byPhase: { phase: string; action: string; count: number; correct: number }[];
  commonMistakes: { phase: string; action: string; recommended: string; count: number; evCost: number }[];
  trips: { bets: number; wins: number; net: number }; handsWithFriends: number; reloads: number; tables: number; debt?: number;
  side: Record<'trips' | 'pairs' | 'badBeat' | 'progressive' | 'pairPlus' | 'sixCard', Side>; baseNet: number; baseWagered: number; game?: 'uth' | 'tcp' | 'bj' | null;
  series: { at: string; cumulative: number }[];
}
interface Side { bets: number; wins: number; wagered: number; returned: number; net: number; biggestPayout: number; combos: { combo: string; count: number }[] }
const SIDE_NAME = { trips: 'Trips+', pairs: 'Ultimate Pairs', badBeat: 'Bad Beat', progressive: 'Progressive', pairPlus: 'Pair Plus', sixCard: 'Six Card Bonus' } as const;
type Game = 'all' | 'uth' | 'tcp' | 'bj';
const GAME_LABEL: Record<Game, string> = { all: 'All games', uth: 'Ultimate Texas Hold’em', tcp: 'Three Card Poker', bj: 'Blackjack' };
const SIDES_FOR: Record<Game, (keyof typeof SIDE_NAME)[]> = { all: ['trips', 'pairs', 'badBeat', 'progressive', 'pairPlus', 'sixCard'], uth: ['trips', 'pairs', 'badBeat', 'progressive'], tcp: ['pairPlus', 'sixCard', 'progressive'], bj: [] };
const EDGE: Record<Game, string> = {
  all: 'House edge with perfect strategy: Ultimate Hold’em about 2.2% of the Ante per hand; Three Card Poker about 3.4% of the Ante (Ante/Play).',
  uth: 'With perfect strategy the house edge is about 2.2% of the Ante per hand, roughly 0.5% of total action.',
  bj: 'With basic strategy, six decks with the dealer standing on soft 17 and double after split, the house edge is roughly half a percent of the bet.',
  tcp: 'With Queen-6-4 strategy the Ante/Play house edge is about 3.4% of the Ante. Pair Plus (40-30-6-3-1) 7.3% and Six Card Bonus (1000-200-100-20-15-10-7) 8.6%, both computed exactly for these pay tables.',
};
let currentGame: Game = 'all';
const LABEL: Record<string, string> = { play4: 'Play 4×', play3: 'Play 3×', play2: 'Play 2×', play1: 'Play 1×', check: 'Check', fold: 'Fold',
  hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender', insure: 'Insurance', 'no-insurance': 'No insurance' };
const PHASE: Record<string, string> = { preflop: 'Pre-flop', flop: 'Flop', river: 'River', decide: 'Three Card Poker: Play or Fold', bj: 'Blackjack decisions' };

export async function mountStats(root: HTMLElement, nav: (p: string) => void) {
  root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'muted' }, 'Loading your statistics…')));
  let s: Stats;
  try { s = (await api<{ stats: Stats }>(`/api/stats/me${currentGame === 'all' ? '' : `?game=${currentGame}`}`)).stats; }
  catch (e: any) { toast(e.message, 'error'); nav('/'); return; }

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const fig = (label: string, value: string, cls = '') => h('div', { class: 'fig' }, h('span', { class: `fig-v ${cls}` }, value), h('span', { class: 'fig-l' }, label));

  const phaseList = currentGame === 'tcp' ? ['decide'] : currentGame === 'uth' ? ['preflop', 'flop', 'river'] : currentGame === 'bj' ? ['bj'] : ['preflop', 'flop', 'river', 'decide', 'bj'];
  const phases = phaseList.filter((p) => currentGame !== 'all' || (p !== 'decide' && p !== 'bj') || s.byPhase.some((x) => x.phase === p)).map((p) => {
    const rows = s.byPhase.filter((x) => x.phase === p);
    const total = rows.reduce((a, r) => a + r.count, 0);
    const ok = rows.reduce((a, r) => a + r.correct, 0);
    return h('div', { class: 'phase-card' }, h('h3', {}, PHASE[p]), h('p', { class: 'big-num' }, pct(ok, total)),
      h('p', { class: 'muted' }, `${ok} of ${total} matched the best play`),
      h('ul', {}, ...rows.map((r) => h('li', {}, h('span', {}, LABEL[r.action]), h('span', { class: 'num' }, String(r.count))))));
  });

  root.replaceChildren(h('main', { class: 'page stats' },
    h('div', { class: 'page-head' }, h('button', { class: 'ghost', onclick: () => nav('/') }, '← Lobby'), h('h1', {}, 'Your statistics')),
    h('div', { class: 'tabs game-tabs', role: 'tablist' }, ...(['all', 'uth', 'tcp', 'bj'] as Game[]).map((g) => h('button', {
      class: `tab ${g === currentGame ? 'on' : ''}`, role: 'tab', 'aria-selected': String(g === currentGame),
      onclick: () => { currentGame = g; mountStats(root, nav); } }, GAME_LABEL[g]))),
    s.hands === 0 ? h('p', { class: 'empty' }, 'Play a hand and your results, decisions and bankroll history will appear here.') : null,
    h('section', { class: 'figs' },
      fig('Net result', money(s.net, true), s.net < 0 ? 'neg' : 'pos'),
      fig('Hands played', s.hands.toLocaleString()),
      fig('Won / lost / pushed', `${s.wins} / ${s.losses + s.folds} / ${s.pushes}`),
      fig('Win rate', pct(s.wins, s.hands)),
      fig('Biggest win', money(s.biggestWin)),
      fig('Best hand', s.bestHand ?? '—'),
      fig('Main-game return', s.baseWagered ? `${((s.baseNet / s.baseWagered) * 100).toFixed(2)}%` : '—'),
      fig('With friends', `${s.handsWithFriends} hands`)),
    h('section', { class: 'card-sec' }, h('h2', {}, 'Lifetime bankroll'), graph(s.series),
      h('p', { class: 'muted' }, `Across ${s.tables} table${s.tables === 1 ? '' : 's'} · ${s.reloads} reload${s.reloads === 1 ? '' : 's'}${s.debt ? ` · ${money(s.debt)} in markers (to cover it, pawn ${pawnFor(s.debt).item})` : ''}. ${EDGE[currentGame]} The bankroll graph covers every game.`)),
    h('section', { class: 'card-sec' }, h('h2', {}, 'Strategy'),
      h('p', {}, `${pct(s.correctDecisions, s.decisions)} of your ${s.decisions} decisions matched optimal strategy. Mistakes have cost about `,
        h('b', {}, `${s.evLost.toFixed(2)} antes`), ' of expected value in total.'),
      h('div', { class: 'phase-grid' }, ...phases),
      habit(s.commonMistakes),
      h('h3', {}, 'Most common mistakes'),
      s.commonMistakes.length ? h('ol', { class: 'mistakes' }, ...s.commonMistakes.map((m) => h('li', {},
        `${PHASE[m.phase]}: ${LABEL[m.action]} instead of ${LABEL[m.recommended]}`, h('span', { class: 'muted' }, ` — ${m.count}× · ${m.evCost.toFixed(2)} antes`)))) : h('p', { class: 'muted' }, 'None yet.')),
    qualitySection(currentGame),
    sideSection(s),
    currentGame === 'bj' || currentGame === 'all' ? bonusSection() : null));
}

/**
 * §34.9 Blackjack Bonus Statistics — separate from strategy accuracy on purpose: a 21+3 win never turns a wrong
 * Blackjack decision into a right one. Loaded on its own; filters the bonus hand history by wager and combination.
 */
interface BonusLine { bets: number; wagered: number; returned: number; net: number; wins: number; hitPct: number; biggest: number; topCombo: string | null; combos: { combo: string; count: number }[] }
interface BonusResp {
  stats: { lifetime: Record<string, BonusLine>; session: Record<string, BonusLine>;
    progressive: { lifetime: BonusLine & { contributed: number; jackpots: number }; session: BonusLine & { contributed: number; jackpots: number } };
    jackpots: { handId: string; at: number; combo: string | null; amount: number }[]; sessionStart: number | null };
  hands: { handId: string; handNumber: number; at: number; mainNet: number; results: { id: string; name: string; result: string; label: string | null; pays: number; net: number; stake: number }[];
    prog: { stake: number; amount: number; combo: string | null } | null }[];
  catalog: { id: string; name: string; status: string }[];
}
function bonusSection() {
  const sec = h('section', { class: 'card-sec bonus-stats' }, h('h2', {}, 'Blackjack Bonus Statistics'), h('p', { class: 'muted' }, 'Loading…'));
  let side = '', combo = '';
  const load = async () => {
    let r: BonusResp;
    try { r = await api<BonusResp>(`/api/stats/bonus?limit=60${side ? `&side=${encodeURIComponent(side)}` : ''}${combo ? `&combo=${encodeURIComponent(combo)}` : ''}`); }
    catch (e: any) { sec.replaceChildren(h('h2', {}, 'Blackjack Bonus Statistics'), h('p', { class: 'muted' }, e.message)); return; }
    const name = (id: string) => r.catalog.find((c) => c.id === id)?.name ?? id;
    const row = (label: string, l?: BonusLine, extra?: string) => h('tr', {},
      h('td', {}, label), h('td', { class: 'num' }, String(l?.bets ?? 0)), h('td', { class: 'num' }, money(l?.wagered ?? 0)), h('td', { class: 'num' }, money(l?.returned ?? 0)),
      h('td', { class: `num ${(l?.net ?? 0) < 0 ? 'neg' : (l?.net ?? 0) > 0 ? 'pos' : ''}` }, money(l?.net ?? 0, true)), h('td', { class: 'num' }, l?.bets ? `${l.hitPct.toFixed(1)}%` : '—'),
      h('td', { class: 'num' }, l?.biggest ? money(l.biggest) : '—'), h('td', {}, l?.topCombo ?? '—'), extra ? h('td', { class: 'tiny muted' }, extra) : h('td', {}));
    const table = (which: 'lifetime' | 'session') => {
      const ids = Object.keys(r.stats[which]);
      const p = r.stats.progressive[which];
      return h('table', { class: 'paytable wide' },
        h('tr', {}, ...['Wager', 'Bets', 'Wagered', 'Returned', 'Net', 'Hit %', 'Biggest', 'Most common win', ''].map((x) => h('th', {}, x))),
        ...ids.map((id) => row(name(id), r.stats[which][id])),
        p.bets ? row('21+3 Progressive', p, `contributed ${money(p.contributed)} · ${p.jackpots} jackpot${p.jackpots === 1 ? '' : 's'}`) : null);
    };
    const anyBets = Object.keys(r.stats.lifetime).length || r.stats.progressive.lifetime.bets;
    const sel = h('select', { 'aria-label': 'Filter by wager', onchange: (e: Event) => { side = (e.target as HTMLSelectElement).value; combo = ''; load(); } },
      h('option', { value: '' }, 'All bonus bets'), ...r.catalog.filter((c) => c.status === 'playable').map((c) => h('option', { value: c.id, selected: c.id === side }, c.name)),
      h('option', { value: 'progressive', selected: side === 'progressive' }, '21+3 Progressive'));
    const combos = side && side !== 'progressive' ? r.stats.lifetime[side]?.combos ?? [] : side === 'progressive' ? r.stats.progressive.lifetime.combos : [];
    const csel = h('select', { 'aria-label': 'Filter by winning combination', disabled: !combos.length, onchange: (e: Event) => { combo = (e.target as HTMLSelectElement).value; load(); } },
      h('option', { value: '' }, 'Any result'), ...combos.map((c) => h('option', { value: c.combo, selected: c.combo === combo }, `${c.combo} (${c.count})`)));
    sec.replaceChildren(h('h2', {}, 'Blackjack Bonus Statistics'),
      h('p', { class: 'muted' }, 'Side bets and the 21+3 Progressive, per wager. These are kept apart from strategy accuracy: a bonus win never makes a Blackjack decision correct.'),
      !anyBets ? h('p', { class: 'empty' }, 'No Blackjack bonus bets yet.') : h('div', {},
        h('h3', {}, 'This session'), table('session'),
        h('h3', {}, 'Lifetime'), table('lifetime'),
        r.stats.jackpots.length ? h('div', {}, h('h3', {}, 'Jackpot history'), h('ul', {}, ...r.stats.jackpots.map((j) => h('li', {}, `${new Date(j.at).toLocaleString()}: ${j.combo} — ${money(j.amount)}`)))) : null,
        h('h3', {}, 'Bonus hand history'),
        h('div', { class: 'row' }, sel, csel),
        r.hands.length ? h('ul', { class: 'bonus-hands' }, ...r.hands.map((x) => h('li', {},
          h('b', {}, `#${x.handNumber}`), ` ${new Date(x.at).toLocaleString()} · main ${money(x.mainNet, true)} · `,
          ...x.results.map((y) => h('span', { class: y.result === 'win' ? 'pos' : 'muted' }, `${y.name}: ${y.result === 'win' ? `${y.label} ${y.pays}:1 ${money(y.net, true)}` : `lost ${money(y.stake)}`}  `)),
          x.prog ? h('span', { class: x.prog.amount > 0 ? 'pos' : 'muted' }, `21+3 Prog: ${x.prog.amount > 0 ? `${x.prog.combo ?? 'Envy'} ${money(x.prog.amount)}` : `lost ${money(x.prog.stake)}`}`) : null))) : h('p', { class: 'muted' }, 'No hands match this filter.')));
  };
  load();
  return sec;
}

/** A repeated mistake (3+ times) gets a plain-language tip from basic strategy. */
const TIPS: Record<string, string> = {
  'preflop:check:play4': 'Raise 4× pre-flop with any pair of 3s or better, any ace, K2 suited+/K5+, Q6 suited+/Q8+, J8 suited+/J10+.',
  'preflop:play4:check': 'You’re raising too wide pre-flop. Outside the 4× list (pairs 3s+, any ace, K2s+/K5o+, Q6s+/Q8o+, J8s+/JTo+), check.',
  'preflop:play3:play4': 'When you raise pre-flop, raise the full 4×: it’s never better to raise 3×.',
  'flop:check:play2': 'Bet 2× on the flop with two pair or better, a hidden pair (except pocket 2s), or four to a flush with a hidden 10 or better.',
  'flop:play2:check': 'Check the flop unless you have two pair+, a hidden pair (not 2s), or four to a flush with a hidden 10+.',
  'river:fold:play1': 'Rule of thumb: call 1× on the river with a hidden pair or better, or when fewer than 21 dealer cards beat you.',
  'river:play1:fold': 'Rule of thumb: fold on the river when nothing is hidden in your hand and 21 or more dealer cards beat you.',
};
function habit(ms: { phase: string; action: string; recommended: string; count: number; evCost: number }[]) {
  const m = ms.find((x) => x.count >= 3);
  if (!m) return null;
  const tip = TIPS[`${m.phase}:${m.action}:${m.recommended}`] ?? `On the ${PHASE[m.phase].toLowerCase()}, the better play was ${LABEL[m.recommended]}.`;
  return h('div', { class: 'habit' }, h('b', {}, `You keep doing this: ${PHASE[m.phase]} ${LABEL[m.action]} instead of ${LABEL[m.recommended]} (${m.count}×).`),
    h('p', {}, tip, m.phase === 'river' ? ' The trainer’s river advice is exact; it counts every possible dealer hand.' : ''));
}

function graph(series: { cumulative: number }[]) {
  if (series.length < 2) return h('p', { class: 'muted' }, 'The graph appears after two hands.');
  const pts = [0, ...series.map((p) => p.cumulative)];
  const w = 800, ht = 220, pad = 24;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v: number) => ht - pad - ((v - min) / span) * (ht - pad * 2);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = y(0);
  return svg(`<svg class="graph" viewBox="0 0 ${w} ${ht}" role="img" aria-label="Cumulative result over ${series.length} hands">
    <line x1="${pad}" x2="${w - pad}" y1="${zero}" y2="${zero}" class="zero" />
    <polyline points="${line}" class="series" />
    <text x="${pad}" y="${pad - 8}" class="axis">${escapeXml(money(max, true))}</text>
    <text x="${pad}" y="${ht - 6}" class="axis">${escapeXml(money(min, true))}</text>
    <text x="${w - pad}" y="${ht - 6}" text-anchor="end" class="axis">${series.length} hands</text>
  </svg>`);
}
const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

function sideSection(s: Stats) {
  const keys = SIDES_FOR[currentGame].filter((k) => s.side[k] && (currentGame !== 'all' || s.side[k].bets > 0 || ['trips', 'pairs', 'badBeat', 'progressive'].includes(k)));
  const all = keys.map((k) => s.side[k]);
  const combined = { bets: all.reduce((a, x) => a + x.bets, 0), wagered: all.reduce((a, x) => a + x.wagered, 0), net: all.reduce((a, x) => a + x.net, 0) };
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  return h('section', { class: 'card-sec' }, h('h2', {}, 'Bonus bets'),
    h('p', {}, `Main game ${money(s.baseNet, true)} on ${money(s.baseWagered)} wagered. Bonus bets ${money(combined.net, true)} on ${money(combined.wagered)} across ${combined.bets} bets. Strategy and house-edge figures above use the main game only.`),
    h('table', { class: 'tables side-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Bet'), h('th', {}, 'Bets'), h('th', {}, 'Hits'), h('th', {}, 'Hit rate'), h('th', {}, 'Wagered'),
        h('th', {}, 'Returned'), h('th', {}, 'Net'), h('th', {}, 'Biggest payout'))),
      h('tbody', {}, ...keys.map((k) => {
        const x = s.side[k];
        return h('tr', {}, h('td', {}, SIDE_NAME[k]), h('td', { class: 'num' }, String(x.bets)), h('td', { class: 'num' }, String(x.wins)),
          h('td', { class: 'num' }, pct(x.wins, x.bets)), h('td', { class: 'num' }, money(x.wagered)), h('td', { class: 'num' }, money(x.returned)),
          h('td', { class: `num ${x.net < 0 ? 'neg' : x.net > 0 ? 'pos' : ''}` }, money(x.net, true)), h('td', { class: 'num' }, x.biggestPayout ? money(x.biggestPayout) : '—'));
      }),
      h('tr', { class: 'total' }, h('td', {}, 'All bonus bets'), h('td', { class: 'num' }, String(combined.bets)), h('td', { class: 'num' }, String(all.reduce((a, x) => a + x.wins, 0))),
        h('td', {}), h('td', { class: 'num' }, money(combined.wagered)), h('td', { class: 'num' }, money(all.reduce((a, x) => a + x.returned, 0))),
        h('td', { class: `num ${combined.net < 0 ? 'neg' : 'pos'}` }, money(combined.net, true)), h('td', {})))),
    h('div', { class: 'phase-grid' }, ...keys.map((k) => h('div', { class: 'phase-card' }, h('h3', {}, `${SIDE_NAME[k]} winning hands`),
      s.side[k].combos.length ? h('ul', {}, ...s.side[k].combos.map((c) => h('li', {}, h('span', {}, c.combo), h('span', { class: 'num' }, `${c.count}×`))))
        : h('p', { class: 'muted' }, s.side[k].bets ? 'No hits yet.' : 'No bets yet.')))));
}
