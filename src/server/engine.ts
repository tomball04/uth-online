// TableEngine: the single source of truth for one table. Every mutation runs through a per-table
// async mutex, so concurrent socket messages can never interleave a half-applied state change.
// Money moves only through the Store (ledger, transactions). The engine mirrors balances in memory
// for fast validation and always replaces them with the Store's returned values.

import { intToCard } from '../shared/cards.js';
import { bestFive, evaluate, handName, handNameRank } from '../shared/evaluator.js';
import type {
  ChatMessage, DecisionRecord, HandSummary, Phase, SeatResult, SeatView, TableConfig, TableView,
} from '../shared/protocol.js';
import {
  LEGAL_DECISIONS, NO_BETS, PLAY_MULTIPLIER, TIMEOUT_DEFAULT, decisionLabel, formatMoney, requiredToStart, sideTotal,
  dealerQualifies, settle, validateInitialBet, type Decision, type DecisionPhase, type InitialBets, type Settlement,
} from '../shared/rules.js';
import { advise, mistakeCost, outsFor } from '../shared/strategy.js';
import { PROGRESSIVE, progressiveHand, resolveProgressive, type ProgressiveEntry, type ProgressiveResolution } from '../shared/progressive.js';
import {
  BAD_BEAT_VARIANTS, DEFAULT_BAD_BEAT_VARIANT, DEFAULT_PAIRS_VARIANT, PAIRS_VARIANTS, isBadBeatVariant, isPairsVariant,
} from '../shared/sidebets.js';

/** Configs saved before side bets existed get the default pay tables and the Trips+ limit. */
export function withSideBetDefaults(c: TableConfig): TableConfig {
  return {
    ...c,
    maxPairs: c.maxPairs ?? c.maxTrips ?? 2_500,
    maxBadBeat: c.maxBadBeat ?? c.maxTrips ?? 2_500,
    pairsVariant: isPairsVariant(c.pairsVariant) ? c.pairsVariant : DEFAULT_PAIRS_VARIANT,
    badBeatVariant: isBadBeatVariant(c.badBeatVariant) ? c.badBeatVariant : DEFAULT_BAD_BEAT_VARIANT,
    progressive: c.progressive !== false,
    felt: isFelt(c.felt) ? c.felt : DEFAULT_FELT,
    cardBack: isBack(c.cardBack) ? c.cardBack : DEFAULT_BACK,
  };
}
import { newId, sha256 } from './rng.js';
import { debtLine } from '../shared/debt.js';
import { BACKS, DEFAULT_BACK, DEFAULT_FELT, FELTS, isBack, isFelt } from '../shared/themes.js';
import type { PlayerRow, Store } from './store.js';

export interface Timing {
  dealMs: number;       // time allotted to the deal animation before the decision clock starts
  revealMs: number;     // pause on each community reveal when nobody needs to act
  resultsMs: number;    // how long results stay on the table before the next betting round
  graceMs: number;      // seat reservation after a disconnect
}

export const DEFAULT_TIMING: Timing = { dealMs: 2600, revealMs: 1600, resultsMs: 7000, graceMs: 120_000 };

export interface EngineHooks {
  changed(): void;
  chat(m: ChatMessage): void;
  analysis(playerId: string, payload: { handId: string; decisions: DecisionRecord[] }): void;
  kicked(playerId: string, reason: string): void;
  closed(reason: string): void;
  jackpot(amount: number): void;
  jackpotHit(p: { tableName: string; playerName: string; hand: string; amount: number }): void;
  jackpotAmount(): number;
}

interface Seat {
  seat: number; playerId: string; name: string; avatar: string; balance: number; reloads: number; debt: number;
  connected: boolean; disconnectedAt: number | null;
  pending: InitialBets; ready: boolean; lastBet: InitialBets | null;
  sitOut: boolean; timeoutPolicy: 'default' | 'strategy'; leaving: boolean;
  standingUp: boolean; awayByHost: boolean;
  seen: string[];
}

interface HandPlayer {
  playerId: string; seat: number; name: string; hole: number[];
  ante: number; blind: number; trips: number; pairs: number; badBeat: number; progressive: number; play: number; folded: boolean;
  acted: boolean; lastAction?: Decision; decisions: DecisionRecord[];
  settlement?: Settlement; best5?: number[];
}

interface Hand {
  id: string; number: number; dealer: number[]; community: number[]; revealed: number;
  players: Map<string, HandPlayer>; settled: boolean; dealerScore?: number;
}

export class EngineError extends Error {}

const DECISION_PHASES: Phase[] = ['preflop', 'flop', 'river'];

export class TableEngine {
  phase: Phase = 'waiting';
  seats: (Seat | null)[];
  spectators = new Map<string, { name: string }>();
  hand: Hand | null = null;
  deadline: number | null = null;
  seq = 0;
  closing = false;
  closed = false;
  banned = new Set<string>();
  recent: HandSummary[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public code: string,
    public config: TableConfig,
    public hostId: string,
    public handCounter: number,
    private store: Store,
    private hooks: EngineHooks,
    private shuffle: () => number[],
    private timing: Timing = DEFAULT_TIMING,
    private now: () => number = Date.now,
  ) {
    this.config = withSideBetDefaults(config);
    this.seats = Array(6).fill(null);
    this.sweepTimer = setInterval(() => this.run(() => this.sweep()).catch(() => {}), Math.min(5000, timing.graceMs / 2));
    this.sweepTimer.unref?.();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    clearInterval(this.sweepTimer);
  }

