// §31 Decision quality vs. results ("Wrong Call Wins").
// Pure functions over server-recorded decisions and settled results. The browser never sends a classification;
// it only displays what the server computes from immutable rows (decisions + hand_players).
import type { GameId } from './rules.js';

export interface QDecision {
  phase: string; action: string; recommended: string; correct: boolean; graded: boolean; timedOut: boolean; reason: string;
  /** EV cost in units of the opening wager (Ante, or the Blackjack bet). null = not calculable. */
  evCost: number | null;
  /** EV cost in cents, when calculable. Fixed at decision time — the hand's result never changes it. */
  evCents: number | null;
}
export interface QHand {
  handId: string; handNumber: number; tableCode: string; game: GameId; at: number; nightId: string | null;
  /** Main-game result only (side bets, bonuses, progressive and insurance excluded). */
  mainNet: number;
  /** Everything, side bets included — shown for context, never used to classify. */
  totalNet: number;
  folded: boolean;
  hole: string[]; community: string[]; dealer: string[];
  /** Blackjack: each played hand's cards (after splits). */
  bjHands?: string[][];
  decisions: QDecision[];
}
export type Call = 'wrong' | 'right' | 'ungraded';
export type Result = 'win' | 'loss' | 'push';
export interface Classified {
  call: Call; result: Result;
  /** Mistakes in this hand (each tracked separately in detailed analytics). */
  mistakes: QDecision[];
  /** Sum of the mistakes' EV cost in cents, or null if any mistake's cost is unknown. */
  evLostCents: number | null;
  ungradedDecisions: number;
}

/**
 * One classification per completed round (a split Blackjack round counts once).
 * - wrong: at least one graded decision differed from the recommended play.
 * - right: at least one graded decision and no deviations.
 * - ungraded: no graded decision (e.g. only constrained decisions, or a Blackjack natural / dealer blackjack).
 * Result is the sign of the MAIN-game net, so a side-bet win never turns a losing hand into a win, and a folded
 * hand is a loss even when its bonus bet paid.
 */
export function classify(h: QHand): Classified {
  const graded = h.decisions.filter((d) => d.graded);
  const mistakes = graded.filter((d) => !d.correct);
  const call: Call = mistakes.length ? 'wrong' : graded.length ? 'right' : 'ungraded';
  const result: Result = h.mainNet > 0 ? 'win' : h.mainNet < 0 ? 'loss' : 'push';
  const evLostCents = mistakes.every((m) => m.evCents !== null) ? mistakes.reduce((a, m) => a + (m.evCents ?? 0), 0) : null;
  return { call, result, mistakes, evLostCents, ungradedDecisions: h.decisions.length - graded.length };
}

export interface QualitySummary {
  hands: number;
  wrongWins: number; wrongLosses: number; wrongPushes: number;
  rightWins: number; rightLosses: number; rightPushes: number;
  ungraded: number;
  /** Hands with at least one deviation (= wrongWins + wrongLosses + wrongPushes). */
  wrongHands: number; rightHands: number;
  /** Wrong Call Wins / all completed hands containing a wrong call (losses and pushes included). null if none. */
  wrongWinRate: number | null;
  rightWinRate: number | null;
  /** Total EV lost over every graded mistake whose cost is known (cents), and how many mistakes had none. */
  evLostCents: number; evUnknown: number;
  /** Sum of the main-game profit on Wrong Call Wins (the "lucky" money). */
  wrongWinProfit: number;
  /** Main-game net of right-call losses (what correct play cost in bad luck). */
  rightLossAmount: number;
  mistakes: number;
  byGame: Partial<Record<GameId, Omit<QualitySummary, 'byGame'>>>;
}

function tally(hs: QHand[]): Omit<QualitySummary, 'byGame'> {
  const s = { hands: 0, wrongWins: 0, wrongLosses: 0, wrongPushes: 0, rightWins: 0, rightLosses: 0, rightPushes: 0, ungraded: 0,
    wrongHands: 0, rightHands: 0, wrongWinRate: null as number | null, rightWinRate: null as number | null,
    evLostCents: 0, evUnknown: 0, wrongWinProfit: 0, rightLossAmount: 0, mistakes: 0 };
  for (const h of hs) {
    const c = classify(h);
    s.hands++;
    for (const m of c.mistakes) { if (m.evCents === null) s.evUnknown++; else s.evLostCents += m.evCents; }
    s.mistakes += c.mistakes.length;
    if (c.call === 'ungraded') { s.ungraded++; continue; }
    if (c.call === 'wrong') {
      s.wrongHands++;
      if (c.result === 'win') { s.wrongWins++; s.wrongWinProfit += h.mainNet; } else if (c.result === 'loss') s.wrongLosses++; else s.wrongPushes++;
    } else {
      s.rightHands++;
      if (c.result === 'win') s.rightWins++; else if (c.result === 'loss') { s.rightLosses++; s.rightLossAmount += h.mainNet; } else s.rightPushes++;
    }
  }
  s.wrongWinRate = s.wrongHands ? s.wrongWins / s.wrongHands : null;
  s.rightWinRate = s.rightHands ? s.rightWins / s.rightHands : null;
  return s;
}

export function summarize(hs: QHand[]): QualitySummary {
  const byGame: QualitySummary['byGame'] = {};
  for (const g of ['uth', 'tcp', 'bj'] as GameId[]) { const x = hs.filter((h) => h.game === g); if (x.length) byGame[g] = tally(x); }
  return { ...tally(hs), byGame };
}

/** "Current session": the player's most recent run of hands with no gap longer than `gapMs` (spans tables and games). */
export function currentSession(hs: QHand[], gapMs = 60 * 60_000): QHand[] {
  const sorted = [...hs].sort((a, b) => a.at - b.at);
  let i = sorted.length - 1;
  while (i > 0 && sorted[i].at - sorted[i - 1].at <= gapMs) i--;
  return sorted.slice(Math.max(0, i));
}

export type HistoryFilter = 'all' | 'wrong-wins' | 'wrong-losses' | 'right-losses' | 'wrong' | 'ungraded';
export function matches(c: Classified, f: HistoryFilter) {
  switch (f) {
    case 'all': return true;
    case 'wrong-wins': return c.call === 'wrong' && c.result === 'win';
    case 'wrong-losses': return c.call === 'wrong' && c.result === 'loss';
    case 'right-losses': return c.call === 'right' && c.result === 'loss';
    case 'wrong': return c.call === 'wrong';
    case 'ungraded': return c.call === 'ungraded';
  }
}
