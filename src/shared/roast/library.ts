// §32.13 The dialogue library: every authored line, structured. Lines live in ./lines/<category>.ts as
// `'<level>|<text>'` strings per dealer; this module turns them into tagged entries with ids, facts, profanity,
// size, priority, cooldown and speech style, so nothing else in the app holds roast strings.
import { CATEGORIES, RULES, type RoastCategory, type RoastLevel, type Fact } from './meta.js';
import { factsOf, profanityOf, sizeOf } from './render.js';
import { CONTENT } from './lines.js';

export const ROAST_DEALERS = ['vincent', 'sophia', 'marcus', 'elena', 'james', 'naomi', 'rafael', 'claire', 'andre', 'victoria', 'daniel', 'isabella'] as const;
export type RoastDealer = (typeof ROAST_DEALERS)[number];
export type DealerLines = Record<RoastDealer, string[]>;

export interface RoastLine {
  id: string;
  dealer: RoastDealer;
  cat: RoastCategory;
  /** Lowest attitude at which the line may be used (1 Smartass … 4 No Mercy). */
  level: RoastLevel;
  text: string;
  facts: Fact[];
  profanity: 0 | 1 | 2 | 3;
  size: 'short' | 'medium' | 'long';
  priority: number;
  /** Hands before this exact line may be considered again at the same table (on top of the 100-line window). */
  cooldown: number;
  /** Speech delivery for synthesized voice. */
  style: 'normal' | 'shout' | 'quiet' | 'rant';
}

/** Speech character per dealer: rate and pitch for the browser's speech synthesis. */
export const VOICE: Record<RoastDealer, { rate: number; pitch: number }> = {
  vincent: { rate: 0.88, pitch: 0.7 }, sophia: { rate: 0.96, pitch: 1.15 }, marcus: { rate: 1.12, pitch: 0.85 },
  elena: { rate: 0.94, pitch: 1.05 }, james: { rate: 0.92, pitch: 0.9 }, naomi: { rate: 0.9, pitch: 1.0 },
  rafael: { rate: 1.1, pitch: 0.95 }, claire: { rate: 1.05, pitch: 1.3 }, andre: { rate: 1.2, pitch: 0.9 },
  victoria: { rate: 0.9, pitch: 1.1 }, daniel: { rate: 0.85, pitch: 0.8 }, isabella: { rate: 1.0, pitch: 1.2 },
};

function styleOf(text: string, cat: RoastCategory, dealer: RoastDealer): RoastLine['style'] {
  if (cat === 'meltdown') return 'rant';
  if ((text.match(/\b[A-Z]{3,}\b/g) ?? []).length >= 2) return 'shout';
  if (dealer === 'naomi' || dealer === 'sophia') return 'quiet';
  return 'normal';
}

function build(): RoastLine[] {
  const out: RoastLine[] = [];
  for (const cat of CATEGORIES) {
    const per = CONTENT[cat];
    if (!per) continue;
    for (const dealer of ROAST_DEALERS) {
      (per[dealer] ?? []).forEach((raw, i) => {
        const m = /^([1-4])\|(.+)$/s.exec(raw);
        if (!m) throw new Error(`Bad roast line ${dealer}.${cat}.${i}: ${raw.slice(0, 40)}`);
        const text = m[2].trim();
        out.push({
          id: `${dealer}.${cat}.${i}`, dealer, cat, level: Number(m[1]) as RoastLevel, text, facts: factsOf(text),
          profanity: profanityOf(text), size: sizeOf(text), priority: RULES[cat].priority,
          cooldown: sizeOf(text) === 'long' ? 40 : 20, style: styleOf(text, cat, dealer),
        });
      });
    }
  }
  return out;
}

export const LINES: RoastLine[] = build();
export const LINE = new Map(LINES.map((l) => [l.id, l]));
const BY = new Map<string, RoastLine[]>();
for (const l of LINES) { const k = `${l.dealer}|${l.cat}`; (BY.get(k) ?? BY.set(k, []).get(k)!).push(l); }
/** All lines for one dealer and category. */
export const linesFor = (dealer: string, cat: RoastCategory): RoastLine[] => BY.get(`${dealer}|${cat}`) ?? [];

/** Content status for the verification report: how many lines exist per dealer and category. */
export function contentReport() {
  const rows = CATEGORIES.map((cat) => ({ cat, perDealer: Object.fromEntries(ROAST_DEALERS.map((d) => [d, linesFor(d, cat).length])) as Record<RoastDealer, number> }));
  const complete = rows.filter((r) => ROAST_DEALERS.every((d) => r.perDealer[d] >= 15)).map((r) => r.cat);
  return { total: LINES.length, rows, complete, incomplete: CATEGORIES.filter((c) => !complete.includes(c)) };
}
