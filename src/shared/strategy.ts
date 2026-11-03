// Strategy engine. Every function here takes ONLY information the deciding player legitimately has:
// their own two hole cards and the community cards revealed so far. It never sees other players'
// cards or the dealer's hole cards, so it is safe to run on the client (Training hints) and on the
// server (grading) with identical results.
//
// Pre-flop and flop use the widely published optimal basic strategy for UTH (Wizard of Odds /
// Shackleford), which is within a fraction of a percent of perfect play. The river uses an exact
// solver over all 990 possible dealer hole-card pairs.
//
// Corrections vs. the original prototype:
//  - Pre-flop: added King-x suited, Q6+ suited, J8+ suited; removed J9 offsuit; pocket 2s CHECK
//    (the prototype said 3x). 3x is never optimal: whenever raising is right, 4x is better.
//  - Flop: two pair counts only if the hole cards contribute; four-flush needs a hidden 10+ of the suit;
//    pocket 2s check; a single hole card pairing ANY board rank is a hidden pair (prototype required 4+).
//  - River: replaced the "pair of 3s or better" heuristic with exact EV over 990 dealer combos.

import { rankOf, suitOf, RANK_CHARS } from './cards.js';
import { Cat, categoryOf, evaluate } from './evaluator.js';
import { BLIND_PAYTABLE, type Decision, type DecisionPhase } from './rules.js';
import { handName } from './evaluator.js';

export interface Advice {
  phase: DecisionPhase;
  action: Decision;
  reason: string;
  /** EV per 1 unit of Ante for each legal action, when computed exactly or estimated. */
  ev?: Partial<Record<Decision, number>>;
  evExact?: boolean;
  detail?: { wins: number; ties: number; losses: number; combos: number };
}

const R = (r: number) => RANK_CHARS[r] === 'T' ? '10' : RANK_CHARS[r];

// ------------------------------------------------------------------ PRE-FLOP
export function preflopAdvice(hole: number[]): Advice {
  const [a, b] = hole;
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const suited = suitOf(a) === suitOf(b);
  const pair = hi === lo;
  const raise = (reason: string): Advice => ({ phase: 'preflop', action: 'play4', reason });
  const check = (reason: string): Advice => ({ phase: 'preflop', action: 'check', reason });
  const A = 12, K = 11, Q = 10, J = 9;

  if (pair) return lo >= 1 ? raise(`Pocket ${R(lo)}s — any pair of 3s or better is a 4x raise.`)
                           : check('Pocket 2s are just below the 4x threshold; check and re-evaluate on the flop.');
  if (hi === A) return raise('Any ace is a 4x raise.');
  if (hi === K) {
    if (suited) return raise('King with any suited card is a 4x raise.');
    if (lo >= 3) return raise('King-5 offsuit or better is a 4x raise.');
    return check('King with a 2, 3 or 4 offsuit is too weak to raise 4x.');
  }
  if (hi === Q) {
    if (suited && lo >= 4) return raise('Queen-6 suited or better is a 4x raise.');
    if (!suited && lo >= 6) return raise('Queen-8 offsuit or better is a 4x raise.');
    return check(suited ? 'Suited queens need a 6 or better kicker to raise.' : 'Offsuit queens need an 8 or better kicker to raise.');
  }
  if (hi === J) {
    if (suited && lo >= 6) return raise('Jack-8 suited or better is a 4x raise.');
    if (!suited && lo >= 8) return raise('Jack-10 offsuit is a 4x raise.');
    return check(suited ? 'Suited jacks need an 8 or better kicker to raise.' : 'Offsuit jacks need a 10 kicker to raise.');
  }
  return check('No ace, king, or strong queen/jack — check and see the flop for free.');
}

