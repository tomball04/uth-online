// §32 What one viewer sees for a roast, given their own limits. Pure, so it can be tested and shared.
import type { RoastPayload } from './meta.js';
import { cleanText, fill, seeded } from './render.js';
import type { RoastLine } from './library.js';

export interface ViewerLimits { mute: boolean; max: 0 | 1 | 2 | 3 | 4; profanity: boolean }
export interface Shown { text: string; major: boolean; meltdown: boolean; style: RoastLine['style'] | 'normal'; dealer: string; lineId: string | null }
const SIZE_RANK = { short: 0, medium: 1, long: 2 } as const;

/**
 * null = hidden (dealer muted). Lines above the viewer's limit are swapped for a gentler line from the same dealer
 * and situation — chosen identically on every device from the payload's seed — or the plain Professional text.
 */
export function viewRoast(r: RoastPayload, plainText: string, v: ViewerLimits,
  lib: { LINE: Map<string, RoastLine>; linesFor: (d: string, c: RoastPayload['cat']) => RoastLine[] }): Shown | null {
  if (v.mute) return null;
  const plain: Shown = { text: plainText, major: false, meltdown: false, style: 'normal', dealer: r.dealer, lineId: null };
  if (v.max < 1) return plain;
  let line = lib.LINE.get(r.lineId);
  if (!line || line.level > v.max) {
    const alts = lib.linesFor(r.dealer, r.cat).filter((l) => l.level <= v.max && SIZE_RANK[l.size] <= SIZE_RANK[r.size]
      && l.facts.every((f) => r.vars[f] !== undefined && r.vars[f] !== ''));
    line = alts.length ? alts[seeded(r.seed)(alts.length)] : undefined;
  }
  if (!line) return plain;
  let text = fill(line.text, r.vars);
  if (!v.profanity) text = cleanText(text);
  return { text, major: !!r.major, meltdown: !!r.meltdown, style: line.style, dealer: r.dealer, lineId: line.id };
}
