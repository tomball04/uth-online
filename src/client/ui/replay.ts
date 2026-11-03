// Hand replay built strictly from the saved server record — it never re-deals or recomputes money.

import { api } from '../api.js';
import { cardEl } from '../cardView.js';
import { h, modal, money, toast } from '../dom.js';

interface Replay {
  hand: {
    handId: string; handNumber: number; status: string; dealer: string[]; community: string[]; dealerHand: string | null;
    dealerQualifies: boolean | null; deckCommitment: string;
    players: { playerId: string; name: string; seat: number; hole: string[] | null; folded: boolean; ante: number; blind: number; trips: number; play: number; net: number | null; outcome: string | null; handName: string | null }[];
    decisions: { phase: string; action: string; recommended: string; correct: boolean; reason: string; timedOut: boolean; evCost?: number; evExact?: boolean }[];
  };
  you: string;
}

const STEPS = ['Deal', 'Flop', 'Turn & river', 'Showdown'] as const;
const LABEL: Record<string, string> = { play4: 'Play 4×', play3: 'Play 3×', play2: 'Play 2×', play1: 'Play 1×', check: 'Check', fold: 'Fold' };

export async function openReplay(handId: string) {
  let data: Replay;
  try { data = await api<Replay>(`/api/hands/${encodeURIComponent(handId)}`); }
  catch (e: any) { toast(e.message, 'error'); return; }
  const r = data.hand;
  let step = 0;
  const stage = h('div', { class: 'replay-stage' });
  const stepLabel = h('span', { class: 'step-label' });
  const prevBtn = h('button', { class: 'btn small', onclick: () => go(step - 1) }, 'Back');
  const nextBtn = h('button', { class: 'btn small gold', onclick: () => go(step + 1) }, 'Next');

  function go(s: number) {
    step = Math.max(0, Math.min(STEPS.length - 1, s));
    stepLabel.textContent = `${step + 1} / ${STEPS.length} · ${STEPS[step]}`;
    (prevBtn as HTMLButtonElement).disabled = step === 0;
    (nextBtn as HTMLButtonElement).disabled = step === STEPS.length - 1;
    const shown = step === 0 ? 0 : step === 1 ? 3 : 5;
    const showdown = step === 3;
    const phase = ['preflop', 'flop', 'river'][Math.min(step, 2)];
    stage.replaceChildren(
      h('div', { class: 'rp-row' }, h('span', { class: 'rp-who' }, 'Dealer'),
        h('div', { class: 'cards-row' }, ...r.dealer.map((c) => cardEl(showdown ? c : null, 'sm'))),
        showdown ? h('span', { class: 'rp-hand' }, `${r.dealerHand ?? ''}${r.dealerQualifies === false ? ' — no qualify' : ''}`) : null),
      h('div', { class: 'rp-row' }, h('span', { class: 'rp-who' }, 'Board'),
        h('div', { class: 'cards-row' }, ...r.community.map((c, i) => cardEl(i < shown ? c : null, 'sm')))),
      ...r.players.map((p) => {
        const mine = p.playerId === data.you;
        const visible = mine || (showdown && p.hole);
        return h('div', { class: `rp-row ${mine ? 'mine' : ''}` }, h('span', { class: 'rp-who' }, p.name),
          h('div', { class: 'cards-row' }, ...(p.hole ?? [null, null]).map((c) => cardEl(visible ? c : null, 'sm'))),
          showdown ? h('span', { class: `rp-hand ${(p.net ?? 0) > 0 ? 'pos' : (p.net ?? 0) < 0 ? 'neg' : ''}` },
            `${p.folded ? 'Folded' : p.handName ?? ''} · ${p.net === null ? '' : money(p.net, true)}`) : h('span', { class: 'rp-hand muted' }, `Ante ${money(p.ante)}${p.trips ? ` · Trips ${money(p.trips)}` : ''}`));
      }),
      h('ul', { class: 'grades' }, ...r.decisions.filter((d) => d.phase === phase || (showdown && true)).filter((d) => showdown || d.phase === phase).map((d) =>
        h('li', { class: d.correct ? 'ok' : 'bad' }, `${d.correct ? '✓' : '✗'} You: ${LABEL[d.action]}${d.timedOut ? ' (timed out)' : ''}`,
          d.correct ? '' : ` — best: ${LABEL[d.recommended]}${d.evCost !== undefined ? ` (−${d.evCost.toFixed(2)} antes${d.evExact ? '' : ', est.'})` : ''}`,
          h('div', { class: 'why' }, d.reason)))));
  }
  go(0);
  modal(`Hand #${r.handNumber}${r.status === 'voided' ? ' (voided — stakes refunded)' : ''}`,
    h('div', { class: 'replay' }, stage, h('div', { class: 'replay-nav' }, prevBtn, stepLabel, nextBtn),
      h('p', { class: 'muted tiny' }, `Deck commitment ${r.deckCommitment.slice(0, 16)}…`)), { wide: true });
}
