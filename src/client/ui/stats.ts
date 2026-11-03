import { api } from '../api.js';
import { h, money, svg, toast } from '../dom.js';
import { pawnFor } from '../../shared/debt.js';

interface Stats {
  hands: number; net: number; wins: number; losses: number; pushes: number; folds: number; biggestWin: number; biggestLoss: number;
  bestHand: string | null; totalWagered: number; decisions: number; correctDecisions: number; evLost: number;
  byPhase: { phase: string; action: string; count: number; correct: number }[];
  commonMistakes: { phase: string; action: string; recommended: string; count: number; evCost: number }[];
  trips: { bets: number; wins: number; net: number }; handsWithFriends: number; reloads: number; tables: number; debt?: number;
  side: Record<'trips' | 'pairs' | 'badBeat' | 'progressive', Side>; baseNet: number; baseWagered: number;
  series: { at: string; cumulative: number }[];
}
interface Side { bets: number; wins: number; wagered: number; returned: number; net: number; biggestPayout: number; combos: { combo: string; count: number }[] }
const SIDE_NAME = { trips: 'Trips+', pairs: 'Ultimate Pairs', badBeat: 'Bad Beat', progressive: '$5 Progressive' } as const;
const LABEL: Record<string, string> = { play4: 'Play 4×', play3: 'Play 3×', play2: 'Play 2×', play1: 'Play 1×', check: 'Check', fold: 'Fold' };
const PHASE: Record<string, string> = { preflop: 'Pre-flop', flop: 'Flop', river: 'River' };

export async function mountStats(root: HTMLElement, nav: (p: string) => void) {
  root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'muted' }, 'Loading your statistics…')));
  let s: Stats;
  try { s = (await api<{ stats: Stats }>('/api/stats/me')).stats; }
  catch (e: any) { toast(e.message, 'error'); nav('/'); return; }

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const fig = (label: string, value: string, cls = '') => h('div', { class: 'fig' }, h('span', { class: `fig-v ${cls}` }, value), h('span', { class: 'fig-l' }, label));

  const phases = ['preflop', 'flop', 'river'].map((p) => {
    const rows = s.byPhase.filter((x) => x.phase === p);
    const total = rows.reduce((a, r) => a + r.count, 0);
    const ok = rows.reduce((a, r) => a + r.correct, 0);
    return h('div', { class: 'phase-card' }, h('h3', {}, PHASE[p]), h('p', { class: 'big-num' }, pct(ok, total)),
      h('p', { class: 'muted' }, `${ok} of ${total} matched the best play`),
      h('ul', {}, ...rows.map((r) => h('li', {}, h('span', {}, LABEL[r.action]), h('span', { class: 'num' }, String(r.count))))));
  });

  root.replaceChildren(h('main', { class: 'page stats' },
    h('div', { class: 'page-head' }, h('button', { class: 'ghost', onclick: () => nav('/') }, '← Lobby'), h('h1', {}, 'Your statistics')),
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
      h('p', { class: 'muted' }, `Across ${s.tables} table${s.tables === 1 ? '' : 's'} · ${s.reloads} reload${s.reloads === 1 ? '' : 's'}${s.debt ? ` · ${money(s.debt)} in markers (to cover it, pawn ${pawnFor(s.debt).item})` : ''}. With perfect strategy the house edge is about 2.2% of the Ante per hand, roughly 0.5% of total action.`)),
    h('section', { class: 'card-sec' }, h('h2', {}, 'Strategy'),
      h('p', {}, `${pct(s.correctDecisions, s.decisions)} of your ${s.decisions} decisions matched optimal strategy. Mistakes have cost about `,
        h('b', {}, `${s.evLost.toFixed(2)} antes`), ' of expected value in total.'),
      h('div', { class: 'phase-grid' }, ...phases),
      h('h3', {}, 'Most common mistakes'),
      s.commonMistakes.length ? h('ol', { class: 'mistakes' }, ...s.commonMistakes.map((m) => h('li', {},
        `${PHASE[m.phase]}: ${LABEL[m.action]} instead of ${LABEL[m.recommended]}`, h('span', { class: 'muted' }, ` — ${m.count}× · ${m.evCost.toFixed(2)} antes`)))) : h('p', { class: 'muted' }, 'None yet.')),
    sideSection(s)));
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
  const keys = (['trips', 'pairs', 'badBeat', 'progressive'] as const).filter((k) => s.side[k]);
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
