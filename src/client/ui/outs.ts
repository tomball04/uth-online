import type { Outs } from '../../shared/strategy.js';
import { h } from '../dom.js';

/** "K×3, 9×3, 7×3" — the outs grouped by rank. */
export const outsList = (o: Outs) => o.byRank.map((r) => (r.count > 1 ? `${r.rank}×${r.count}` : r.rank)).join(', ');

export function outsText(o: Outs): string {
  if (o.kind === 'dealer') {
    const rule = o.count < 21 ? 'fewer than 21, so the rule of thumb says play 1×' : '21 or more, so the rule of thumb says fold';
    return `Dealer outs: ${o.count} (${outsList(o) || 'none'}) — ${rule}. Exactly ${o.beatingHands} of ${o.combos} possible dealer hands beat you.`;
  }
  return o.count
    ? `Your outs to improve: ${o.count} (${outsList(o)}) — about ${Math.round((o.hitByRiver ?? 0) * 100)}% to hit at least one by the river.`
    : 'Your outs to improve: none — no turn card makes a better hand with your own cards.';
}

export const outsEl = (o?: Outs) => (o ? h('div', { class: 'outs' }, outsText(o)) : null);
