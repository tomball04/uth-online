// §32 rendering helpers shared by server and browser: substitutions, profanity classification and the clean filter.
import type { Fact, RoastVars } from './meta.js';

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** Facts named in a line's text. */
export function factsOf(text: string): Fact[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as Fact))];
}
/** Fill placeholders. Unknown placeholders are left visible so tests can catch them (they never reach players:
 *  the selector only picks lines whose facts are all supplied). */
export function fill(text: string, vars: RoastVars): string {
  return text.replace(PLACEHOLDER, (m, k: string) => (vars as Record<string, string | undefined>)[k] ?? m);
}

// Profanity classes: 0 none, 1 mild, 2 strong, 3 severe.
const WORDS: [RegExp, 1 | 2 | 3, string][] = [
  [/\bmotherfuckers\b/gi, 3, 'mother-flippers'], [/\bmotherfucking\b/gi, 3, 'mother-flipping'], [/\bmotherfucker\b/gi, 3, 'mother-flipper'],
  [/\bfuckin'?(?=\W|$)/gi, 3, 'flippin’'], [/\bfucking\b/gi, 3, 'flipping'], [/\bfucked\b/gi, 3, 'flubbed'], [/\bfuckers\b/gi, 3, 'flippers'],
  [/\bfucker\b/gi, 3, 'flipper'], [/\bfucks\b/gi, 3, 'flips'], [/\bfuck\b/gi, 3, 'flip'], [/\bfuckery\b/gi, 3, 'flippery'],
  [/\bbullshit\b/gi, 2, 'baloney'], [/\bdipshits?\b/gi, 2, 'dingbat'], [/\bshitheads?\b/gi, 2, 'bonehead'], [/\bshitshow\b/gi, 2, 'circus'],
  [/\bshitty\b/gi, 2, 'crummy'], [/\bshits\b/gi, 2, 'craps'], [/\bshit\b/gi, 2, 'crap'],
  [/\bassholes\b/gi, 2, 'clowns'], [/\basshole\b/gi, 2, 'clown'], [/\bdumbasses\b/gi, 2, 'dum-dums'], [/\bdumbass\b/gi, 2, 'dum-dum'],
  [/\bjackass\b/gi, 2, 'donkey'], [/\bsmartass\b/gi, 2, 'smarty-pants'], [/\bbadass\b/gi, 2, 'tough guy'],
  [/\bbastards\b/gi, 2, 'busters'], [/\bbastard\b/gi, 2, 'buster'], [/\bgoddamn(ed)?\b/gi, 2, 'gosh-darn'], [/\bgoddamnit\b/gi, 2, 'gosh darn it'],
  [/\bpissed\b/gi, 1, 'ticked'], [/\bpissing\b/gi, 1, 'throwing'], [/\bpiss\b/gi, 1, 'pee'],
  [/\bdamned\b/gi, 1, 'darned'], [/\bdamnit\b/gi, 1, 'darn it'], [/\bdamn\b/gi, 1, 'darn'], [/\bhell\b/gi, 1, 'heck'],
  [/\bjesus christ\b/gi, 1, 'good grief'], [/\bjesus\b/gi, 1, 'jeez'], [/\bchrist\b/gi, 1, 'crikey'],
  [/\basses\b/gi, 1, 'butts'], [/\bass\b/gi, 1, 'butt'], [/\barse\b/gi, 1, 'backside'], [/\bbloody\b/gi, 1, 'blooming'],
];

/** 0 none · 1 mild · 2 strong · 3 severe. */
export function profanityOf(text: string): 0 | 1 | 2 | 3 {
  let p: 0 | 1 | 2 | 3 = 0;
  for (const [re, lvl] of WORDS) { re.lastIndex = 0; if (lvl > p && re.test(text)) p = lvl; }
  return p;
}
const keepCase = (src: string, rep: string) =>
  src === src.toUpperCase() && /[A-Z]/.test(src) ? rep.toUpperCase() : /^[A-Z]/.test(src) ? rep[0].toUpperCase() + rep.slice(1) : rep;
/** The same line with every profane word swapped for a clean one (case kept, so shouted lines stay shouted). */
export function cleanText(text: string): string {
  let out = text;
  for (const [re, , rep] of WORDS) { re.lastIndex = 0; out = out.replace(re, (m) => keepCase(m, rep)); }
  return out;
}

export function sizeOf(text: string): 'short' | 'medium' | 'long' {
  return text.length < 95 ? 'short' : text.length < 185 ? 'medium' : 'long';
}

/** Small deterministic generator for picking alternatives the same way on every device. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % n); };
}