// ------------------------------------------------------------------ FLOP
export function flopAdvice(hole: number[], flop: number[]): Advice {
  const all = [...hole, ...flop];
  const full = evaluate(all);
  const boardOnly = evaluate(flop);
  const catAll = categoryOf(full), catBoard = categoryOf(boardOnly);
  const pocket2s = rankOf(hole[0]) === 0 && rankOf(hole[1]) === 0;
  const raise = (reason: string): Advice => ({ phase: 'flop', action: 'play2', reason });

  if (catAll > catBoard && catAll >= Cat.TwoPair) {
    // pocket deuces + paired board makes "two pair" but is still just the deuces
    const onlyDeuces = pocket2s && catAll === Cat.TwoPair;
    if (!onlyDeuces) return raise(`${handName(full)} using your hole cards — play 2x.`);
  }
  if (catAll > catBoard && catAll === Cat.Pair) {
    if (pocket2s) return { phase: 'flop', action: 'check', reason: 'Pocket 2s are the exception to the hidden-pair rule — check.' };
    return raise('Hidden pair (at least one of your hole cards makes the pair) — play 2x.');
  }
  // four to a flush with a hidden 10 or better of that suit
  for (let s = 0; s < 4; s++) {
    const n = all.filter((c) => suitOf(c) === s).length;
    if (n === 4 && hole.some((c) => suitOf(c) === s && rankOf(c) >= 8))
      return raise('Four to a flush including your own 10 or better of that suit — play 2x.');
  }
  return { phase: 'flop', action: 'check', reason: catAll > catBoard
    ? 'Your hand improved, but not enough to bet 2x — check.'
    : 'No hidden pair, two pair, or strong flush draw — check.' };
}

// ------------------------------------------------------------------ RIVER (exact)
interface Components { a: number; b: number; p: number; wins: number; ties: number; losses: number; n: number }

/** Average Ante / Blind / per-unit-Play results over every dealer hand consistent with the known cards. */
function enumerateDealer(hole: number[], board: number[], exclude: number[] = []): Components {
  const known = new Set([...hole, ...board, ...exclude]);
  const rest: number[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) rest.push(c);
  const pScore = evaluate([...hole, ...board]);
  const pay = BLIND_PAYTABLE[handName(pScore)];
  const blindWin = pay ? pay[0] / pay[1] : 0;
  let a = 0, b = 0, p = 0, wins = 0, ties = 0, losses = 0, n = 0;
  const seven = [...board, 0, 0];
  for (let i = 0; i < rest.length; i++) {
    seven[5] = rest[i];
    for (let j = i + 1; j < rest.length; j++) {
      seven[6] = rest[j];
      const d = evaluate(seven);
      n++;
      if (pScore > d) { wins++; p += 1; b += blindWin; if (categoryOf(d) >= Cat.Pair) a += 1; }
      else if (pScore < d) { losses++; p -= 1; b -= 1; if (categoryOf(d) >= Cat.Pair) a -= 1; }
      else ties++;
    }
  }
  return { a: a / n, b: b / n, p: p / n, wins, ties, losses, n };
}

export function riverAdvice(hole: number[], board: number[]): Advice {
  const c = enumerateDealer(hole, board);
  const evCall = c.a + c.b + c.p;
  const evFold = -2;
  const action: Decision = evCall >= evFold ? 'play1' : 'fold';
  const beat = c.losses;
  const reason = action === 'play1'
    ? `Exact: playing 1x averages ${fmt(evCall)} antes vs ${fmt(evFold)} for folding. You beat or tie ${c.wins + c.ties} of ${c.n} possible dealer hands.`
    : `Exact: playing 1x averages ${fmt(evCall)} antes vs ${fmt(evFold)} for folding — ${beat} of ${c.n} dealer hands beat you.`;
  return {
    phase: 'river', action, reason, evExact: true,
    ev: { play1: evCall, fold: evFold },
    detail: { wins: c.wins, ties: c.ties, losses: c.losses, combos: c.n },
  };
}

const fmt = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);

/** Recommendation for whichever phase the player is in, using only their visible cards. */
export function advise(phase: DecisionPhase, hole: number[], community: number[]): Advice {
  if (phase === 'preflop') return preflopAdvice(hole);
  if (phase === 'flop') return flopAdvice(hole, community.slice(0, 3));
  return riverAdvice(hole, community.slice(0, 5));
}

// ------------------------------------------------------------------ EV estimates for grading
// Used after a hand to price a pre-flop or flop deviation. These are Monte Carlo / partial
// enumeration estimates and are labelled as such in the UI. River grading is exact.

