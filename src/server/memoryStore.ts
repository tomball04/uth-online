import type { RivalryEvent, RivalryRow } from './roast.js';
import type { QHand } from '../shared/quality.js';
// In-memory Store with the same semantics as PgStore. Used when DATABASE_URL is not set
// (zero-config local play) and in fast engine tests. Data is lost on restart.

import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import { handNameRank, type HandName } from '../shared/evaluator.js';
import { PROGRESSIVE } from '../shared/progressive.js';
import type { NightHand } from '../shared/recap.js';
import type { GameId } from '../shared/rules.js';
import type { AvatarData, PublicLook } from '../shared/cosmetics.js';
import {
  InsufficientFunds, type HandStart, type SettlementBuilder, type PlayerRow, type PlayerSettlementRow, type PlayerStats,
  type DebtEvent, type NightRow, type CosmeticState, type PurchaseResult, type RewardFacts, type StyleTx, type RecentHandRow, type ReplayData, type StackRow, type Store, type TableRow,
  toQHand,
} from './store.js';

interface HP {
  playerId: string; seat: number; name: string; hole: string[]; ante: number; blind: number; trips: number; play: number;
  pairs: number; badBeat: number; progressive: number; pairPlus: number; sixCard: number; row: PlayerSettlementRow | null;
  folded: boolean; outcome: string | null; handName: string | null; handRank: number | null; net: number | null;
  tripsNet: number | null; settlement: unknown; settled: boolean;
}
interface H {
  id: string; tableCode: string; handNumber: number; status: 'active' | 'settled' | 'voided'; deckCommitment: string;
  dealer: string[]; community: string[]; participants: number; dealerHand: string | null; dealerQualifies: boolean | null;
  startedAt: Date; settledAt: Date | null; players: HP[]; pairsVariant: string; badBeatVariant: string;
  nightId: string; rulesVersion: string; game: GameId;
}
interface L { key: string; playerId: string; code: string; handId?: string; kind: string; amount: number; after: number }

