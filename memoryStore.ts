// In-memory Store with the same semantics as PgStore. Used when DATABASE_URL is not set
// (zero-config local play) and in fast engine tests. Data is lost on restart.

import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import { handNameRank, type HandName } from '../shared/evaluator.js';
import { PROGRESSIVE } from '../shared/progressive.js';
import {
  InsufficientFunds, type HandStart, type SettlementBuilder, type PlayerRow, type PlayerSettlementRow, type PlayerStats,
  type RecentHandRow, type ReplayData, type StackRow, type Store, type TableRow,
} from './store.js';

interface HP {
  playerId: string; seat: number; name: string; hole: string[]; ante: number; blind: number; trips: number; play: number;
  pairs: number; badBeat: number; progressive: number; row: PlayerSettlementRow | null;
  folded: boolean; outcome: string | null; handName: string | null; handRank: number | null; net: number | null;
  tripsNet: number | null; settlement: unknown; settled: boolean;
}
interface H {
  id: string; tableCode: string; handNumber: number; status: 'active' | 'settled' | 'voided'; deckCommitment: string;
  dealer: string[]; community: string[]; participants: number; dealerHand: string | null; dealerQualifies: boolean | null;
  startedAt: Date; settledAt: Date | null; players: HP[]; pairsVariant: string; badBeatVariant: string;
}
interface L { key: string; playerId: string; code: string; handId?: string; kind: string; amount: number; after: number }

export class MemoryStore implements Store {
  players = new Map<string, PlayerRow & { tokenHash: string }>();
  tables = new Map<string, TableRow>();
  stacks = new Map<string, StackRow>();
  hands = new Map<string, H>();
  decisions: (DecisionRecord & { handId: string; playerId: string; at: Date })[] = [];
  ledger: L[] = [];
  keys = new Set<string>();
  jackpot = PROGRESSIVE.seed;
  jackpotHits: { handId: string; playerId: string; hand: string; amount: number; meterBefore: number }[] = [];

  async init() {}
  async close() {}

  private sk = (p: string, c: string) => `${p}|${c}`;
  private post(l: L) {
    if (this.keys.has(l.key)) throw new Error('duplicate tx_key ' + l.key);
    this.keys.add(l.key);
    this.ledger.push(l);
  }

  async createPlayer(id: string, name: string, avatar: string, tokenHash: string) {
    this.players.set(id, { id, name, avatar, tokenHash });
    return { id, name, avatar };
  }
  async playerByTokenHash(hash: string) {
    for (const p of this.players.values()) if (p.tokenHash === hash) return { id: p.id, name: p.name, avatar: p.avatar };
    return null;
  }
  async updatePlayer(id: string, p: { name?: string; avatar?: string }) {
    const x = this.players.get(id);
    if (x) Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
  }

  async createTable(code: string, hostId: string, config: TableConfig) {
    if (this.tables.has(code)) throw new Error('duplicate table');
    this.tables.set(code, { code, hostId, config, handCounter: 0, closed: false });
  }
  async loadTable(code: string) { const t = this.tables.get(code); return t ? structuredClone(t) : null; }
  async updateTable(code: string, p: { config?: TableConfig; hostId?: string; closed?: boolean; handCounter?: number }) {
    const t = this.tables.get(code);
    if (!t) return;
    if (p.config) t.config = p.config;
    if (p.hostId) t.hostId = p.hostId;
    if (p.closed) t.closed = true;
    if (p.handCounter !== undefined) t.handCounter = p.handCounter;
  }

  async getStack(p: string, c: string) { const s = this.stacks.get(this.sk(p, c)); return s ? { ...s } : null; }
  async createStack(p: string, c: string, amount: number) {
    const k = this.sk(p, c);
    if (!this.stacks.has(k)) {
      this.stacks.set(k, { balance: amount, reloads: 0 });
      this.post({ key: `${c}:${p}:buyin`, playerId: p, code: c, kind: 'buyin', amount, after: amount });
    }
    return { ...this.stacks.get(k)! };
  }
  async reloadStack(p: string, c: string, amount: number) {
    const s = this.stacks.get(this.sk(p, c));
    if (!s) throw new Error('No stack');
    s.reloads++;
    this.post({ key: `${c}:${p}:reload:${s.reloads}`, playerId: p, code: c, kind: 'reload', amount: amount - s.balance, after: amount });
    s.balance = amount;
    return { ...s };
  }