  /** Serialize every state change for this table. */
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p.finally(() => { this.seq++; this.hooks.changed(); });
  }

  // ------------------------------------------------------------------ helpers
  seatOf(pid: string): Seat | null { return this.seats.find((s) => s?.playerId === pid) ?? null; }
  seatedCount() { return this.seats.filter(Boolean).length; }
  private hp(pid: string) { return this.hand?.players.get(pid) ?? null; }
  private inActiveHand(pid: string) { return !!this.hand && !this.hand.settled && this.hand.players.has(pid); }
  private dedupe(s: Seat, actionId: string): boolean {
    if (typeof actionId !== 'string' || actionId.length < 8 || actionId.length > 64) throw new EngineError('Invalid action id.');
    if (s.seen.includes(actionId)) return true;
    s.seen.push(actionId);
    if (s.seen.length > 100) s.seen.shift();
    return false;
  }
  private say(text: string, kind: 'dealer' | 'system' = 'dealer') {
    this.hooks.chat({ id: newId(), at: this.now(), kind, name: kind === 'dealer' ? 'Dealer' : undefined, text });
  }
  private setTimer(ms: number, fn: () => Promise<void> | void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.run(fn).catch((e) => console.error('[engine timer]', e)); }, Math.max(0, ms));
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.deadline = null; }
  private limits() {
    const c = this.config;
    return { minAnte: c.minAnte, maxAnte: c.maxAnte, maxTrips: c.maxTrips, maxPairs: c.maxPairs, maxBadBeat: c.maxBadBeat,
      pairsVariant: c.pairsVariant, badBeatVariant: c.badBeatVariant, progressiveEnabled: c.progressive };
  }
  private needsToAct(h: HandPlayer) {
    return DECISION_PHASES.includes(this.phase) && !h.folded && h.play === 0 && !h.acted;
  }

  // ------------------------------------------------------------------ seating
  async sit(player: PlayerRow, wanted?: number): Promise<number> {
    if (this.closed || this.closing) throw new EngineError('This table is closing.');
    if (this.banned.has(player.id)) throw new EngineError('You were removed from this table.');
    const existing = this.seatOf(player.id);
    if (existing) { existing.connected = true; existing.disconnectedAt = null; return existing.seat; }
    let idx = wanted ?? -1;
    if (idx >= 0) {
      if (!Number.isInteger(idx) || idx >= this.config.maxSeats) throw new EngineError('Invalid seat.');
      if (this.seats[idx]) throw new EngineError('That seat is taken.');
    } else {
      idx = this.seats.findIndex((s, i) => !s && i < this.config.maxSeats);
      if (idx < 0) throw new EngineError('The table is full.');
    }
    const stack = (await this.store.getStack(player.id, this.code)) ?? (await this.store.createStack(player.id, this.code, this.config.startingBankroll));
    // Re-check after the await (another sit may have raced for this seat).
    if (this.seats[idx] || this.seatOf(player.id)) throw new EngineError('That seat is taken.');
    this.spectators.delete(player.id);
    this.seats[idx] = {
      seat: idx, playerId: player.id, name: player.name, avatar: player.avatar, balance: stack.balance, reloads: stack.reloads, debt: stack.debt ?? 0,
      connected: true, disconnectedAt: null, pending: { ...NO_BETS }, ready: false, lastBet: null,
      sitOut: false, timeoutPolicy: 'default', leaving: false, standingUp: false, awayByHost: false, seen: [],
    };
    if (!this.seatOf(this.hostId)) this.hostId = player.id;
    this.say(`${player.name} takes seat ${idx + 1}.`, 'system');
    if (this.phase === 'waiting') this.phase = 'betting';
    return idx;
  }

  addSpectator(player: PlayerRow) {
    if (!this.config.allowSpectators && !this.seatOf(player.id)) throw new EngineError('Spectators are not allowed at this table.');
    if (this.banned.has(player.id)) throw new EngineError('You were removed from this table.');
    if (!this.seatOf(player.id)) this.spectators.set(player.id, { name: player.name });
  }
  removeSpectator(pid: string) { this.spectators.delete(pid); }

  async leave(pid: string) {
    const s = this.seatOf(pid);
    if (!s) { this.spectators.delete(pid); return; }
    if (this.inActiveHand(pid)) {
      s.leaving = true;
      await this.autoActForAbsent();
      await this.maybeAdvance();
      return;
    }
    this.removeSeat(s, `${s.name} leaves the table.`);
  }

  private removeSeat(s: Seat, msg: string) {
    this.seats[s.seat] = null;
    this.say(msg, 'system');
    if (this.hostId === s.playerId) {
      const next = this.seats.find(Boolean);
      if (next) { this.hostId = next.playerId; this.store.updateTable(this.code, { hostId: next.playerId }).catch(() => {}); this.say(`${next.name} is now the host.`, 'system'); }
    }
    if (!this.seatedCount() && !this.hand) { this.phase = 'waiting'; this.clearTimer(); }
    else if (this.phase === 'betting') this.checkStart();
  }

  /** Seat → rail. The stack stays in the database, so sitting down again restores it. */
  private standUpNow(s: Seat) {
    this.spectators.set(s.playerId, { name: s.name });
    this.removeSeat(s, `${s.name} was moved to the spectators by the host.`);
  }

  setConnected(pid: string, connected: boolean) {
    const s = this.seatOf(pid);
    if (!s) return;
    s.connected = connected;
    s.disconnectedAt = connected ? null : this.now();
    if (!connected) this.say(`${s.name} disconnected — seat reserved.`, 'system');
  }

  private sweep() {
    for (const s of this.seats) {
      if (s && !s.connected && s.disconnectedAt && this.now() - s.disconnectedAt > this.timing.graceMs && !this.inActiveHand(s.playerId))
        this.removeSeat(s, `${s.name}'s seat was released after disconnecting.`);
    }
  }

  // ------------------------------------------------------------------ betting
  async placeBet(pid: string, actionId: string, bets: InitialBets) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    if (this.phase !== 'betting') throw new EngineError('Bets can only be placed between hands.');
    const err = validateInitialBet(bets, s.balance, this.limits());
    if (err) throw new EngineError(err);
    s.pending = { ante: bets.ante, trips: bets.trips, pairs: bets.pairs, badBeat: bets.badBeat, progressive: bets.progressive };
    s.ready = false;
    this.checkStart();
  }

  async clearBet(pid: string, actionId: string) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    if (this.phase !== 'betting') throw new EngineError('Bets are locked during a hand.');
    s.pending = { ...NO_BETS };
    s.ready = false;
    this.checkStart();
  }

  async setReady(pid: string, actionId: string, ready: boolean) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    if (this.phase !== 'betting') throw new EngineError('Not in the betting phase.');
    if (ready) {
      const err = validateInitialBet(s.pending, s.balance, this.limits());
      if (err) throw new EngineError(s.pending.ante ? err : 'Place an Ante first.');
      if (s.sitOut) this.say(`${s.name} is back.`, 'system');
      s.sitOut = false; s.awayByHost = false;
    }
    s.ready = ready;
    await this.checkStart();
  }

  private requireSeat(pid: string): Seat {
    const s = this.seatOf(pid);
    if (!s) throw new EngineError('You are not seated at this table.');
    return s;
  }

  /** Deal when every active seat is ready; otherwise run the betting countdown once someone is. */
  private async checkStart() {
    if (this.phase !== 'betting' || this.closing) return;
    const active = this.seats.filter((s): s is Seat => !!s && !s.sitOut && !s.leaving);
    const ready = active.filter((s) => s.ready);
    if (!ready.length) { this.clearTimer(); return; }
    if (ready.length === active.filter((s) => s.connected || s.ready).length) {
      this.clearTimer();
      await this.deal();
      return;
    }
    if (!this.timer) {
      this.deadline = this.now() + this.config.bettingSeconds * 1000;
      this.setTimer(this.config.bettingSeconds * 1000, () => this.deal());
    }
  }

  // ------------------------------------------------------------------ dealing
  private async deal() {
    if (this.phase !== 'betting') return;
    this.clearTimer();
    const players = this.seats.filter((s): s is Seat => !!s && s.ready && !s.leaving &&
      !validateInitialBet(s.pending, s.balance, this.limits()));
    if (!players.length) return;

    const deck = this.shuffle();
    if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('Corrupt deck');
    let i = 0;
    const holes = new Map<string, number[]>();
    for (const s of players) holes.set(s.playerId, [deck[i++]]);
    const dealer = [deck[i++]];
    for (const s of players) holes.get(s.playerId)!.push(deck[i++]);
    dealer.push(deck[i++]);
    i++; // burn
    const community = [deck[i++], deck[i++], deck[i++]];
    i++; // burn
    community.push(deck[i++]);
    i++; // burn
    community.push(deck[i++]);

    const id = newId();
    const number = this.handCounter + 1;
    const { balances, jackpot } = await this.store.startHand({
      id, tableCode: this.code, handNumber: number,
      deckCommitment: sha256(deck.map(intToCard).join('') + ':' + id),
      dealerCards: dealer.map(intToCard), community: community.map(intToCard),
      pairsVariant: this.config.pairsVariant, badBeatVariant: this.config.badBeatVariant,
      players: players.map((s) => ({ playerId: s.playerId, seat: s.seat, name: s.name, hole: holes.get(s.playerId)!.map(intToCard),
        ante: s.pending.ante, blind: s.pending.ante, trips: s.pending.trips, pairs: s.pending.pairs, badBeat: s.pending.badBeat,
        progressive: s.pending.progressive })),
    });
    this.hooks.jackpot(jackpot);
    this.handCounter = number;
    const map = new Map<string, HandPlayer>();
    for (const s of players) {
      s.balance = balances.get(s.playerId)!;
      s.lastBet = { ...s.pending };
      map.set(s.playerId, { playerId: s.playerId, seat: s.seat, name: s.name, hole: holes.get(s.playerId)!,
        ante: s.pending.ante, blind: s.pending.ante, trips: s.pending.trips, pairs: s.pending.pairs, badBeat: s.pending.badBeat,
        progressive: s.pending.progressive, play: 0, folded: false, acted: false, decisions: [] });
    }
    this.hand = { id, number, dealer, community, revealed: 0, players: map, settled: false };
    for (const s of this.seats) if (s) { s.ready = false; }
    this.phase = 'preflop';
    this.say(`Hand #${number}. Cards are out — ${players.length} player${players.length > 1 ? 's' : ''} in. Check or play 3x / 4x.`);
    await this.startDecisionClock(this.timing.dealMs);
  }

  private async startDecisionClock(extraMs: number) {
    await this.autoActForAbsent();
    const anyone = [...this.hand!.players.values()].some((h) => this.needsToAct(h));
    if (!anyone) {
      this.deadline = null;
      this.setTimer(extraMs, () => this.advance());
      return;
    }
    if (this.config.decisionSeconds > 0) {
      const ms = extraMs + this.config.decisionSeconds * 1000;
      this.deadline = this.now() + ms;
      this.setTimer(ms, () => this.onTimeout());
    } else {
      this.deadline = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Players who left or were kicked mid-hand act immediately with the timeout default. */
  private async autoActForAbsent() {
    if (!this.hand || !DECISION_PHASES.includes(this.phase)) return;
    for (const h of this.hand.players.values()) {
      const s = this.seats[h.seat];
      if (this.needsToAct(h) && (!s || s.leaving)) await this.applyDecision(h, TIMEOUT_DEFAULT[this.phase as DecisionPhase], true);
    }
  }

  // ------------------------------------------------------------------ decisions
  legalFor(pid: string): Decision[] {
    const h = this.hp(pid);
    if (!h || !this.needsToAct(h)) return [];
    const s = this.seats[h.seat];
    const bal = s?.balance ?? 0;
    return LEGAL_DECISIONS[this.phase as DecisionPhase].filter((d) => {
      const m = PLAY_MULTIPLIER[d];
      return !m || m * h.ante <= bal;
    });
  }

  async decide(pid: string, actionId: string, handId: string, phase: DecisionPhase, decision: Decision) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    const h = this.hp(pid);
    if (!this.hand || this.hand.id !== handId || !h) throw new EngineError('That hand is no longer active.');
    if (this.phase !== phase) throw new EngineError(`Stale action: the table is on the ${this.phase}, not the ${phase}.`);
    if (!this.legalFor(pid).includes(decision)) throw new EngineError(`${decisionLabel(decision) ?? 'That action'} is not allowed now.`);
    await this.applyDecision(h, decision, false);
    await this.maybeAdvance();
  }

  private async applyDecision(h: HandPlayer, decision: Decision, timedOut: boolean) {
    const phase = this.phase as DecisionPhase;
    const hand = this.hand!;
    const community = hand.community.slice(0, hand.revealed);
    const rec = advise(phase, h.hole, community);
    const mult = PLAY_MULTIPLIER[decision];
    h.acted = true;
    h.lastAction = decision;
    if (mult) {
      const amt = h.ante * mult;
      const bal = await this.store.wager(hand.id, h.playerId, this.code, amt, `${hand.id}:${h.playerId}:play`);
      h.play = amt;
      const s = this.seats[h.seat];
      if (s && bal !== null) s.balance = bal;
    }
    if (decision === 'fold') h.folded = true;
    const record: DecisionRecord = { phase, action: decision, recommended: rec.action, correct: rec.action === decision, reason: rec.reason, timedOut,
      outs: outsFor(phase, h.hole, community) };
    h.decisions.push(record);
    await this.store.recordDecision(hand.id, h.playerId, record, { play: h.play, folded: h.folded });
    if (mult) this.say(`${h.name} plays ${mult}x (${formatMoney(h.ante * mult)}).${timedOut ? ' (auto)' : ''}`);
    else if (timedOut) this.say(`${h.name} timed out — ${decision === 'fold' ? 'folds' : 'checks'}.`, 'system');
    else if (decision === 'fold') this.say(`${h.name} folds.`);
  }

  private async onTimeout() {
    if (!this.hand || !DECISION_PHASES.includes(this.phase)) return;
    for (const h of this.hand.players.values()) {
      if (!this.needsToAct(h)) continue;
      const s = this.seats[h.seat];
      let d = TIMEOUT_DEFAULT[this.phase as DecisionPhase];
      if (s?.timeoutPolicy === 'strategy') {
        const rec = advise(this.phase as DecisionPhase, h.hole, this.hand.community.slice(0, this.hand.revealed)).action;
        if (this.legalFor(h.playerId).includes(rec)) d = rec;
      }
      await this.applyDecision(h, d, true);
    }
    await this.advance();
  }

  private async maybeAdvance() {
    if (!this.hand || !DECISION_PHASES.includes(this.phase)) return;
    if ([...this.hand.players.values()].some((h) => this.needsToAct(h))) return;
    this.clearTimer();
    await this.advance();
  }

  private async advance() {
    const hand = this.hand;
    if (!hand || hand.settled) return;
    for (const h of hand.players.values()) h.acted = false;
    if (this.phase === 'preflop') {
      this.phase = 'flop';
      hand.revealed = 3;
      this.say('The flop. Check or play 2x.');
      await this.startDecisionClock(this.timing.revealMs);
    } else if (this.phase === 'flop') {
      this.phase = 'river';
      hand.revealed = 5;
      this.say('Turn and river. Play 1x or fold.');
      await this.startDecisionClock(this.timing.revealMs);
    } else if (this.phase === 'river') {
      await this.showdown();
    }
  }

  // ------------------------------------------------------------------ settlement
  private async showdown() {
    const hand = this.hand!;
    this.clearTimer();
    this.phase = 'showdown';
    const dealerScore = evaluate([...hand.dealer, ...hand.community]);
    hand.dealerScore = dealerScore;
    const players = [...hand.players.values()];
    const dealerName = handName(dealerScore);
    const qualifies = dealerQualifies(dealerScore);
    // Progressive: the hand is decided by hole cards + flop; the award is resolved against the live meter
    // inside the settlement transaction, so two tables can never both take the same jackpot.
    const entries: ProgressiveEntry[] = players.filter((h) => h.progressive > 0)
      .map((h) => ({ playerId: h.playerId, seat: h.seat, hand: progressiveHand(h.hole, hand.community) }));
    let resolution: ProgressiveResolution | null = null;
    const build = (meter: number) => {
      resolution = resolveProgressive(entries, meter);
      const rows = players.map((h) => {
        const playerScore = evaluate([...h.hole, ...hand.community]);
        const st = settle({
          ante: h.ante, blind: h.blind, play: h.play, trips: h.trips, pairs: h.pairs, badBeat: h.badBeat, folded: h.folded,
          playerScore, dealerScore, playerHole: h.hole, dealerHole: hand.dealer,
          pairsVariant: this.config.pairsVariant, badBeatVariant: this.config.badBeatVariant,
          progressive: h.progressive, progressiveAward: resolution!.awards.get(h.playerId) ?? null,
        });
        h.settlement = st;
        h.best5 = bestFive([...h.hole, ...hand.community]);
        return {
          playerId: h.playerId, credit: st.totalCredit, net: st.net, outcome: st.outcome, handName: st.playerHand,
          handRank: handNameRank(st.playerHand), tripsNet: st.trips.net, play: h.play, folded: h.folded, settlement: st,
          pairsNet: st.pairs.net, badBeatNet: st.badBeat.net, pairsCombo: st.pairs.combo ?? null, badBeatCombo: st.badBeat.combo ?? null,
          pairsMultiplier: st.pairs.multiplier ?? null, badBeatMultiplier: st.badBeat.multiplier ?? null,
          pairsVariant: h.pairs ? this.config.pairsVariant : null, badBeatVariant: h.badBeat ? this.config.badBeatVariant : null,
          baseNet: st.baseNet, progressiveNet: st.progressive.net,
          progressiveHand: h.progressive ? (resolution!.awards.get(h.playerId)?.envy && !resolution!.awards.get(h.playerId)?.base ? 'Envy bonus' : st.progressive.combo ?? null) : null,
        };
      });
      return { rows, jackpotAfter: resolution.meterAfter, hits: resolution.hits.map((x) => ({ ...x, hand: x.hand as string })) };
    };
    const res = await this.store.settleHand(hand.id, this.code, { hand: dealerName, qualifies }, build);
    if (!res.applied) console.warn(`[engine] hand ${hand.id} was already settled — skipping payout`);
    this.hooks.jackpot(res.jackpot);
    const hitList = (resolution as ProgressiveResolution | null)?.hits ?? [];
    for (const hit of hitList) {
      const who = hand.players.get(hit.playerId)!.name;
      this.hooks.jackpotHit({ tableName: this.config.name, playerName: who, hand: hit.hand, amount: hit.amount });
    }
    for (const [pid, bal] of res.balances) { const s = this.seatOf(pid); if (s) s.balance = bal; }
    hand.settled = true;
    this.phase = 'settled';

    const parts = [...hand.players.values()].map((h) => `${h.name} ${formatMoney(h.settlement!.net, { sign: true })}`);
    this.say(`Dealer has ${dealerName}${qualifies ? '' : ' — does not qualify (Ante pushes)'}. ${parts.join(' · ')}`);
    for (const hit of hitList)
      this.say(`${hit.hand === 'Royal Flush' ? 'JACKPOT! ' : ''}${hand.players.get(hit.playerId)!.name} hits a ${hit.hand} on the progressive — ${formatMoney(hit.amount)}.`);
    for (const h of hand.players.values()) {
      const st = h.settlement!;
      if (st.progressive.result === 'win' && !hitList.some((x) => x.playerId === h.playerId))
        this.say(`${h.name}: Progressive — ${st.progressive.note} (${formatMoney(st.progressive.credit)}).`);
      if (st.pairs.result === 'win')
        this.say(`${h.name}: Ultimate Pairs — ${st.pairs.combo} — ${st.pairs.multiplier!.toLocaleString('en-US')}:1 (${formatMoney(st.pairs.net, { sign: true })}).`);
      if (st.badBeat.result === 'win') {
        const who = st.badBeat.combo!.startsWith('Dealer') ? 'Dealer’s' : `${h.name}’s`;
        const hn = st.badBeat.combo!.replace(/^(Dealer|Player) /, '');
        this.say(`Bad Beat! ${who} ${hn} beaten — ${st.badBeat.multiplier!.toLocaleString('en-US')}:1 for ${h.name} (${formatMoney(st.badBeat.net, { sign: true })}).`);
      }
    }
    this.recent.unshift({
      handId: hand.id, handNumber: hand.number, at: this.now(), dealerHand: dealerName, dealerQualifies: qualifies,
      players: [...hand.players.values()].sort((a, b) => a.seat - b.seat)
        .map((h) => ({ name: h.name, net: h.settlement!.net, outcome: h.settlement!.outcome,
          handName: h.settlement!.playerHand, sideHits: sideHits(h.settlement!) })),
    });
    this.recent = this.recent.slice(0, 15);
    this.scheduleAnalysis(hand);
    this.setTimer(this.timing.resultsMs, () => this.nextRound());
  }

  /** Price every mistake (exact on the river, estimated pre-flop/flop) off the hot path. */
  private scheduleAnalysis(hand: Hand) {
    setImmediate(async () => {
      for (const h of hand.players.values()) {
        for (const d of h.decisions) {
          if (d.correct) continue;
          const community = hand.community.slice(0, d.phase === 'preflop' ? 0 : d.phase === 'flop' ? 3 : 5);
          const m = mistakeCost(d.phase, h.hole, community, d.action);
          if (m) {
            d.evCost = +m.cost.toFixed(4);
            d.evExact = m.exact;
            d.evCostCents = Math.round(m.cost * h.ante);
            await this.store.updateDecisionEV(hand.id, h.playerId, d.phase, d.evCost, m.exact).catch(() => {});
          }
          await new Promise((r) => setImmediate(r));
        }
        this.hooks.analysis(h.playerId, { handId: hand.id, decisions: h.decisions });
      }
    });
  }

  private async nextRound() {
    if (this.phase !== 'settled') return;
    this.store.recentHands(this.code, 15).then((r) => { this.recent = r; }).catch(() => {});
    this.hand = null;
    for (const s of [...this.seats]) {
      if (!s) continue;
      s.pending = { ...NO_BETS };
      s.ready = false;
      if (s.leaving || (!s.connected && s.disconnectedAt && this.now() - s.disconnectedAt > this.timing.graceMs))
        this.removeSeat(s, `${s.name} leaves the table.`);
      else if (s.standingUp) this.standUpNow(s);
    }
    if (this.closing) { await this.doClose('The host closed the table.'); return; }
    this.phase = this.seatedCount() ? 'betting' : 'waiting';
    this.deadline = null;
  }

  // ------------------------------------------------------------------ misc player actions
  async reload(pid: string) {
    const s = this.requireSeat(pid);
    if (this.inActiveHand(pid)) throw new EngineError('You can reload between hands.');
    if (requiredToStart(this.config.minAnte) <= s.balance) throw new EngineError('You can reload once your stack can no longer cover a minimum hand.');
    const st = await this.store.reloadStack(pid, this.code, this.config.startingBankroll);
    const borrowed = st.debt - s.debt;
    s.balance = st.balance;
    s.reloads = st.reloads;
    s.debt = st.debt;
    s.pending = { ...NO_BETS };
    // Just for fun: the dealer keeps a running tab and suggests something to pawn.
    const out = { balance: st.balance, debt: st.debt };
    this.say(borrowed > 0 ? debtLine(s.name, borrowed, st.debt, st.reloads) : `${s.name} reloads to ${formatMoney(st.balance)} in virtual chips.`);
    return out;
  }

  async setPrefs(pid: string, p: { timeoutPolicy?: 'default' | 'strategy'; sitOut?: boolean }) {
    const s = this.requireSeat(pid);
    if (p.timeoutPolicy === 'default' || p.timeoutPolicy === 'strategy') s.timeoutPolicy = p.timeoutPolicy;
    if (typeof p.sitOut === 'boolean') {
      s.sitOut = p.sitOut; s.awayByHost = false;
      if (p.sitOut) { s.ready = false; s.pending = { ...NO_BETS }; }
      this.say(p.sitOut ? `${s.name} is sitting out.` : `${s.name} is back.`, 'system');
      await this.checkStart();
    }
  }

  // ------------------------------------------------------------------ host controls (no access to cards/outcomes)
  private requireHost(pid: string) { if (pid !== this.hostId) throw new EngineError('Only the host can do that.'); }

  async kick(hostId: string, target: string) {
    this.requireHost(hostId);
    if (target === hostId) throw new EngineError('You cannot remove yourself.');
    const s = this.seatOf(target);
    this.banned.add(target);
    this.spectators.delete(target);
    this.hooks.kicked(target, 'The host removed you from the table.');
    if (s) {
      if (this.inActiveHand(target)) { s.leaving = true; await this.autoActForAbsent(); await this.maybeAdvance(); }
      else this.removeSeat(s, `${s.name} was removed by the host.`);
    }
  }

  /** Host sets a player away (sitting out) or back. The current hand is unaffected; it applies from the next deal. */
  async setAway(hostId: string, target: string, away: boolean) {
    this.requireHost(hostId);
    const s = this.seatOf(target);
    if (!s) throw new EngineError('That player is not seated.');
    if (s.sitOut === away) return;
    s.sitOut = away; s.awayByHost = away;
    if (away) { s.ready = false; s.pending = { ...NO_BETS }; }
    const live = this.inActiveHand(target) ? ' after this hand' : '';
    this.say(away ? `The host set ${s.name} away${live}. They can come back from Settings → Sit out, or the “I’m back” button.` : `The host brought ${s.name} back in.`, 'system');
    await this.checkStart();
  }

  /** Host moves a player to the spectators. Mid-hand, they finish the hand first. */
  async standUp(hostId: string, target: string) {
    this.requireHost(hostId);
    if (target === hostId) throw new EngineError('Use Leave to stand up yourself.');
    const s = this.seatOf(target);
    if (!s) throw new EngineError('That player is not seated.');
    if (this.inActiveHand(target)) {
      s.standingUp = true; s.sitOut = true;
      this.say(`${s.name} will move to the spectators after this hand.`, 'system');
      return;
    }
    this.standUpNow(s);
  }

  /** Felt and card backs: cosmetic, so the host may change them at any time, even mid-hand. */
  async setTheme(hostId: string, p: { felt?: unknown; cardBack?: unknown }) {
    this.requireHost(hostId);
    const c = { ...this.config };
    if (p.felt !== undefined) { if (!isFelt(p.felt)) throw new EngineError('Unknown felt.'); c.felt = p.felt; }
    if (p.cardBack !== undefined) { if (!isBack(p.cardBack)) throw new EngineError('Unknown card back.'); c.cardBack = p.cardBack; }
    if (c.felt === this.config.felt && c.cardBack === this.config.cardBack) return;
    const msg = c.felt !== this.config.felt ? `The host changed the felt to ${FELTS.find((f) => f.id === c.felt)!.name}.`
      : `The host changed the card backs to ${BACKS.find((b) => b.id === c.cardBack)!.name}.`;
    this.config = c;
    await this.store.updateTable(this.code, { config: c });
    this.say(msg, 'system');
  }

  async close(hostId: string) {
    this.requireHost(hostId);
    if (this.hand && !this.hand.settled) { this.closing = true; this.say('The host will close the table after this hand.', 'system'); return; }
    await this.doClose('The host closed the table.');
  }

  private async doClose(reason: string) {
    this.clearTimer();
    this.closed = true;
    await this.store.updateTable(this.code, { closed: true });
    this.hooks.closed(reason);
    this.dispose();
  }

  async updateSettings(hostId: string, p: Partial<TableConfig>) {
    this.requireHost(hostId);
    if (this.hand && !this.hand.settled) throw new EngineError('Settings can be changed between hands.');
    const c = { ...this.config };
    const int = (v: unknown, lo: number, hi: number, name: string) => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new EngineError(`Invalid ${name}.`);
      return v;
    };
    if (p.name !== undefined) { if (typeof p.name !== 'string') throw new EngineError('Invalid name.'); c.name = cleanName(p.name, 40) || c.name; }
    if (p.isPublic !== undefined) c.isPublic = !!p.isPublic && !c.solo;
    if (p.allowSpectators !== undefined) c.allowSpectators = !!p.allowSpectators;
    if (p.minAnte !== undefined) c.minAnte = int(p.minAnte, 100, 1_000_000, 'minimum ante');
    if (p.maxAnte !== undefined) c.maxAnte = int(p.maxAnte, 100, 1_000_000, 'maximum ante');
    if (p.maxTrips !== undefined) c.maxTrips = int(p.maxTrips, 0, 1_000_000, 'Trips+ limit');
    if (p.maxPairs !== undefined) c.maxPairs = int(p.maxPairs, 0, 1_000_000, 'Ultimate Pairs limit');
    if (p.maxBadBeat !== undefined) c.maxBadBeat = int(p.maxBadBeat, 0, 1_000_000, 'Bad Beat limit');
    if (p.pairsVariant !== undefined) { if (!isPairsVariant(p.pairsVariant)) throw new EngineError('Unknown Ultimate Pairs pay table.'); c.pairsVariant = p.pairsVariant; }
    if (p.progressive !== undefined) c.progressive = !!p.progressive;
    if (p.badBeatVariant !== undefined) { if (!isBadBeatVariant(p.badBeatVariant)) throw new EngineError('Unknown Bad Beat pay table.'); c.badBeatVariant = p.badBeatVariant; }
    if (p.startingBankroll !== undefined) c.startingBankroll = int(p.startingBankroll, 1000, 100_000_000, 'starting bankroll');
    if (p.decisionSeconds !== undefined) c.decisionSeconds = c.solo ? int(p.decisionSeconds, 0, 300, 'timer') : int(p.decisionSeconds, 5, 120, 'decision timer');
    if (p.bettingSeconds !== undefined) c.bettingSeconds = int(p.bettingSeconds, 5, 120, 'betting timer');
    if (p.maxSeats !== undefined && !c.solo) {
      c.maxSeats = int(p.maxSeats, 2, 6, 'seat count');
      if (this.seats.some((s, i) => s && i >= c.maxSeats)) throw new EngineError('Players are seated beyond that seat count.');
    }
    for (const k of ['minAnte', 'maxAnte', 'maxTrips', 'maxPairs', 'maxBadBeat'] as const) if (c[k] % 100) throw new EngineError('Limits must be whole dollars.');
    if (c.maxAnte < c.minAnte) throw new EngineError('Maximum ante must be at least the minimum.');
    const pairsChanged = c.pairsVariant !== this.config.pairsVariant;
    const badBeatChanged = c.badBeatVariant !== this.config.badBeatVariant;
    const progressiveChanged = c.progressive !== this.config.progressive;
    this.config = c;
    // Switching the progressive off takes back any $5 already placed, without touching the rest of the bet.
    if (!c.progressive) for (const s of this.seats) if (s?.pending.progressive) s.pending = { ...s.pending, progressive: 0 };
    await this.store.updateTable(this.code, { config: c });
    // Pay tables never change silently: announce every change to the whole table.
    if (pairsChanged) this.say(`Pay table change: Ultimate Pairs is now ${PAIRS_VARIANTS[c.pairsVariant].name}, starting next hand.`);
    if (progressiveChanged) this.say(c.progressive ? 'The $5 Progressive is now open at this table, starting next hand.' : 'The $5 Progressive is closed at this table, starting next hand.');
    if (badBeatChanged) this.say(`Pay table change: Bad Beat is now ${BAD_BEAT_VARIANTS[c.badBeatVariant].name}, starting next hand.`);
    for (const s of this.seats) if (s && s.pending.ante && validateInitialBet(s.pending, s.balance, this.limits())) {
      s.pending = { ...NO_BETS }; s.ready = false;
    }
    this.say('The host updated the table settings.', 'system');
  }

  // ------------------------------------------------------------------ views (per-viewer redaction)
  viewFor(viewerId: string): TableView {
    const hand = this.hand;
    const showdown = !!hand?.settled;
    const C = (n: number) => intToCard(n);
    const community: (string | null)[] = hand ? hand.community.map((c, i) => (i < hand.revealed || showdown ? C(c) : null)) : [];
    const visibleCommunity = hand ? hand.community.slice(0, showdown ? 5 : hand.revealed) : [];

    const seats: (SeatView | null)[] = this.seats.slice(0, this.config.maxSeats)
      .map((s) => (s ? this.seatView(s, viewerId, visibleCommunity) : null));

    const me = this.seatOf(viewerId);
    const dealerShown = showdown && hand;
    return {
      code: this.code,
      config: this.config,
      phase: this.phase,
      handId: hand?.id ?? null,
      handNumber: hand?.number ?? this.handCounter,
      seq: this.seq,
      serverNow: this.now(),
      deadline: this.deadline,
      community,
      dealer: dealerShown ? {
        cards: hand.dealer.map(C), handName: handName(hand.dealerScore!),
        qualifies: hand.players.size ? [...hand.players.values()][0].settlement?.dealerQualifies : undefined,
        best5: bestFive([...hand.dealer, ...hand.community]).map(C),
      } : { cards: hand ? [null, null] : [] },
      seats,
      spectators: this.spectators.size,
      you: {
        playerId: viewerId,
        seat: me?.seat ?? null,
        role: me ? 'player' : 'spectator',
        isHost: viewerId === this.hostId,
        legal: this.legalFor(viewerId),
        canBet: !!me && this.phase === 'betting',
        pending: me?.pending ?? { ...NO_BETS },
        lastBet: me?.lastBet ?? null,
        canReload: !!me && !this.inActiveHand(viewerId) && me.balance < requiredToStart(this.config.minAnte),
        timeoutPolicy: me?.timeoutPolicy ?? 'default',
      },
      recent: this.recent,
      jackpot: { amount: this.hooks.jackpotAmount(), wager: PROGRESSIVE.wager },
    };
  }

  private seatView(s: Seat, viewerId: string, visible: number[]): SeatView {
    const h = this.hp(s.playerId);
    const showdown = !!this.hand?.settled;
    const own = s.playerId === viewerId;
    // Showdown policy: once the round has settled, every hand at the table is turned face up, folded ones included.
    // Until then, players see only their own hole cards.
    const canSee = !!h && (own || showdown);
    let status: SeatView['status'];
    if (h) status = h.folded ? 'folded' : 'in-hand';
    else if (this.hand && !this.hand.settled) status = s.sitOut ? 'sitting-out' : 'waiting-next';
    else if (s.sitOut) status = 'sitting-out';
    else status = s.ready ? 'ready' : 'betting';
    const result: SeatResult | undefined = h?.settlement ? {
      outcome: h.settlement.outcome, net: h.settlement.net, handName: h.settlement.playerHand,
      best5: h.best5?.map(intToCard),
      lines: (['ante', 'blind', 'play', 'trips', 'pairs', 'badBeat', 'progressive'] as const).filter((k) => h.settlement![k].stake > 0)
        .map((k) => {
          const w = h.settlement![k];
          return { wager: k, result: w.result, net: w.net, stake: w.stake, credit: w.credit, note: w.note, multiplier: w.multiplier, combo: w.combo, variant: w.variant };
        }),
      baseNet: h.settlement.baseNet, sideNet: h.settlement.sideNet,
    } : undefined;
    return {
      seat: s.seat, playerId: s.playerId, name: s.name, avatar: s.avatar, balance: s.balance, connected: s.connected,
      isHost: s.playerId === this.hostId, status,
      bet: h ? { ante: h.ante, blind: h.blind, trips: h.trips, play: h.play, pairs: h.pairs, badBeat: h.badBeat, progressive: h.progressive }
             : { ante: s.pending.ante, blind: s.pending.ante, trips: s.pending.trips, play: 0, pairs: s.pending.pairs, badBeat: s.pending.badBeat, progressive: s.pending.progressive },
      acted: !!h && !this.needsToAct(h), needsToAct: !!h && this.needsToAct(h), lastAction: h?.lastAction,
      cards: h ? (canSee ? h.hole.map(intToCard) : [null, null]) : [],
      handName: h && canSee ? handName(evaluate([...h.hole, ...visible])) : undefined,
      result,
      debt: s.debt || undefined,
      leaving: s.leaving, standingUp: s.standingUp || undefined, awayByHost: s.awayByHost || undefined,
    };
  }

  /** Decisions for the viewer's current hand (for Challenge-mode grading after settlement). */
  decisionsFor(pid: string) { return this.hp(pid)?.decisions ?? []; }

  listing() {
    return {
      code: this.code, name: this.config.name, seated: this.seatedCount(), maxSeats: this.config.maxSeats,
      minAnte: this.config.minAnte, maxAnte: this.config.maxAnte, inHand: !!this.hand && !this.hand.settled,
      allowSpectators: this.config.allowSpectators,
    };
  }
}

/** Public labels for bonus bets that paid. */
function sideHits(st: Settlement): string[] {
  const out: string[] = [];
  if (st.trips.result === 'win') out.push(`Trips+ ${st.trips.multiplier}:1`);
  if (st.pairs.result === 'win') out.push(`Ultimate Pairs ${st.pairs.multiplier}:1`);
  if (st.badBeat.result === 'win') out.push(`Bad Beat ${st.badBeat.multiplier}:1`);
  if (st.progressive.result === 'win') out.push(`Progressive ${st.progressive.combo ?? ''}`.trim());
  return out;
}

export function cleanName(s: string, max: number): string {
  // strip control chars and angle brackets, collapse whitespace
  return s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
