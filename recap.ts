// Table nights: a running tab while you play and a recap at the end. Everything here is derived from the
// settled hand records the server already keeps, so the numbers always match the ledger.

import { pawnFor } from './debt.js';

/** A night starts with the first hand after the table has been idle this long, or when the host starts one. */
export const NIGHT_IDLE_MS = 4 * 60 * 60 * 1000;

export interface NightHandPlayer {
  playerId: string; name: string; seat: number; hole: string[]; folded: boolean;
  net: number; outcome: string; handName: string; handRank: number;
  tripsNet: number; pairsNet: number; badBeatNet: number; progressiveNet: number;
  pairsCombo: string | null; badBeatCombo: string | null; progressiveHand: string | null;
  pairsMultiplier: number | null; badBeatMultiplier: number | null;
}
export interface NightHand {
  handId: string; handNumber: number; startedAt: number; settledAt: number; community: string[]; dealerHand: string;
  players: NightHandPlayer[];
  decisions: { playerId: string; phase: string; correct: boolean }[];
}

export interface RecapMoment {
  playerId: string; name: string; amount: number; handName: string; handId: string; handNumber: number; hole: string[]; community: string[];
}
export interface RecapPlayer {
  playerId: string; name: string; net: number; hands: number; wins: number; losses: number; pushes: number; folds: number;
  biggestWin: number; biggestLoss: number; bestHand: string | null; bestStreak: number;
  decisions: number; correct: number; debt: number;
}
export interface RecapBonus { playerId: string; name: string; bet: 'Trips+' | 'Ultimate Pairs' | 'Bad Beat' | 'Progressive'; detail: string; amount: number; handId: string; handNumber: number }
export interface NightRecap {
  nightId: string; tableName: string; startedAt: number; endedAt: number | null; lastHandAt: number | null;
  hands: number; players: RecapPlayer[];
  biggestWin: RecapMoment | null; biggestLoss: RecapMoment | null; bestHands: RecapMoment[];
  bonusHits: RecapBonus[]; fun: { label: string; text: string }[];
}

const money = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function buildRecap(
  meta: { nightId: string; tableName: string; startedAt: number; endedAt: number | null },
  hands: NightHand[], debts: Map<string, number>,
): NightRecap {
  const sorted = [...hands].sort((a, b) => a.handNumber - b.handNumber);
  const byPlayer = new Map<string, RecapPlayer & { streak: number; bestRank: number }>();
  let biggestWin: RecapMoment | null = null, biggestLoss: RecapMoment | null = null;
  const made: (RecapMoment & { rank: number })[] = [];
  const bonusHits: RecapBonus[] = [];

  for (const h of sorted) {
    for (const p of h.players) {
      let r = byPlayer.get(p.playerId);
      if (!r) {
        r = { playerId: p.playerId, name: p.name, net: 0, hands: 0, wins: 0, losses: 0, pushes: 0, folds: 0, biggestWin: 0, biggestLoss: 0,
          bestHand: null, bestStreak: 0, decisions: 0, correct: 0, debt: debts.get(p.playerId) ?? 0, streak: 0, bestRank: -1 };
        byPlayer.set(p.playerId, r);
      }
      r.name = p.name;
      r.hands++; r.net += p.net;
      if (p.folded) r.folds++;
      if (p.net > 0) { r.wins++; r.streak++; r.bestStreak = Math.max(r.bestStreak, r.streak); }
      else { r.streak = 0; if (p.net < 0) r.losses++; else r.pushes++; }
      r.biggestWin = Math.max(r.biggestWin, p.net);
      r.biggestLoss = Math.min(r.biggestLoss, p.net);
      const moment = { playerId: p.playerId, name: p.name, amount: p.net, handName: p.handName, handId: h.handId, handNumber: h.handNumber, hole: p.hole, community: h.community };
      if (p.net > 0 && (!biggestWin || p.net > biggestWin.amount)) biggestWin = moment;
      if (p.net < 0 && (!biggestLoss || p.net < biggestLoss.amount)) biggestLoss = moment;
      if (!p.folded) {
        made.push({ ...moment, rank: p.handRank });
        if (p.handRank > r.bestRank) { r.bestRank = p.handRank; r.bestHand = p.handName; }
      }
      const bonus = (bet: RecapBonus['bet'], net: number, detail: string) => {
        if (net > 0) bonusHits.push({ playerId: p.playerId, name: p.name, bet, detail, amount: net, handId: h.handId, handNumber: h.handNumber });
      };
      bonus('Trips+', p.tripsNet, p.handName);
      bonus('Ultimate Pairs', p.pairsNet, `${p.pairsCombo ?? ''}${p.pairsMultiplier ? ` ${p.pairsMultiplier}:1` : ''}`.trim());
      bonus('Bad Beat', p.badBeatNet, `${p.badBeatCombo ?? ''}${p.badBeatMultiplier ? ` ${p.badBeatMultiplier}:1` : ''}`.trim());
      bonus('Progressive', p.progressiveNet, p.progressiveHand ?? '');
    }
    for (const d of h.decisions) {
      const r = byPlayer.get(d.playerId);
      if (r) { r.decisions++; if (d.correct) r.correct++; }
    }
  }

  const players = [...byPlayer.values()].map(({ streak: _s, bestRank: _b, ...r }) => r).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  // Best made hands: by category, then the earlier hand; one entry per player per category keeps the list varied.
  const seen = new Set<string>();
  const bestHands = made.sort((a, b) => b.rank - a.rank || a.handNumber - b.handNumber)
    .filter((m) => { const k = `${m.playerId}|${m.rank}`; if (seen.has(k)) return false; seen.add(k); return m.rank >= 2; })
    .slice(0, 5).map(({ rank: _r, ...m }) => m);
  bonusHits.sort((a, b) => b.amount - a.amount);

  const fun: NightRecap['fun'] = [];
  const top = <T>(xs: T[], f: (x: T) => number) => xs.reduce<T | null>((best, x) => (best === null || f(x) > f(best) ? x : best), null);
  if (players.length) {
    const streak = top(players, (p) => p.bestStreak);
    if (streak && streak.bestStreak >= 2) fun.push({ label: 'Hottest streak', text: `${streak.name} — ${streak.bestStreak} wins in a row` });
    const folder = top(players, (p) => p.folds);
    if (folder && folder.folds >= 2) fun.push({ label: 'Most folds', text: `${folder.name} — ${folder.folds} folds. Patience is a virtue.` });
    const sharp = top(players.filter((p) => p.decisions >= 5), (p) => p.correct / p.decisions);
    if (sharp) fun.push({ label: 'Sharpest player', text: `${sharp.name} — ${Math.round((100 * sharp.correct) / sharp.decisions)}% of decisions matched basic strategy` });
    const debtor = top(players, (p) => p.debt);
    if (debtor && debtor.debt > 0) fun.push({ label: 'Deepest in debt', text: `${debtor.name} — ${money(debtor.debt)} in markers. Time to pawn ${pawnFor(debtor.debt).item}.` });
    const grinder = top(players, (p) => p.hands);
    if (grinder && players.length > 1 && grinder.hands >= 10) fun.push({ label: 'Iron chair', text: `${grinder.name} — ${grinder.hands} hands played` });
  }
  return {
    ...meta, lastHandAt: sorted.length ? sorted[sorted.length - 1].settledAt : null,
    hands: sorted.length, players, biggestWin, biggestLoss, bestHands, bonusHits: bonusHits.slice(0, 12), fun,
  };
}