export class MemoryStore implements Store {
  players = new Map<string, PlayerRow & { tokenHash: string }>();
  tables = new Map<string, TableRow>();
  stacks = new Map<string, StackRow>();
  hands = new Map<string, H>();
  nights = new Map<string, { id: string; tableCode: string; startedAt: number; endedAt: number | null }>();
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
  async updateDealer(code: string, dealerId: string, rounds: number) { const t = this.tables.get(code); if (t) t.dealer = { dealerId, rounds }; }
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
      this.stacks.set(k, { balance: amount, reloads: 0, debt: 0 });
      this.post({ key: `${c}:${p}:buyin`, playerId: p, code: c, kind: 'buyin', amount, after: amount });
    }
    return { ...this.stacks.get(k)! };
  }
  debtLog: DebtEvent[] = [];
  private debtCode = new Map<number, string>();
  private logDebt(p: string, c: string, e: Omit<DebtEvent, 'id' | 'playerId' | 'at'>) {
    const id = this.debtLog.length + 1;
    this.debtLog.push({ id, playerId: p, at: Date.now(), ...e });
    this.debtCode.set(id, c);
  }
  async reloadStack(p: string, c: string, amount: number, pawn?: { name: string; item: string }) {
    const s = this.stacks.get(this.sk(p, c));
    if (!s) throw new Error('No stack');
    s.reloads++;
    const added = Math.max(0, amount - s.balance);
    s.debt += added;
    if (pawn && added) this.logDebt(p, c, { name: pawn.name, kind: 'marker', amount: added, debtAfter: s.debt, item: pawn.item });
    this.post({ key: `${c}:${p}:reload:${s.reloads}`, playerId: p, code: c, kind: 'reload', amount: amount - s.balance, after: amount });
    s.balance = amount;
    return { ...s };
  }

  async payDebt(p: string, c: string, amount: number, pawn: { name: string; item: (debtAfter: number) => string }) {
    const s = this.stacks.get(this.sk(p, c));
    if (!s) throw new Error('No stack');
    const paid = Math.max(0, Math.min(amount, s.debt, s.balance));
    if (!paid) return { ...s, paid: 0 };
    s.balance -= paid; s.debt -= paid;
    this.post({ key: `${c}:${p}:payoff:${this.debtLog.length + 1}`, playerId: p, code: c, kind: 'reload', amount: -paid, after: s.balance });
    this.logDebt(p, c, { name: pawn.name, kind: 'payoff', amount: paid, debtAfter: s.debt, item: pawn.item(s.debt) });
    return { ...s, paid };
  }
  async debtEvents(code: string, limit: number) {
    return this.debtLog.filter((e) => this.debtCode.get(e.id) === code).reverse().slice(0, limit);
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
    const total = (p: HandStart['players'][0]) => p.ante + p.blind + p.trips + p.pairs + p.badBeat + p.progressive + (p.pairPlus ?? 0) + (p.sixCard ?? 0);
    for (const p of h.players) {
      const s = this.stacks.get(this.sk(p.playerId, h.tableCode));
      if (!s || s.balance < total(p)) throw new InsufficientFunds('Insufficient balance');
    }
    this.hands.set(h.id, {
      id: h.id, tableCode: h.tableCode, handNumber: h.handNumber, status: 'active', deckCommitment: h.deckCommitment,
      dealer: h.dealerCards, community: h.community, participants: h.players.length, dealerHand: null, dealerQualifies: null,
      nightId: h.nightId, rulesVersion: h.rulesVersion, game: h.game ?? 'uth',
      startedAt: new Date(), settledAt: null, pairsVariant: h.pairsVariant, badBeatVariant: h.badBeatVariant,
      players: h.players.map((p) => ({ ...p, pairPlus: p.pairPlus ?? 0, sixCard: p.sixCard ?? 0, play: 0, folded: false, row: null, outcome: null, handName: null, handRank: null, net: null, tripsNet: null, settlement: null, settled: false })),
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

  async extraWager(handId: string, p: string, c: string, amount: number, key: string, totals: { extra: number; insurance: number }) {
    const h = this.hands.get(handId);
    if (h?.status !== 'active') throw new Error('Hand is not active');
    const bal = this.debit(p, c, handId, amount, key);
    if (bal !== null) { const x = h.players.find((y) => y.playerId === p) as any; x.bjExtra = totals.extra; x.bjInsurance = totals.insurance; }
    return bal;
  }
  async recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }) {
    if (this.decisions.some((x) => x.handId === handId && x.playerId === playerId && x.phase === d.phase)) return;
    this.decisions.push({ ...d, handId, playerId, at: new Date() });
    if (state.folded) { const hp = this.hands.get(handId)?.players.find((x) => x.playerId === playerId); if (hp) hp.folded = true; }
  }
  async updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean, cents?: number) {
    const d = this.decisions.find((x) => x.handId === handId && x.playerId === playerId && x.phase === phase);
    if (d) { d.evCost = evCost; d.evExact = exact; if (cents !== undefined) d.evCostCents = cents; }
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

  private rivals = new Map<string, RivalryRow>();
  async rivalries(dealerId: string, playerIds: string[]) {
    const out = new Map<string, RivalryRow>();
    for (const p of playerIds) { const r = this.rivals.get(`${dealerId}|${p}`); if (r) out.set(p, structuredClone(r)); }
    return out;
  }
  async bumpRivalry(dealerId: string, playerId: string, d: Partial<Record<'witnessed' | 'wins' | 'jackpots' | 'mockedThenWon', number>>, ev?: RivalryEvent) {
    const k = `${dealerId}|${playerId}`;
    const r = this.rivals.get(k) ?? { witnessed: 0, wins: 0, jackpots: 0, mockedThenWon: 0, events: [] };
    r.witnessed += d.witnessed ?? 0; r.wins += d.wins ?? 0; r.jackpots += d.jackpots ?? 0; r.mockedThenWon += d.mockedThenWon ?? 0;
    if (ev) { r.events.push(ev); if (r.events.length > 8) r.events.shift(); }
    this.rivals.set(k, r);
  }

  async qualityHands(pid: string, game?: GameId): Promise<QHand[]> {
    const out: QHand[] = [];
    for (const h of [...this.hands.values()].filter((x) => x.status === 'settled' && (!game || x.game === game)).sort((a, b) => a.settledAt!.getTime() - b.settledAt!.getTime())) {
      const p = h.players.find((x) => x.playerId === pid && x.settled);
      if (!p) continue;
      out.push(toQHand({
        handId: h.id, handNumber: h.handNumber, tableCode: h.tableCode, game: h.game, at: h.settledAt!.getTime(), nightId: h.nightId,
        mainNet: p.row?.baseNet ?? (p.net ?? 0) - (p.tripsNet ?? 0), totalNet: p.net ?? 0, folded: p.folded, hole: p.hole, community: h.community, dealer: h.dealer,
        ante: p.ante, settlement: p.settlement,
        decisions: this.decisions.filter((d) => d.handId === h.id && d.playerId === pid).sort((a, b) => a.at.getTime() - b.at.getTime())
          .map((d) => ({ ...d, evCents: d.evCostCents ?? null, evCost: d.evCost ?? null })),
      }));
    }
    return out;
  }

  async playerStats(pid: string, game?: GameId): Promise<PlayerStats> {
    const all: { hp: HP; h: H }[] = [];
    for (const h of this.hands.values()) for (const hp of h.players) if (hp.playerId === pid && hp.settled) all.push({ hp, h });
    all.sort((a, b) => a.h.settledAt!.getTime() - b.h.settledAt!.getTime());
    const rows = game ? all.filter((r) => r.h.game === game) : all;
    const ds = this.decisions.filter((d) => d.playerId === pid && d.graded !== false && (!game || this.hands.get(d.handId)?.game === game))
      .map((d) => ({ ...d, phase: (d.phase.startsWith('bj-') ? 'bj' : d.phase) as typeof d.phase }));
    const nets = rows.map((r) => r.hp.net!);
    const best = rows.reduce<{ name: string; rank: number } | null>((b, r) => (!b || (r.hp.handRank ?? -1) > b.rank ? { name: r.hp.handName!, rank: r.hp.handRank ?? -1 } : b), null)?.name ?? null;
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
      totalWagered: rows.reduce((s, r) => s + r.hp.ante + r.hp.blind + r.hp.trips + r.hp.play + r.hp.pairs + r.hp.badBeat + r.hp.progressive + r.hp.pairPlus + r.hp.sixCard, 0),
      decisions: ds.length, correctDecisions: ds.filter((d) => d.correct).length,
      evLost: ds.reduce((s, d) => s + (d.evCost ?? 0), 0),
      byPhase, commonMistakes,
      trips: { bets: tripsRows.length, wins: tripsRows.filter((r) => r.hp.tripsNet! > 0).length, net: tripsRows.reduce((s, r) => s + r.hp.tripsNet!, 0) },
      side: {
        trips: sideStats(rows.map((r) => ({ stake: r.hp.trips, net: r.hp.tripsNet ?? 0, combo: r.hp.handName }))),
        pairs: sideStats(rows.map((r) => ({ stake: r.hp.pairs, net: r.hp.row?.pairsNet ?? 0, combo: r.hp.row?.pairsCombo ?? null }))),
        badBeat: sideStats(rows.map((r) => ({ stake: r.hp.badBeat, net: r.hp.row?.badBeatNet ?? 0, combo: r.hp.row?.badBeatCombo ?? null }))),
        progressive: sideStats(rows.map((r) => ({ stake: r.hp.progressive, net: r.hp.row?.progressiveNet ?? 0, combo: r.hp.row?.progressiveHand ?? null }))),
        pairPlus: sideStats(rows.map((r) => ({ stake: r.hp.pairPlus, net: r.hp.row?.pairPlusNet ?? 0, combo: r.hp.row?.pairPlusHand ?? null }))),
        sixCard: sideStats(rows.map((r) => ({ stake: r.hp.sixCard, net: r.hp.row?.sixCardNet ?? 0, combo: r.hp.row?.sixCardHand ?? null }))),
      },
      game: game ?? null,
      baseNet: rows.reduce((s, r) => s + (r.hp.row?.baseNet ?? 0), 0),
      baseWagered: rows.reduce((s, r) => s + r.hp.ante + r.hp.blind + r.hp.play, 0),
      handsWithFriends: rows.filter((r) => r.h.participants > 1).length,
      reloads: stacks.reduce((s, [, v]) => s + v.reloads, 0), tables: stacks.length, debt: stacks.reduce((s, [, v]) => s + v.debt, 0),
      series: all.slice(-500).map((r) => ({ at: r.h.settledAt!.toISOString(), cumulative: (cum += r.hp.net!) })),
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
      pairsVariant: h.pairsVariant, badBeatVariant: h.badBeatVariant, rulesVersion: h.rulesVersion ?? null, game: h.game,
      players: h.players.map((p) => ({ playerId: p.playerId, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded, ante: p.ante,
        blind: p.blind, trips: p.trips, pairs: p.pairs, badBeat: p.badBeat, progressive: p.progressive, pairPlus: p.pairPlus, sixCard: p.sixCard, play: p.play, net: p.net, outcome: p.outcome, handName: p.handName, settlement: p.settlement })),
      decisions: this.decisions.filter((d) => d.handId === handId).map((d) => ({ ...d, at: d.at.toISOString() })),
    };
  }

  private nightOut(n: { id: string; tableCode: string; startedAt: number; endedAt: number | null }): NightRow {
    return { ...n, hands: [...this.hands.values()].filter((h) => h.nightId === n.id && h.status === 'settled').length };
  }
  async openNight(code: string, idleMs: number, fresh: boolean): Promise<NightRow> {
    const cur = [...this.nights.values()].find((n) => n.tableCode === code && n.endedAt === null);
    if (cur && !fresh) {
      const times = [...this.hands.values()].filter((h) => h.nightId === cur.id).map((h) => (h.settledAt ?? h.startedAt).getTime());
      const lastAt = times.length ? Math.max(...times) : cur.startedAt;
      if (Date.now() - lastAt < idleMs) return this.nightOut(cur);
    }
    if (cur) cur.endedAt = Date.now();
    const n = { id: `night-${code}-${Date.now().toString(36)}-${this.nights.size}`, tableCode: code, startedAt: Date.now(), endedAt: null };
    this.nights.set(n.id, n);
    return this.nightOut(n);
  }
  async endNight(code: string) {
    const cur = [...this.nights.values()].find((n) => n.tableCode === code && n.endedAt === null);
    if (!cur) return null;
    cur.endedAt = Date.now();
    return this.nightOut(cur);
  }
  async getNight(id: string) { const n = this.nights.get(id); return n ? this.nightOut(n) : null; }
  async listNights(code: string, limit: number) {
    return [...this.nights.values()].filter((n) => n.tableCode === code).sort((a, b) => b.startedAt - a.startedAt).slice(0, limit).map((n) => this.nightOut(n));
  }
  async nightHands(nightId: string): Promise<NightHand[]> {
    return [...this.hands.values()].filter((h) => h.nightId === nightId && h.status === 'settled').sort((a, b) => a.handNumber - b.handNumber)
      .map((h) => ({
        handId: h.id, handNumber: h.handNumber, startedAt: h.startedAt.getTime(), settledAt: h.settledAt!.getTime(), community: h.community,
        dealerHand: h.dealerHand ?? '', game: h.game,
        players: [...h.players].sort((a, b) => a.seat - b.seat).map((p) => ({
          playerId: p.playerId, name: p.name, seat: p.seat, hole: p.hole, folded: p.folded, net: p.net ?? 0, outcome: p.outcome ?? '',
          handName: p.handName ?? '', handRank: p.handRank ?? 0, tripsNet: p.tripsNet ?? 0, pairsNet: p.row?.pairsNet ?? 0,
          badBeatNet: p.row?.badBeatNet ?? 0, progressiveNet: p.row?.progressiveNet ?? 0, pairsCombo: p.row?.pairsCombo ?? null,
          badBeatCombo: p.row?.badBeatCombo ?? null, progressiveHand: p.row?.progressiveHand ?? null,
          pairsMultiplier: p.row?.pairsMultiplier ?? null, badBeatMultiplier: p.row?.badBeatMultiplier ?? null,
          pairPlusNet: p.row?.pairPlusNet ?? 0, sixCardNet: p.row?.sixCardNet ?? 0, anteBonusNet: p.row?.anteBonusNet ?? 0, sixCardHand: p.row?.sixCardHand ?? null,
        })),
        decisions: this.decisions.filter((d) => d.handId === h.id).map((d) => ({ playerId: d.playerId, phase: d.phase, correct: d.correct })),
      }));
  }

  async ledgerSummary(p: string, c: string) {
    const out: Record<string, number> = {};
    for (const l of this.ledger) if (l.playerId === p && l.code === c) out[l.kind] = (out[l.kind] ?? 0) + l.amount;
    return out;
  }

  async ledgerSum(p: string, c: string) {
    return this.ledger.filter((l) => l.playerId === p && l.code === c).reduce((s, l) => s + l.amount, 0);
  }

  // ---- §24 cosmetics (separate from stacks and the chip ledger)
  avatars = new Map<string, AvatarData>();
  wallets = new Map<string, number>();
  styleTx: (StyleTx & { key: string; playerId: string })[] = [];
  items = new Map<string, Map<string, { method: string; at: number }>>();

  async getCosmetics(pid: string): Promise<CosmeticState> {
    return {
      balance: this.wallets.get(pid) ?? 0,
      owned: [...(this.items.get(pid) ?? new Map()).entries()].map(([itemId, v]) => ({ itemId, method: v.method, at: v.at })),
      avatar: this.avatars.has(pid) ? structuredClone(this.avatars.get(pid)!) : null,
      rewards: this.styleTx.filter((t) => t.playerId === pid && t.rewardId).map((t) => ({ rewardId: t.rewardId!, at: t.at })),
    };
  }
  async saveAvatar(pid: string, data: AvatarData) { this.avatars.set(pid, structuredClone(data)); }
  async publicLooks(ids: string[]) {
    const m = new Map<string, PublicLook>();
    for (const id of ids) { const a = this.avatars.get(id); if (a) m.set(id, { appearance: a.appearance, equipped: a.equipped }); }
    return m;
  }
  private own(pid: string, itemId: string, method: string) {
    let m = this.items.get(pid);
    if (!m) this.items.set(pid, (m = new Map()));
    if (!m.has(itemId)) m.set(itemId, { method, at: Date.now() });
  }
  async grant(pid: string, g: { key: string; rewardId: string | null; amount: number; items: string[]; method: 'reward' | 'collection'; note: string }) {
    const bal = this.wallets.get(pid) ?? 0;
    if (this.styleTx.some((t) => t.key === g.key)) return { applied: false, balance: bal };
    if (g.amount < 0) throw new Error('grant amount must be >= 0');
    const after = bal + g.amount;
    this.wallets.set(pid, after);
    this.styleTx.push({ id: this.styleTx.length + 1, key: g.key, playerId: pid, kind: 'earn', amount: g.amount, balanceAfter: after, itemId: g.items[0] ?? null, rewardId: g.rewardId, note: g.note, at: Date.now() });
    for (const it of g.items) this.own(pid, it, g.method);
    return { applied: true, balance: after };
  }
  async purchase(pid: string, itemId: string, price: number, key: string, note: string): Promise<PurchaseResult> {
    const bal = this.wallets.get(pid) ?? 0;
    if (this.styleTx.some((t) => t.key === key)) return { status: 'duplicate', balance: bal };
    if (this.items.get(pid)?.has(itemId)) return { status: 'owned', balance: bal };
    if (!Number.isInteger(price) || price < 0) throw new Error('bad price');
    if (bal < price) return { status: 'insufficient', balance: bal };
    const after = bal - price;
    this.wallets.set(pid, after);
    this.styleTx.push({ id: this.styleTx.length + 1, key, playerId: pid, kind: 'purchase', amount: -price, balanceAfter: after, itemId, rewardId: null, note, at: Date.now() });
    this.own(pid, itemId, 'purchase');
    return { status: 'ok', balance: after };
  }
  async styleHistory(pid: string, limit: number) {
    return this.styleTx.filter((t) => t.playerId === pid).reverse().slice(0, limit).map(({ key: _k, playerId: _p, ...t }) => t);
  }
  async rewardFacts(pid: string, nightId: string | null): Promise<RewardFacts> {
    const mine = [...this.hands.values()].filter((h) => h.status === 'settled' && h.players.some((p) => p.playerId === pid && p.settled));
    const ds = this.decisions.filter((d) => d.playerId === pid);
    return {
      hands: mine.length, games: [...new Set(mine.map((h) => h.game))],
      friendHands: mine.filter((h) => h.participants > 1).length,
      nights: new Set(mine.map((h) => h.nightId).filter(Boolean)).size,
      nightHands: nightId ? mine.filter((h) => h.nightId === nightId).length : 0,
      decisions: ds.length, correct: ds.filter((d) => d.correct).length,
    };
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