  private debit(p: string, c: string, handId: string, amount: number, key: string): number | null {
    if (this.keys.has(key)) return null;
    const s = this.stacks.get(this.sk(p, c));
    if (!s || s.balance < amount) throw new InsufficientFunds('Insufficient balance');
    s.balance -= amount;
    this.post({ key, playerId: p, code: c, handId, kind: 'wager', amount: -amount, after: s.balance });
    return s.balance;
  }

  async startHand(h: HandStart) {
    const total = (p: HandStart['players'][0]) => p.ante + p.blind + p.trips + p.pairs + p.badBeat + p.progressive;
    for (const p of h.players) {
      const s = this.stacks.get(this.sk(p.playerId, h.tableCode));
      if (!s || s.balance < total(p)) throw new InsufficientFunds('Insufficient balance');
    }
    this.hands.set(h.id, {
      id: h.id, tableCode: h.tableCode, handNumber: h.handNumber, status: 'active', deckCommitment: h.deckCommitment,
      dealer: h.dealerCards, community: h.community, participants: h.players.length, dealerHand: null, dealerQualifies: null,
      startedAt: new Date(), settledAt: null, pairsVariant: h.pairsVariant, badBeatVariant: h.badBeatVariant,
      players: h.players.map((p) => ({ ...p, play: 0, folded: false, row: null, outcome: null, handName: null, handRank: null, net: null, tripsNet: null, settlement: null, settled: false })),
    });
    const t = this.tables.get(h.tableCode);
    if (t) t.handCounter = h.handNumber;
    const out = new Map<string, number>();
    for (const p of h.players) out.set(p.playerId, this.debit(p.playerId, h.tableCode, h.id, total(p), `${h.id}:${p.playerId}:initial`)!);
    this.jackpot += h.players.filter((p) => p.progressive > 0).length * PROGRESSIVE.contribution;
    return { balances: out, jackpot: this.jackpot };
  }

  async getJackpot() { return this.jackpot; }

  async wager(handId: string, p: string, c: string, amount: number, key: string) {
    const h = this.hands.get(handId);
    if (h?.status !== 'active') throw new Error('Hand is not active');
    const bal = this.debit(p, c, handId, amount, key);
    if (bal !== null) h.players.find((x) => x.playerId === p)!.play = amount;
    return bal;
  }