type Rng = () => number;

function remaining(known: number[]): number[] {
  const k = new Set(known);
  const out: number[] = [];
  for (let c = 0; c < 52; c++) if (!k.has(c)) out.push(c);
  return out;
}

function sampleWithout(pool: number[], n: number, rng: Rng): number[] {
  const p = pool.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (p.length - i));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, n);
}

/** Flop: EV(2x) vs EV(check then optimal exact river). Samples `runouts` turn/river pairs. */
export function flopEV(hole: number[], flop: number[], runouts = 160, rng: Rng = Math.random) {
  const pool = remaining([...hole, ...flop]);
  const pairs: [number, number][] = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i], pool[j]]);
  const chosen = runouts >= pairs.length ? pairs : sampleWithout(pairs.map((_, i) => i), runouts, rng).map((i) => pairs[i]);
  let ev2 = 0, evCheck = 0;
  for (const [t, r] of chosen) {
    const c = enumerateDealer(hole, [...flop, t, r]);
    ev2 += c.a + c.b + 2 * c.p;
    evCheck += Math.max(c.a + c.b + c.p, -2);
  }
  return { play2: ev2 / chosen.length, check: evCheck / chosen.length, exact: chosen.length === pairs.length };
}

/** Pre-flop: EV(4x), EV(3x) vs EV(check then basic strategy). Monte Carlo over full deals. */
export function preflopEV(hole: number[], samples = 20000, rng: Rng = Math.random) {
  const pool = remaining(hole);
  let ev4 = 0, ev3 = 0, evCheck = 0;
  for (let s = 0; s < samples; s++) {
    const d = sampleWithout(pool, 7, rng);
    const board = d.slice(0, 5), dealer = d.slice(5);
    const ps = evaluate([...hole, ...board]);
    const ds = evaluate([...dealer, ...board]);
    const cmp = Math.sign(ps - ds);
    const q = categoryOf(ds) >= Cat.Pair;
    const pay = BLIND_PAYTABLE[handName(ps)];
    const a = !q ? 0 : cmp;
    const b = cmp > 0 ? (pay ? pay[0] / pay[1] : 0) : cmp < 0 ? -1 : 0;
    ev4 += a + b + 4 * cmp;
    ev3 += a + b + 3 * cmp;
    if (flopAdvice(hole, board.slice(0, 3)).action === 'play2') evCheck += a + b + 2 * cmp;
    else {
      // river rule of thumb for the estimate: play with a hand that uses a hole card to make a pair or better
      const callRiver = categoryOf(ps) >= Cat.Pair && ps > evaluate(board);
      evCheck += callRiver ? a + b + cmp : -2;
    }
  }
  return { play4: ev4 / samples, play3: ev3 / samples, check: evCheck / samples };
}

/**
 * EV cost (in ante units, ≥ 0) of taking `actual` instead of the recommended action.
 * Returns null when the action was optimal.
 */
export function mistakeCost(phase: DecisionPhase, hole: number[], community: number[], actual: Decision):
  { recommended: Decision; cost: number; exact: boolean; ev: Partial<Record<Decision, number>> } | null {
  const rec = advise(phase, hole, community);
  if (rec.action === actual) return null;
  if (phase === 'river') {
    const ev = rec.ev!;
    return { recommended: rec.action, cost: Math.max(0, ev[rec.action]! - ev[actual]!), exact: true, ev };
  }
  if (phase === 'flop') {
    const e = flopEV(hole, community.slice(0, 3));
    const ev = { play2: e.play2, check: e.check };
    return { recommended: rec.action, cost: Math.max(0, ev[rec.action as 'play2' | 'check'] - ev[actual as 'play2' | 'check']), exact: e.exact, ev };
  }
  const e = preflopEV(hole);
  const ev = { play4: e.play4, play3: e.play3, check: e.check };
  const k = (d: Decision) => ev[d as 'play4' | 'play3' | 'check'];
  return { recommended: rec.action, cost: Math.max(0, k(rec.action) - k(actual)), exact: false, ev };
}