  async recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }) {
    if (this.decisions.some((x) => x.handId === handId && x.playerId === playerId && x.phase === d.phase)) return;
    this.decisions.push({ ...d, handId, playerId, at: new Date() });
    if (state.folded) { const hp = this.hands.get(handId)?.players.find((x) => x.playerId === playerId); if (hp) hp.folded = true; }
  }
  async updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean) {
    const d = this.decisions.find((x) => x.handId === handId && x.playerId === playerId && x.phase === phase);
    if (d) { d.evCost = evCost; d.evExact = exact; }
  }

  async settleHand(handId: string, code: string, dealer: { hand: string; qualifies: boolean }, build: SettlementBuilder) {
    const balances = new Map<string, number>();
    const h = this.hands.get(handId);
    if (!h || h.status !== 'active') return { applied: false, balances, jackpot: this.jackpot };
    const { rows, jackpotAfter, hits } = build(this.jackpot);
    this.jackpot = jackpotAfter;
    this.jackpotHits.push(...hits.map((x) => ({ ...x, handId })));
    for (const r of rows) {
      const hp = h.players.find((x) => x.playerId === r.playerId)!;
      Object.assign(hp, { outcome: r.outcome, handName: r.handName, handRank: r.handRank, net: r.net, tripsNet: r.tripsNet,
        settlement: r.settlement, play: r.play, folded: r.folded, settled: true, row: r });
      const s = this.stacks.get(this.sk(r.playerId, code))!;
      if (r.credit > 0) {
        s.balance += r.credit;
        this.post({ key: `${handId}:${r.playerId}:payout`, playerId: r.playerId, code, handId, kind: 'payout', amount: r.credit, after: s.balance });
      }
      balances.set(r.playerId, s.balance);
    }
    Object.assign(h, { status: 'settled', settledAt: new Date(), dealerHand: dealer.hand, dealerQualifies: dealer.qualifies });
    return { applied: true, balances, jackpot: this.jackpot };
  }

  async voidActiveHands() {
    let hands = 0, refunds = 0;
    for (const h of this.hands.values()) {
      if (h.status !== 'active') continue;
      hands++;
      const staked = new Map<string, number>();
      for (const l of this.ledger) if (l.handId === h.id && l.kind === 'wager') staked.set(l.playerId, (staked.get(l.playerId) ?? 0) - l.amount);
      for (const [p, amt] of staked) {
        const s = this.stacks.get(this.sk(p, h.tableCode))!;
        s.balance += amt;
        this.post({ key: `${h.id}:${p}:refund`, playerId: p, code: h.tableCode, handId: h.id, kind: 'refund', amount: amt, after: s.balance });
        refunds++;
      }
      const prog = h.players.filter((p) => p.progressive > 0).length;
      if (prog) this.jackpot = Math.max(PROGRESSIVE.seed, this.jackpot - prog * PROGRESSIVE.contribution);
      h.status = 'voided';
    }
    return { hands, refunds };
  }

  async playerStats(pid: string): Promise<PlayerStats> {
    const rows: { hp: HP; h: H }[] = [];
    for (const h of this.hands.values()) for (const hp of h.players) if (hp.playerId === pid && hp.settled) rows.push({ hp, h });
    rows.sort((a, b) => a.h.settledAt!.getTime() - b.h.settledAt!.getTime());
    const ds = this.decisions.filter((d) => d.playerId === pid);
    const nets = rows.map((r) => r.hp.net!);
    const best = rows.reduce<string | null>((b, r) => (!b || handNameRank(r.hp.handName as HandName) > handNameRank(b as HandName) ? r.hp.handName : b), null);
    const group = <K extends string>(arr: typeof ds, key: (d: (typeof ds)[0]) => K) => {
      const m = new Map<K, typeof ds>();
      for (const d of arr) { const k = key(d); m.set(k, [...(m.get(k) ?? []), d]); }
      return m;
    };
    const byPhase = [...group(ds, (d) => `${d.phase}|${d.action}`)].map(([k, v]) => ({
      phase: k.split('|')[0], action: k.split('|')[1], count: v.length, correct: v.filter((d) => d.correct).length }));
    const commonMistakes = [...group(ds.filter((d) => !d.correct), (d) => `${d.phase}|${d.action}|${d.recommended}`)]
      .map(([k, v]) => ({ phase: k.split('|')[0], action: k.split('|')[1], recommended: k.split('|')[2], count: v.length,
        evCost: v.reduce((s, d) => s + (d.evCost ?? 0), 0) }))
      .sort((a, b) => b.count - a.count).slice(0, 5);
    const tripsRows = rows.filter((r) => r.hp.trips > 0);
    let cum = 0;
    const stacks = [...this.stacks.entries()].filter(([k]) => k.startsWith(pid + '|'));
    return {
      hands: rows.length, net: nets.reduce((a, b) => a + b, 0),
      wins: rows.filter((r) => r.hp.outcome === 'win').length, losses: rows.filter((r) => r.hp.outcome === 'lose').length,
      pushes: rows.filter((r) => r.hp.outcome === 'push').length, folds: rows.filter((r) => r.hp.outcome === 'fold').length,
      biggestWin: Math.max(0, ...nets), biggestLoss: Math.min(0, ...nets), bestHand: best,
      totalWagered: rows.reduce((s, r) => s + r.hp.ante + r.hp.blind + r.hp.trips + r.hp.play, 0),
      decisions: ds.length, correctDecisions: ds.filter((d) => d.correct).length,
      evLost: ds.reduce((s, d) => s + (d.evCost ?? 0), 0),
      byPhase, commonMistakes,
      trips: { bets: tripsRows.length, wins: tripsRows.filter((r) => r.hp.tripsNet! > 0).length, net: tripsRows.reduce((s, r) => s + r.hp.tripsNet!, 0) },
      side: {
        trips: sideStats(rows.map((r) => ({ stake: r.hp.trips, net: r.hp.tripsNet ?? 0, combo: r.hp.handName }))),
        pairs: sideStats(rows.map((r) => ({ stake: r.hp.pairs, net: r.hp.row?.pairsNet ?? 0, combo: r.hp.row?.pairsCombo ?? null }))),
        badBeat: sideStats(rows.map((r) => ({ stake: r.hp.badBeat, net: r.hp.row?.badBeatNet ?? 0, combo: r.hp.row?.badBeatCombo ?? null }))),
        progressive: sideStats(rows.map((r) => ({ stake: r.hp.progressive, net: r.hp.row?.progressiveNet ?? 0, combo: r.hp.row?.progressiveHand ?? null }))),
      },
      baseNet: rows.reduce((s, r) => s + (r.hp.row?.baseNet ?? 0), 0),
      baseWagered: rows.reduce((s, r) => s + r.hp.ante + r.hp.blind + r.hp.play, 0),
      handsWithFriends: rows.filter((r) => r.h.participants > 1).length,
      reloads: stacks.reduce((s, [, v]) => s + v.reloads, 0), tables: stacks.length,
      series: rows.slice(-500).map((r) => ({ at: r.h.settledAt!.toISOString(), cumulative: (cum += r.hp.net!) })),
    };
  }

  async recentHands(code: string, limit: number): Promise<RecentHandRow[]> {
    return [...this.hands.values()].filter((h) => h.tableCode === code && h.status === 'settled')
      .sort((a, b) => b.handNumber - a.handNumber).slice(0, limit)
      .map((h) => ({
        handId: h.id, handNumber: h.handNumber, at: h.settledAt!.getTime(), dealerHand: h.dealerHand!, dealerQualifies: !!h.dealerQualifies,
        players: [...h.players].sort((a, b) => a.seat - b.seat).map((p) => {
          const hits: string[] = [];
          if ((p.tripsNet ?? 0) > 0) hits.push('Trips+');
          if ((p.row?.pairsNet ?? 0) > 0) hits.push(`Ultimate Pairs ${p.row!.pairsMultiplier}:1`);
          if ((p.row?.badBeatNet ?? 0) > 0) hits.push(`Bad Beat ${p.row!.badBeatMultiplier}:1`);
          return { name: p.name, net: p.net!, outcome: p.outcome!, handName: p.handName!, sideHits: hits };
        }),
      }));
  }

  async handReplay(handId: string): Promise<ReplayData | null> {
    const h = this.hands.get(handId);
    if (!h) return null;
    return {
      handId: h.id, tableCode: h.tableCode, handNumber: h.handNumber, status: h.status,
      startedAt: h.startedAt.toISOString(), settledAt: h.settledAt?.toISOString() ?? null,
      dealer: h.dealer, community: h.community, dealerHand: h.dealerHand, dealerQualifies: h.dealerQualifies, deckCommitment: h.deckCommitment,
      pairsVariant: h.pairsVariant, badBeatVariant: h.badBeatVariant,
      players: h.players.map((p) => ({ playerId: p.playerId, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded, ante: p.ante,
        blind: p.blind, trips: p.trips, pairs: p.pairs, badBeat: p.badBeat, progressive: p.progressive, play: p.play, net: p.net, outcome: p.outcome, handName: p.handName, settlement: p.settlement })),
      decisions: this.decisions.filter((d) => d.handId === handId).map((d) => ({ ...d, at: d.at.toISOString() })),
    };
  }

  async ledgerSum(p: string, c: string) {
    return this.ledger.filter((l) => l.playerId === p && l.code === c).reduce((s, l) => s + l.amount, 0);
  }
}

function sideStats(rows: { stake: number; net: number; combo: string | null }[]) {
  const placed = rows.filter((r) => r.stake > 0);
  const wins = placed.filter((r) => r.net > 0);
  const combos = new Map<string, number>();
  for (const w of wins) combos.set(w.combo ?? '—', (combos.get(w.combo ?? '—') ?? 0) + 1);
  return {
    bets: placed.length, wins: wins.length,
    wagered: placed.reduce((s, r) => s + r.stake, 0),
    returned: placed.reduce((s, r) => s + r.stake + r.net, 0),
    net: placed.reduce((s, r) => s + r.net, 0),
    biggestPayout: Math.max(0, ...wins.map((w) => w.net)),
    combos: [...combos].map(([combo, count]) => ({ combo, count })).sort((a, b) => b.count - a.count),
  };
}
