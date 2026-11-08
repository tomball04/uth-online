// TableEngine: the single source of truth for one table. Every mutation runs through a per-table
// async mutex, so concurrent socket messages can never interleave a half-applied state change.
// Money moves only through the Store (ledger, transactions). The engine mirrors balances in memory
// for fast validation and always replaces them with the Store's returned values.

import { cardToInt, intToCard, orderedDeck } from '../shared/cards.js';
const orderedDeckIds = () => orderedDeck();
const cardToIntLocal = (c: string) => cardToInt(c);
const bjValueTen = (c: string) => 'TJQK'.includes(c[0]);
function secureShuffleIds(d: number[]) {
  for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
import { bestFive, evaluate, handName, handNameRank } from '../shared/evaluator.js';
import type {
  ChatMessage, DecisionRecord, HandSummary, Phase, SeatResult, SeatView, TableConfig, TableView,
} from '../shared/protocol.js';
import {
  LEGAL_DECISIONS, NO_BETS, PLAY_MULTIPLIER, TIMEOUT_DEFAULT, decisionLabel, formatMoney, requiredToStart, sideTotal,
  RULES_VERSION, dealerQualifies, settle, validateInitialBet, type Decision, type DecisionPhase, type InitialBets, type Settlement,
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
    effects: isEffects(c.effects) ? c.effects : 'all',
    cardBack: isBack(c.cardBack) ? c.cardBack : DEFAULT_BACK,
    game: c.game === 'tcp' || c.game === 'bj' ? c.game : 'uth',
    bjSurrender: c.bjSurrender === true,
    maxPairPlus: typeof c.maxPairPlus === 'number' ? c.maxPairPlus : (c.solo ? 10_000 : 2_500),
    maxSixCard: typeof c.maxSixCard === 'number' ? c.maxSixCard : (c.solo ? 10_000 : 2_500),
    dealer: (() => { try { return parseDealerSettings(c.dealer); } catch { return DEFAULT_DEALER_SETTINGS; } })(),
  };
}
import { newId, sha256 } from './rng.js';
import { RoastDirector, type RoundFacts, type RoundPlayer } from './roast.js';
import { debtLine, pawnFor, randomPawn } from '../shared/debt.js';
import { NIGHT_IDLE_MS } from '../shared/recap.js';
import { evaluate3, settleTcp, tcpDescribe, tcpAdvice, tcpExactEV, tcpHandName, tcpQualifies, TCP_RULES_VERSION, type TcpSettlement } from '../shared/tcp.js';
import { validateTcpBet, tcpRequiredToStart, GAME_NAME, type GameId } from '../shared/rules.js';
import { BACKS, DEFAULT_BACK, DEFAULT_FELT, EFFECTS, FELTS, isBack, isEffects, isFelt } from '../shared/themes.js';
import type { PublicLook } from '../shared/cosmetics.js';
import { CHATTER_RATE, DEALER, DEFAULT_DEALER_SETTINGS, isDealerId, isMajorWin, nextDealer, parseDealerSettings, type Dealer } from '../shared/dealers.js';
import { randomInt } from 'node:crypto';
import {
  BJ_RULES_VERSION, DEFAULT_BJ_RULES, bjAdvice, dealerMustPlay, dealerPlay, describeTotal, insuranceAdvice, isNatural, legalActions, maxInsurance,
  newHand, rulesSummary, settleHand as settleBjHand, settleInsurance, total as bjTotal, type BjAction, type BjHand, type BjHandResult, type BjRules,
  bjEvCost, insuranceEvCost, cardValue,
} from '../shared/blackjack.js';
import type { BjAct, BjTableView, SeatBj } from '../shared/protocol.js';
import { validateBjBet } from '../shared/rules.js';
import type { HouseView } from '../shared/protocol.js';
import type { PlayerRow, PlayerSettlementRow, Store } from './store.js';

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
  nightEnded(nightId: string): void;
  /** A hand settled (drives cosmetic rewards; never affects chips). */
  settled?(handId: string, nightId: string | null, playerIds: string[]): void;
}

interface Seat {
  seat: number; playerId: string; name: string; avatar: string; balance: number; reloads: number; debt: number;
  /** What's at the pawn shop for this player's markers (just for fun). */
  pawned: string | null;
  connected: boolean; disconnectedAt: number | null;
  pending: InitialBets; ready: boolean; lastBet: InitialBets | null;
  sitOut: boolean; timeoutPolicy: 'default' | 'strategy'; leaving: boolean;
  /** Same bet every hand: placed and readied automatically at the start of each betting round. */
  autoRebet: InitialBets | null;
  standingUp: boolean; awayByHost: boolean;
  seen: string[];
}

interface HandPlayer {
  playerId: string; seat: number; name: string; hole: number[];
  ante: number; blind: number; trips: number; pairs: number; badBeat: number; progressive: number; play: number; folded: boolean;
  pairPlus: number; sixCard: number;
  acted: boolean; lastAction?: Decision; decisions: DecisionRecord[];
  settlement?: Settlement; tcp?: TcpSettlement; best5?: number[];
  bj?: BjPlayer;
}
interface BjPlayer {
  hands: BjHand[]; active: number;
  /** null = not answered (or not offered); 0 = declined. */
  insurance: number | null; offered: boolean;
  /** Doubles + splits wagered during the round (cents). */
  extra: number; n: number;
  results?: BjHandResult[]; insuranceNet?: number; net?: number;
  /** §32: verified Blackjack blunders this round (cards are public, so the dealer may remark on them). */
  hit20?: boolean; split10?: boolean;
}

interface Hand {
  id: string; number: number; dealer: number[]; community: number[]; revealed: number;
  players: Map<string, HandPlayer>; settled: boolean; dealerScore?: number; game: GameId;
  bj?: { turn: string | null; holeShown: boolean; order: string[] };
}

export class EngineError extends Error {}

const DECISION_PHASES: Phase[] = ['preflop', 'flop', 'river', 'decide'];
/** Three Card Poker categories mapped onto five-card ranks so best-hand records compare across games. */
const TCP_EQUIV_RANK: Record<string, number> = { 'High Card': 0, Pair: 1, Flush: 5, Straight: 4, 'Three of a Kind': 3, 'Straight Flush': 8 };

export class TableEngine {
  phase: Phase = 'waiting';
  seats: (Seat | null)[];
  spectators = new Map<string, { name: string }>();
  /** Public avatar looks of players at this table (§24). Display only. */
  looks = new Map<string, PublicLook>();
  hand: Hand | null = null;
  deadline: number | null = null;
  seq = 0;
  closing = false;
  closed = false;
  banned = new Set<string>();
  recent: HandSummary[] = [];
  /** The open table night (running tab). Set at the first deal; the host can end it between hands. */
  nightId: string | null = null;
  private freshNight = false;
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
    this.roast = new RoastDirector({
      emit: (p, fallback) => this.hooks.chat({ id: newId(), at: this.now(), kind: 'dealer', name: this.currentDealer().name, text: fallback, roast: p }),
      attitude: () => this.config.dealer.attitude ?? 'smartass',
      dealer: () => { const d = this.currentDealer(); return { id: d.id, name: d.name }; },
      rand: (n) => this.dealerRand(n), now: () => this.now(), store, tableCode: code,
    });
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
    this.hooks.chat({ id: newId(), at: this.now(), kind, name: kind === 'dealer' ? this.currentDealer().name : undefined, text });
  }

  // ------------------------------------------------------------------ §25 rotating dealers (presentation only)
  /** The dealer persona. Chosen with a cosmetic random source; never consulted by the shuffle or settlement. */
  house: { dealerId: string; rounds: number } = { dealerId: 'vincent', rounds: 0 };
  /** §32 dealer banter. Presentation only: fed with settled, public facts; never awaited by settlement. */
  roast: RoastDirector;
  private roastChain: Promise<unknown> = Promise.resolve();
  private shiftAnnounced = false;
  private bigWinPid: string | undefined;
  private rotation: HouseView['rotating'] = null;
  private houseEvent: HouseView['event'] = null;
  private bigWin: HouseView['bigWin'] = null;
  /** Cosmetic randomness for dealer choice and table talk. Separate from the deck shuffle. */
  dealerRand: (n: number) => number = (n) => randomInt(n);
  currentDealer(): Dealer { return DEALER.get(this.house.dealerId) ?? DEALER.get('vincent')!; }
  /** Restore persisted dealer state, or seat a random dealer for a brand-new table. */
  initHouse(saved: { dealerId: string | null; rounds: number } | null) {
    if (saved?.dealerId && isDealerId(saved.dealerId)) { this.house = { dealerId: saved.dealerId, rounds: saved.rounds }; return; }
    this.house = { dealerId: nextDealer(null, this.dealerRand), rounds: 0 };
    this.houseEvent = { kind: 'intro', from: null, to: this.house.dealerId, reason: 'open', at: this.now() };
    this.store.updateDealer(this.code, this.house.dealerId, 0).catch(() => {});
  }
  private chatter(kind: keyof Dealer['lines']) {
    const rate = CHATTER_RATE[this.config.dealer.chatter];
    if (!rate || this.dealerRand(1000) >= rate * 1000) return;
    const lines = this.currentDealer().lines[kind];
    this.say(lines[this.dealerRand(lines.length)]);
  }
  /**
   * Count one completed, settled round toward the dealer's shift and decide whether the dealer rotates.
   * Uses settled nets only. A major win and the round limit together still mean one rotation.
   */
  private countRound(results: { pid?: string; name: string; net: number; opening: number }[], progressivePaid: number) {
    const d = this.config.dealer;
    this.house.rounds++;
    const big = results.filter((r) => isMajorWin(d, r.net, r.opening)).sort((a, b) => b.net - a.net)[0];
    const jackpot = d.majorWins && progressivePaid >= d.progressiveMin;
    this.bigWin = big ? { name: big.name, amount: big.net } : null;
    this.bigWinPid = big?.pid;
    const dealer = this.currentDealer();
    if (big || jackpot) {
      const who = big?.name ?? 'the jackpot winner';
      this.say(`${dealer.lines.bigWin[this.dealerRand(dealer.lines.bigWin.length)]} Congratulations, ${who}${big ? ` — ${formatMoney(big.net, { sign: true })}` : ''}.`);
      if (!this.rotation) this.rotation = { reason: 'bigwin' };
    } else {
      const net = results.reduce((t, r) => t + r.net, 0);
      if (results.length) this.chatter(net > 0 ? 'win' : 'loss');
    }
    if (!this.rotation && d.rotate && this.house.rounds >= d.every) this.rotation = { reason: 'shift' };
    this.shiftAnnounced = false;
    this.store.updateDealer(this.code, this.house.dealerId, this.house.rounds).catch(() => {});
  }
  /** §32: what each player did and got this round, from settled, public data only. */
  private roundFacts(hand: Hand, dealerHand: string, hits: { playerId: string; amount: number }[]): RoundFacts {
    const players: RoundPlayer[] = [...hand.players.values()].map((h) => {
      const base = { pid: h.playerId, name: h.name, opening: h.ante, decisions: h.decisions, folded: h.folded };
      if (h.settlement) {
        const st = h.settlement;
        const shown = !h.folded;
        return { ...base, mainNet: st.baseNet, sideNet: st.sideNet, totalNet: st.net, handName: st.playerHand,
          checkedThrough: h.decisions.some((d) => d.phase === 'preflop' && d.action === 'check') && h.decisions.some((d) => d.phase === 'flop' && d.action === 'check'),
          progressiveWin: hits.filter((x) => x.playerId === h.playerId).reduce((t, x) => t + x.amount, 0) || undefined,
          badBeatWin: st.badBeat.result === 'win' ? st.badBeat.net : undefined,
          royal: shown && st.playerHand === 'Royal Flush',
          improbable: shown && (st.playerHand === 'Straight Flush' || st.playerHand === 'Four of a Kind') ? st.playerHand : undefined };
      }
      if (h.tcp) {
        const st = h.tcp;
        return { ...base, mainNet: st.baseNet, sideNet: st.sideNet, totalNet: st.net, handName: st.playerHand,
          improbable: st.playerHand === 'Straight Flush' || st.playerHand === 'Three of a Kind' ? st.playerHand : undefined };
      }
      const b = h.bj!;
      const ins = b.insuranceNet ?? 0;
      const busted = b.hands.find((y) => bjTotal(y.cards).bust);
      const six21 = b.hands.some((y) => y.cards.length >= 6 && bjTotal(y.cards).total === 21);
      return { ...base, mainNet: (b.net ?? 0) - ins, sideNet: ins, totalNet: b.net ?? 0, handName: b.results?.[0]?.total,
        natural: !!b.results?.some((r) => r.outcome === 'blackjack'), improbable: six21 ? `${b.hands.find((y) => y.cards.length >= 6)!.cards.length}-card 21` : undefined,
        bj: { hit20: !!b.hit20, split10: !!b.split10, busted: !!busted, total: busted ? String(bjTotal(busted.cards).total) : undefined } };
    });
    return { handId: hand.id, nightId: this.nightId, game: hand.game, dealerHand, players };
  }
  /** The outgoing dealer's last word for the shift — after any roast about the hand that just finished. */
  private announceShift() {
    const r = this.rotation;
    if (!r || this.shiftAnnounced) return;
    this.shiftAnnounced = true;
    const dealer = this.currentDealer();
    if (r.reason === 'bigwin' && !r.next) {
      const w = this.bigWin ? { pid: this.bigWinPid, name: this.bigWin.name, amount: this.bigWin.amount } : undefined;
      if (!this.roast.onShiftEnd('bigwin', this.house.rounds, w)) this.say('That was quite a hand. Looks like my shift ends on a high note.');
    } else if (r.reason === 'shift' && !this.roast.onShiftEnd('shift', this.house.rounds)) {
      this.say(`${dealer.lines.shiftEnd[this.dealerRand(dealer.lines.shiftEnd.length)]} A new dealer takes over after these results.`);
    }
  }
  /** §32: banter about the settled round, then the shift note. Fire-and-forget: settlement never waits on it. */
  private afterSettle(f: RoundFacts) {
    this.roastChain = this.roast.afterRound(f).catch(() => 0).then(() => this.announceShift());
  }
  /** Between rounds only: hand over to the next dealer. Cards, shuffle and balances are untouched. */
  private rotateNow() {
    const r = this.rotation;
    if (!r) return;
    this.rotation = null;
    const from = this.currentDealer();
    const to = DEALER.get(r.next ?? '') && r.next !== from.id ? DEALER.get(r.next!)! : DEALER.get(nextDealer(from.id, this.dealerRand))!;
    if (!this.roast.onFarewell()) this.say(from.lines.farewell[this.dealerRand(from.lines.farewell.length)]);
    this.house = { dealerId: to.id, rounds: 0 };
    this.houseEvent = { kind: 'rotate', from: from.id, to: to.id, reason: r.reason, winner: this.bigWin?.name, at: this.now() };
    const intro = this.config.dealer.intro;
    if (intro !== 'off' && !this.roast.onIntro(from.name)) this.say(intro === 'full' ? to.intro : to.introShort);
    this.store.updateDealer(this.code, to.id, 0).catch(() => {});
    void this.roast.grudge(this.seats.filter((x): x is Seat => !!x).map((x) => ({ pid: x.playerId, name: x.name })));
  }
  /** Host: dealer settings any time; choosing a dealer only between hands (applies at once, or after results). */
  async setDealer(hostId: string, p: { settings?: unknown; dealerId?: unknown }) {
    this.requireHost(hostId);
    if (p.settings !== undefined) {
      let next;
      try { next = parseDealerSettings(p.settings, this.config.dealer); } catch (e) { throw new EngineError((e as Error).message); }
      this.config = { ...this.config, dealer: next };
      await this.store.updateTable(this.code, { config: this.config });
    }
    if (p.dealerId !== undefined) {
      if (!isDealerId(p.dealerId)) throw new EngineError('Unknown dealer.');
      if (p.dealerId === this.house.dealerId) return { queued: false };
      if (this.hand && !this.hand.settled) throw new EngineError('You can change the dealer between hands.');
      this.rotation = { reason: 'host', next: p.dealerId };
      if (this.phase !== 'settled') { this.rotateNow(); return { queued: false }; }
      return { queued: true };
    }
    return { queued: false };
  }
  houseView(): HouseView {
    return { dealerId: this.house.dealerId, rounds: this.house.rounds, rotating: this.rotation ? { reason: this.rotation.reason } : null, event: this.houseEvent, bigWin: this.phase === 'settled' ? this.bigWin : null };
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
  /** Opening-bet rules for the game the table is playing. */
  private validate(b: InitialBets, balance: number): string | null {
    const c = this.config;
    if (c.game === 'bj') return validateBjBet({ ...NO_BETS, ...b }, balance, c);
    return c.game === 'tcp'
      ? validateTcpBet({ ...NO_BETS, ...b }, balance, { minAnte: c.minAnte, maxAnte: c.maxAnte, maxPairPlus: c.maxPairPlus, maxSixCard: c.maxSixCard })
      : validateInitialBet(b, balance, this.limits());
  }
  private minToPlay() { return this.config.game === 'bj' ? this.config.minAnte : this.config.game === 'tcp' ? tcpRequiredToStart(this.config.minAnte) : requiredToStart(this.config.minAnte); }
  private gameOf(): GameId { return this.hand?.game ?? this.config.game; }
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
    // The item last pawned for this player's markers, so it stays the same across visits.
    const lastPawn = stack.debt ? (await this.store.debtEvents(this.code, 500)).find((e) => e.playerId === player.id && e.debtAfter > 0)?.item ?? null : null;
    // Re-check after the await (another sit may have raced for this seat).
    if (this.seats[idx] || this.seatOf(player.id)) throw new EngineError('That seat is taken.');
    this.spectators.delete(player.id);
    this.seats[idx] = {
      seat: idx, playerId: player.id, name: player.name, avatar: player.avatar, balance: stack.balance, reloads: stack.reloads, debt: stack.debt ?? 0,
      pawned: stack.debt ? lastPawn ?? pawnFor(stack.debt, player.id).item : null,
      connected: true, disconnectedAt: null, pending: { ...NO_BETS }, ready: false, lastBet: null,
      sitOut: false, timeoutPolicy: 'default', leaving: false, autoRebet: null, standingUp: false, awayByHost: false, seen: [],
    };
    if (!this.seatOf(this.hostId)) this.hostId = player.id;
    this.say(`${player.name} takes seat ${idx + 1}.`, 'system');
    this.roast.seated(player.id);
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
    const err = this.validate(bets, s.balance);
    if (err) throw new EngineError(err);
    s.pending = { ante: bets.ante, trips: bets.trips, pairs: bets.pairs, badBeat: bets.badBeat, progressive: bets.progressive,
      pairPlus: bets.pairPlus ?? 0, sixCard: bets.sixCard ?? 0 };
    s.ready = false;
    s.autoRebet = null;   // changing the bet by hand turns same-bet off
    this.checkStart();
  }

  async clearBet(pid: string, actionId: string) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    if (this.phase !== 'betting') throw new EngineError('Bets are locked during a hand.');
    s.pending = { ...NO_BETS };
    s.ready = false;
    s.autoRebet = null;
    this.checkStart();
  }

  async setReady(pid: string, actionId: string, ready: boolean) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    if (this.phase !== 'betting') throw new EngineError('Not in the betting phase.');
    if (ready) {
      const err = this.validate(s.pending, s.balance);
      if (err) throw new EngineError(s.pending.ante ? err : 'Place an Ante first.');
      if (s.sitOut) this.say(`${s.name} is back.`, 'system');
      s.sitOut = false; s.awayByHost = false;
    }
    s.ready = ready;
    if (!ready) s.autoRebet = null;
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
      !this.validate(s.pending, s.balance));
    if (!players.length) return;

    const game = this.config.game;
    if (game === 'bj') return this.dealBj(players);
    const deck = this.shuffle();
    if (deck.length !== 52 || new Set(deck).size !== 52) throw new Error('Corrupt deck');
    let i = 0;
    const holes = new Map<string, number[]>();
    for (const s of players) holes.set(s.playerId, []);
    const dealer: number[] = [];
    const community: number[] = [];
    // One card at a time around the table, dealer last: two rounds for Hold'em, three for Three Card Poker.
    for (let round = 0; round < (game === 'tcp' ? 3 : 2); round++) {
      for (const s of players) holes.get(s.playerId)!.push(deck[i++]);
      dealer.push(deck[i++]);
    }
    if (game === 'uth') {
      i++; // burn
      community.push(deck[i++], deck[i++], deck[i++]);
      i++; // burn
      community.push(deck[i++]);
      i++; // burn
      community.push(deck[i++]);
    }

    const id = newId();
    const number = this.handCounter + 1;
    const night = await this.store.openNight(this.code, NIGHT_IDLE_MS, this.freshNight);
    if (night.id !== this.nightId) this.say(this.freshNight || !this.nightId ? 'A new night begins. Good luck, everyone.' : 'Welcome back — a new night begins.');
    this.freshNight = false;
    this.nightId = night.id;
    const { balances, jackpot } = await this.store.startHand({
      nightId: night.id, rulesVersion: game === 'tcp' ? TCP_RULES_VERSION : RULES_VERSION, game,
      id, tableCode: this.code, handNumber: number,
      deckCommitment: sha256(deck.map(intToCard).join('') + ':' + id),
      dealerCards: dealer.map(intToCard), community: community.map(intToCard),
      pairsVariant: this.config.pairsVariant, badBeatVariant: this.config.badBeatVariant,
      players: players.map((s) => ({ playerId: s.playerId, seat: s.seat, name: s.name, hole: holes.get(s.playerId)!.map(intToCard),
        ante: s.pending.ante, blind: game === 'tcp' ? 0 : s.pending.ante, trips: s.pending.trips, pairs: s.pending.pairs, badBeat: s.pending.badBeat,
        progressive: s.pending.progressive, pairPlus: s.pending.pairPlus, sixCard: s.pending.sixCard })),
    });
    this.hooks.jackpot(jackpot);
    this.handCounter = number;
    const map = new Map<string, HandPlayer>();
    for (const s of players) {
      s.balance = balances.get(s.playerId)!;
      s.lastBet = { ...s.pending };
      map.set(s.playerId, { playerId: s.playerId, seat: s.seat, name: s.name, hole: holes.get(s.playerId)!,
        ante: s.pending.ante, blind: game === 'tcp' ? 0 : s.pending.ante, trips: s.pending.trips, pairs: s.pending.pairs, badBeat: s.pending.badBeat,
        progressive: s.pending.progressive, pairPlus: s.pending.pairPlus, sixCard: s.pending.sixCard,
        play: 0, folded: false, acted: false, decisions: [] });
    }
    this.hand = { id, number, dealer, community, revealed: 0, players: map, settled: false, game };
    for (const s of this.seats) if (s) { s.ready = false; }
    const n = `${players.length} player${players.length > 1 ? 's' : ''} in`;
    if (game === 'tcp') {
      this.phase = 'decide';
      this.say(`Hand #${number} — Three Card Poker. Cards are out, ${n}. Play 1x or fold.`);
    } else {
      this.phase = 'preflop';
      this.say(`Hand #${number}. Cards are out — ${n}. Check or play 3x / 4x.`);
    }
    this.chatter('deal');
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
    const rec = hand.game === 'tcp' ? tcpAdvice(h.hole, false) : advise(phase, h.hole, community);
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
      outs: hand.game === 'tcp' ? undefined : outsFor(phase, h.hole, community) };
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
        const rec = this.hand.game === 'tcp' ? tcpAdvice(h.hole, false).action
          : advise(this.phase as DecisionPhase, h.hole, this.hand.community.slice(0, this.hand.revealed)).action;
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
    } else if (this.phase === 'river' || this.phase === 'decide') {
      await this.showdown();
    }
  }

  // ------------------------------------------------------------------ settlement
  private async showdown() {
    const hand = this.hand!;
    this.clearTimer();
    this.phase = 'showdown';
    if (hand.game === 'tcp') return this.showdownTcp();
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
    if (res.applied) this.hooks.settled?.(hand.id, this.nightId, [...hand.players.keys()]);
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
    if (res.applied) this.countRound([...hand.players.values()].map((h) => ({ pid: h.playerId, name: h.name, net: h.settlement!.net, opening: h.ante })), hitList.reduce((t, x) => t + x.amount, 0));
    if (res.applied) this.afterSettle(this.roundFacts(hand, dealerName, hitList));
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

  /** Three Card Poker: dealer reveals, every player settles independently. The UTH jackpot meter is never touched. */
  private async showdownTcp() {
    const hand = this.hand!;
    const dealerScore = evaluate3(hand.dealer);
    hand.dealerScore = dealerScore;
    const dealerName = tcpHandName(dealerScore), qualifies = tcpQualifies(dealerScore);
    const players = [...hand.players.values()];
    const build = (meter: number) => ({
      jackpotAfter: meter, hits: [],
      rows: players.map((h) => {
        const st = settleTcp({ ante: h.ante, play: h.play, pairPlus: h.pairPlus, sixCard: h.sixCard, folded: h.folded, player: h.hole, dealer: hand.dealer });
        h.tcp = st;
        return {
          playerId: h.playerId, credit: st.totalCredit, net: st.net, outcome: st.outcome, handName: st.playerHand,
          handRank: TCP_EQUIV_RANK[st.playerHand], tripsNet: 0, play: h.play, folded: h.folded, settlement: st,
          pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null, badBeatMultiplier: null,
          pairsVariant: null, badBeatVariant: null, baseNet: st.baseNet, progressiveNet: 0, progressiveHand: null,
          pairPlusNet: h.pairPlus ? st.pairPlus.net : undefined, sixCardNet: h.sixCard ? st.sixCard.net : undefined,
          anteBonusNet: st.anteBonus.net, pairPlusHand: h.pairPlus && st.pairPlus.result === 'win' ? st.playerHand : null,
          sixCardHand: h.sixCard ? st.sixCardHand : null,
        };
      }),
    });
    const res = await this.store.settleHand(hand.id, this.code, { hand: dealerName, qualifies }, build);
    if (!res.applied) console.warn(`[engine] hand ${hand.id} was already settled — skipping payout`);
    for (const [pid, bal] of res.balances) { const s = this.seatOf(pid); if (s) s.balance = bal; }
    hand.settled = true;
    if (res.applied) this.hooks.settled?.(hand.id, this.nightId, [...hand.players.keys()]);
    this.phase = 'settled';
    const parts = players.map((h) => `${h.name} ${formatMoney(h.tcp!.net, { sign: true })}`);
    this.say(`Dealer has ${tcpDescribe(dealerScore)}${qualifies ? '' : ' — does not qualify (Ante pays, Play pushes)'}. ${parts.join(' · ')}`);
    for (const h of players) {
      const st = h.tcp!;
      if (st.anteBonus.result === 'win') this.say(`${h.name}: Ante Bonus — ${st.playerHand} pays ${st.anteBonus.multiplier}:1 (${formatMoney(st.anteBonus.net, { sign: true })}).`);
      if (st.pairPlus.result === 'win') this.say(`${h.name}: Pair Plus — ${st.playerHand} pays ${st.pairPlus.multiplier}:1 (${formatMoney(st.pairPlus.net, { sign: true })}).`);
      if (st.sixCard.result === 'win') this.say(`${h.name}: Six Card Bonus — ${st.sixCardHand} pays ${st.sixCard.multiplier!.toLocaleString('en-US')}:1 (${formatMoney(st.sixCard.net, { sign: true })}).`);
    }
    if (res.applied) this.countRound(players.map((h) => ({ pid: h.playerId, name: h.name, net: h.tcp!.net, opening: h.ante })), 0);
    if (res.applied) this.afterSettle(this.roundFacts(hand, tcpDescribe(dealerScore), []));
    this.recent.unshift({
      handId: hand.id, handNumber: hand.number, at: this.now(), dealerHand: dealerName, dealerQualifies: qualifies,
      players: players.sort((a, b) => a.seat - b.seat).map((h) => ({ name: h.name, net: h.tcp!.net, outcome: h.tcp!.outcome, handName: h.tcp!.playerHand,
        sideHits: [h.tcp!.anteBonus.result === 'win' ? `Ante Bonus ${h.tcp!.anteBonus.multiplier}:1` : '', h.tcp!.pairPlus.result === 'win' ? `Pair Plus ${h.tcp!.pairPlus.multiplier}:1` : '',
          h.tcp!.sixCard.result === 'win' ? `Six Card ${h.tcp!.sixCard.multiplier}:1` : ''].filter(Boolean) })),
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
          if (hand.game === 'tcp') {
            // Exact: every one of the 18,424 possible dealer hands, never the dealer's actual cards.
            const ev = tcpExactEV(h.hole);
            const cost = Math.abs(ev.play - ev.fold);
            d.evCost = +cost.toFixed(4); d.evExact = true; d.evCostCents = Math.round(cost * h.ante);
            await this.store.updateDecisionEV(hand.id, h.playerId, d.phase, d.evCost, true, d.evCostCents).catch(() => {});
            continue;
          }
          const community = hand.community.slice(0, d.phase === 'preflop' ? 0 : d.phase === 'flop' ? 3 : 5);
          const m = mistakeCost(d.phase, h.hole, community, d.action);
          if (m) {
            d.evCost = +m.cost.toFixed(4);
            d.evExact = m.exact;
            d.evCostCents = Math.round(m.cost * h.ante);
            await this.store.updateDecisionEV(hand.id, h.playerId, d.phase, d.evCost, m.exact, d.evCostCents).catch(() => {});
          }
          await new Promise((r) => setImmediate(r));
        }
        this.hooks.analysis(h.playerId, { handId: hand.id, decisions: h.decisions });
      }
    });
  }

  private async nextRound() {
    if (this.phase !== 'settled') return;
    if (this.shoe && this.hand?.game === 'bj') { this.shoe.discards += this.roundCards.length; this.roundCards = []; }
    // A dealer change happens here: after payouts and results, before the next betting round.
    this.bigWin = null;
    if (this.rotation) {
      await Promise.race([this.roastChain, new Promise((r) => setTimeout(r, 400))]);
      this.announceShift();
      this.rotateNow();
    }
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
    if (this.pendingGame) await this.applyGame(this.pendingGame);
    this.phase = this.seatedCount() ? 'betting' : 'waiting';
    this.deadline = null;
    // Same bet every hand: re-place it and deal the player in, re-checking limits and affordability each time.
    let auto = false;
    for (const s of this.seats) {
      if (!s?.autoRebet || s.sitOut || !s.connected || this.phase !== 'betting') continue;
      const err = this.validate(s.autoRebet, s.balance);
      if (err) { s.autoRebet = null; this.say(`${s.name}: same-bet is off — ${err}`, 'system'); continue; }
      s.pending = { ...s.autoRebet }; s.ready = true; auto = true;
    }
    if (auto) await this.checkStart();
  }

  // ------------------------------------------------------------------ misc player actions
  async reload(pid: string) {
    const s = this.requireSeat(pid);
    if (this.inActiveHand(pid)) throw new EngineError('You can reload between hands.');
    if (this.minToPlay() <= s.balance) throw new EngineError('You can reload once your stack can no longer cover a minimum hand.');
    const debtAfter = s.debt + Math.max(0, this.config.startingBankroll - s.balance);
    const pawn = randomPawn(debtAfter);
    const st = await this.store.reloadStack(pid, this.code, this.config.startingBankroll, { name: s.name, item: pawn.item });
    const borrowed = st.debt - s.debt;
    s.balance = st.balance;
    s.reloads = st.reloads;
    if (st.debt > s.debt) s.pawned = pawn.item;
    s.debt = st.debt;
    s.pending = { ...NO_BETS };
    // Just for fun: the dealer keeps a running tab and suggests something to pawn.
    const out = { balance: st.balance, debt: st.debt, pawned: s.pawned };
    this.say(borrowed > 0 ? debtLine(s.name, borrowed, st.debt, st.reloads, pawn) : `${s.name} reloads to ${formatMoney(st.balance)} in virtual chips.`);
    return out;
  }

  /** Pay back markers from your stack, between hands. Just for fun: it only moves chips you own to the house. */
  async payDebt(pid: string, amount: number) {
    const s = this.requireSeat(pid);
    if (this.inActiveHand(pid)) throw new EngineError('You can pay off your markers between hands.');
    if (!s.debt) throw new EngineError('You don’t owe the house anything.');
    if (!Number.isInteger(amount) || amount <= 0) throw new EngineError('Choose an amount to pay.');
    const item = s.pawned ?? pawnFor(s.debt, pid).item;
    const r = await this.store.payDebt(pid, this.code, amount, { name: s.name, item: () => item });
    if (!r.paid) throw new EngineError('You have no chips to pay with.');
    s.balance = r.balance; s.debt = r.debt;
    s.pawned = r.debt ? item : null;
    // A bet that no longer fits is taken back.
    if (s.pending.ante && this.validate(s.pending, s.balance)) { s.pending = { ...NO_BETS }; s.ready = false; s.autoRebet = null; }
    this.say(r.debt
      ? `${s.name} pays ${formatMoney(r.paid)} on their markers. Still owes ${formatMoney(r.debt)} — ${item.replace(/^your /, 'their ')} stays at the pawn shop.`
      : `${s.name} pays off all ${formatMoney(r.paid)} in markers and gets ${item.replace(/^your /, 'their ')} back from the pawn shop. Debt free!`);
    await this.checkStart();
    return { balance: r.balance, debt: r.debt, paid: r.paid };
  }

  async setPrefs(pid: string, p: { timeoutPolicy?: 'default' | 'strategy'; sitOut?: boolean; autoRebet?: boolean }) {
    const s = this.requireSeat(pid);
    if (p.timeoutPolicy === 'default' || p.timeoutPolicy === 'strategy') s.timeoutPolicy = p.timeoutPolicy;
    if (p.autoRebet === false) s.autoRebet = null;
    if (p.autoRebet === true) {
      // The bet to repeat: what's on the layout now, otherwise the last bet you played.
      const bet = s.pending.ante ? { ...s.pending } : s.lastBet ? { ...s.lastBet } : null;
      if (!bet) throw new EngineError('Place a bet first, then turn on Same bet every hand.');
      const err = this.validate(bet, s.balance);
      if (err) throw new EngineError(err);
      s.autoRebet = bet;
      if (this.phase === 'betting' && !s.sitOut && !s.ready) { s.pending = { ...bet }; s.ready = true; await this.checkStart(); }
    }
    if (typeof p.sitOut === 'boolean') {
      if (s.sitOut === p.sitOut && !s.awayByHost) return;
      const inHand = !!this.hand && !this.hand.settled && this.hand.players.has(pid);
      s.sitOut = p.sitOut; s.awayByHost = false;
      // Mid-hand, sitting out takes effect from the next hand; the current hand plays out normally.
      if (p.sitOut) { s.ready = false; s.pending = { ...NO_BETS }; }
      this.say(p.sitOut ? `${s.name} is sitting out${inHand ? ' after this hand' : ''}.` : `${s.name} sits back in.`, 'system');
      if (!p.sitOut) this.roast.onSitBack(s.playerId, s.name);
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
    this.say(away ? `The host set ${s.name} away${live}. They can tap Sit back in whenever they’re ready.` : `The host brought ${s.name} back in.`, 'system');
    await this.checkStart();
  }

  // ------------------------------------------------------------------ game switching
  /** Queued switch, applied between hands. */
  pendingGame: GameId | null = null;
  private pendingGameBy = '';

  /** Host picks the casino game. Never mid-hand: during a hand the switch waits until the hand has fully settled. */
  async setGame(hostId: string, game: unknown): Promise<{ queued: boolean }> {
    this.requireHost(hostId);
    if (game !== 'uth' && game !== 'tcp' && game !== 'bj') throw new EngineError('Unknown game.');
    const by = this.seatOf(hostId)?.name ?? 'The host';
    const live = !!this.hand;     // a hand that is dealt, being decided, settling, or showing results
    if (this.pendingGame) {
      if (game === this.config.game) { this.pendingGame = null; this.say(`${by} cancelled the switch — staying with ${GAME_NAME[game]}.`, 'system'); return { queued: false }; }
      throw new EngineError(`A switch to ${GAME_NAME[this.pendingGame]} is already queued for after this hand.`);
    }
    if (game === this.config.game) throw new EngineError(`The table is already playing ${GAME_NAME[game]}.`);
    if (live) {
      this.pendingGame = game; this.pendingGameBy = by;
      this.say(`${by} is switching the table to ${GAME_NAME[game]} after this hand. Everyone keeps their seat and chips.`, 'system');
      return { queued: true };
    }
    this.pendingGameBy = by;
    await this.applyGame(game);
    return { queued: false };
  }

  private async applyGame(game: GameId) {
    this.pendingGame = null;
    if (game === this.config.game) return;
    this.clearTimer();
    // Release uncommitted bets, Ready states and presets that belong to the other game.
    for (const s of this.seats) if (s) { s.pending = { ...NO_BETS }; s.ready = false; s.lastBet = null; s.autoRebet = null; }
    this.config = { ...this.config, game };
    await this.store.updateTable(this.code, { config: this.config });
    this.say(`${this.pendingGameBy || 'The host'} changed the table to ${GAME_NAME[game]}.`);
    if (game === 'tcp') this.say('Three Card Poker: place an Ante (and Pair Plus or Six Card Bonus if you like). Dealer qualifies with Queen high or better.');
    if (game === 'bj') { this.resetShoe(); this.say(`Blackjack: one bet each, then take turns in seat order. ${rulesSummary(this.bjRules).slice(0, 3).join('. ')}.`); }
  }

  /** Host ends the night: the running tab becomes a recap and the next hand starts a new night. */
  async endNight(hostId: string) {
    this.requireHost(hostId);
    if (this.hand && !this.hand.settled) throw new EngineError('Finish this hand first.');
    const n = await this.store.endNight(this.code);
    if (!n) throw new EngineError('No hands have been played tonight yet.');
    this.nightId = null;
    this.say(`That’s the night! ${n.hands} hand${n.hands === 1 ? '' : 's'} played. The recap is up — the next hand starts a new night.`);
    this.hooks.nightEnded(n.id);
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
  async setTheme(hostId: string, p: { felt?: unknown; cardBack?: unknown; effects?: unknown }) {
    this.requireHost(hostId);
    const c = { ...this.config };
    if (p.felt !== undefined) { if (!isFelt(p.felt)) throw new EngineError('Unknown felt.'); c.felt = p.felt; }
    if (p.cardBack !== undefined) { if (!isBack(p.cardBack)) throw new EngineError('Unknown card back.'); c.cardBack = p.cardBack; }
    if (p.effects !== undefined) { if (!isEffects(p.effects)) throw new EngineError('Unknown effects level.'); c.effects = p.effects; }
    if (c.felt === this.config.felt && c.cardBack === this.config.cardBack && c.effects === this.config.effects) return;
    const msg = c.effects !== this.config.effects ? `The host set cosmetic effects to ${EFFECTS.find((x) => x.id === c.effects)!.name}.` : c.felt !== this.config.felt ? `The host changed the felt to ${FELTS.find((f) => f.id === c.felt)!.name}.`
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
    if (p.minAnte !== undefined) c.minAnte = int(p.minAnte, 100, 100_000_000, 'minimum ante');
    if (p.maxAnte !== undefined) c.maxAnte = int(p.maxAnte, 100, 100_000_000, 'maximum ante');
    if (p.maxTrips !== undefined) c.maxTrips = int(p.maxTrips, 0, 1_000_000, 'Trips+ limit');
    if (p.maxPairs !== undefined) c.maxPairs = int(p.maxPairs, 0, 1_000_000, 'Ultimate Pairs limit');
    if (p.maxBadBeat !== undefined) c.maxBadBeat = int(p.maxBadBeat, 0, 1_000_000, 'Bad Beat limit');
    if (p.maxPairPlus !== undefined) c.maxPairPlus = int(p.maxPairPlus, 0, 1_000_000, 'Pair Plus limit');
    if (p.maxSixCard !== undefined) c.maxSixCard = int(p.maxSixCard, 0, 1_000_000, 'Six Card Bonus limit');
    if (p.pairsVariant !== undefined) { if (!isPairsVariant(p.pairsVariant)) throw new EngineError('Unknown Ultimate Pairs pay table.'); c.pairsVariant = p.pairsVariant; }
    if (p.progressive !== undefined) c.progressive = !!p.progressive;
    const surrenderChanged = p.bjSurrender !== undefined && !!p.bjSurrender !== !!c.bjSurrender;
    if (p.bjSurrender !== undefined) c.bjSurrender = !!p.bjSurrender;
    if (p.badBeatVariant !== undefined) { if (!isBadBeatVariant(p.badBeatVariant)) throw new EngineError('Unknown Bad Beat pay table.'); c.badBeatVariant = p.badBeatVariant; }
    if (p.startingBankroll !== undefined) c.startingBankroll = int(p.startingBankroll, 1000, 100_000_000_000, 'starting bankroll');
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
    if (surrenderChanged) this.say(`Blackjack rule change: late surrender is now ${c.bjSurrender ? 'allowed' : 'off'}, starting next hand.`);
    if (pairsChanged) this.say(`Pay table change: Ultimate Pairs is now ${PAIRS_VARIANTS[c.pairsVariant].name}, starting next hand.`);
    if (progressiveChanged) this.say(c.progressive ? 'The $5 Progressive is now open at this table, starting next hand.' : 'The $5 Progressive is closed at this table, starting next hand.');
    if (badBeatChanged) this.say(`Pay table change: Bad Beat is now ${BAD_BEAT_VARIANTS[c.badBeatVariant].name}, starting next hand.`);
    for (const s of this.seats) if (s && s.pending.ante && this.validate(s.pending, s.balance)) {
      s.pending = { ...NO_BETS }; s.ready = false;
    }
    this.say('The host updated the table settings.', 'system');
  }

  // ------------------------------------------------------------------ views (per-viewer redaction)
  // ================================================================== §27 Blackjack
  /** Six-deck shoe order (card ids 0–51, each six times). Replaced by tests; default is a secure shuffle. */
  shoeShuffle: () => number[] = () => { const d: number[] = []; for (let k = 0; k < DEFAULT_BJ_RULES.decks; k++) d.push(...orderedDeckIds()); return secureShuffleIds(d); };
  private shoe: { cards: number[]; pos: number; cut: number; discards: number; id: string; commitment: string } | null = null;
  /** Cards dealt in the current round (for discards, and so an exhausted shoe never duplicates a card on the table). */
  private roundCards: number[] = [];
  get bjRules(): BjRules { return { ...DEFAULT_BJ_RULES, lateSurrender: !!this.config.bjSurrender }; }
  /** Throw away the shoe; the next round starts a freshly shuffled one. */
  resetShoe() { this.shoe = null; }
  private newShoe(exclude: number[] = []) {
    const r = this.bjRules;
    let cards = this.shoeShuffle();
    const counts = new Map<number, number>();
    for (const c of cards) counts.set(c, (counts.get(c) ?? 0) + 1);
    if (cards.length !== r.decks * 52 || counts.size !== 52 || [...counts.values()].some((n) => n !== r.decks)) throw new Error('Corrupt shoe');
    for (const x of exclude) { const i = cards.indexOf(x); if (i >= 0) cards = [...cards.slice(0, i), ...cards.slice(i + 1)]; }
    const id = newId();
    this.shoe = { cards, pos: 0, cut: Math.floor(r.decks * 52 * r.penetration), discards: 0, id, commitment: sha256(cards.map(intToCard).join('') + ':' + id) };
  }
  private draw(): number {
    if (!this.shoe || this.shoe.pos >= this.shoe.cards.length) {
      // Exhausted mid-round (very rare): a new shoe made of every card that isn't on the table right now,
      // so nothing on the felt is duplicated and nothing is revealed.
      this.newShoe(this.roundCards);
      this.say('The shoe ran out — the dealer shuffles the discards into a fresh shoe.');
    }
    const c = this.shoe!.cards[this.shoe!.pos++];
    this.roundCards.push(c);
    return c;
  }
  private bjp(pid: string) { const h = this.hp(pid); return h?.bj ? h : null; }
  private canAfford(h: HandPlayer, amount: number) { return (this.seats[h.seat]?.balance ?? 0) >= amount; }

  private async dealBj(players: Seat[]) {
    const r = this.bjRules;
    if (!this.shoe || this.shoe.pos >= this.shoe.cut) {
      this.newShoe();
      this.say(`A fresh ${r.decks}-deck shoe is shuffled. The cut card goes in about ${Math.round(r.penetration * 100)}% deep.`);
    }
    this.roundCards = [];
    const holes = new Map<string, number[]>();
    for (const s of players) holes.set(s.playerId, []);
    const dealer: number[] = [];
    for (let round = 0; round < 2; round++) {
      for (const s of players) holes.get(s.playerId)!.push(this.draw());
      dealer.push(this.draw());
    }
    const id = newId();
    const number = this.handCounter + 1;
    const night = await this.store.openNight(this.code, NIGHT_IDLE_MS, this.freshNight);
    if (night.id !== this.nightId) this.say(this.freshNight || !this.nightId ? 'A new night begins. Good luck, everyone.' : 'Welcome back — a new night begins.');
    this.freshNight = false;
    this.nightId = night.id;
    const { balances } = await this.store.startHand({
      nightId: night.id, rulesVersion: BJ_RULES_VERSION, game: 'bj', id, tableCode: this.code, handNumber: number,
      deckCommitment: `${this.shoe!.commitment}@${this.shoe!.pos - this.roundCards.length}`,
      dealerCards: dealer.map(intToCard), community: [],
      pairsVariant: this.config.pairsVariant, badBeatVariant: this.config.badBeatVariant,
      players: players.map((s) => ({ playerId: s.playerId, seat: s.seat, name: s.name, hole: holes.get(s.playerId)!.map(intToCard),
        ante: s.pending.ante, blind: 0, trips: 0, pairs: 0, badBeat: 0, progressive: 0, pairPlus: 0, sixCard: 0 })),
    });
    this.handCounter = number;
    const map = new Map<string, HandPlayer>();
    for (const s of players) {
      s.balance = balances.get(s.playerId)!;
      s.lastBet = { ...s.pending };
      const hole = holes.get(s.playerId)!;
      map.set(s.playerId, { playerId: s.playerId, seat: s.seat, name: s.name, hole,
        ante: s.pending.ante, blind: 0, trips: 0, pairs: 0, badBeat: 0, progressive: 0, pairPlus: 0, sixCard: 0,
        play: 0, folded: false, acted: false, decisions: [],
        bj: { hands: [newHand(hole.map(intToCard), s.pending.ante)], active: 0, insurance: null, offered: false, extra: 0, n: 0 } });
    }
    this.hand = { id, number, dealer, community: [], revealed: 0, players: map, settled: false, game: 'bj', bj: { turn: null, holeShown: false, order: [] } };
    for (const s of this.seats) if (s) s.ready = false;
    const up = intToCard(dealer[0]);
    this.say(`Hand #${number} — Blackjack. ${players.length} player${players.length > 1 ? 's' : ''} in. Dealer shows ${up[0] === 'T' ? '10' : up[0]}.`);
    this.chatter('deal');
    if (up[0] === 'A' && r.insurance) {
      this.phase = 'insurance';
      for (const h of map.values()) h.bj!.offered = true;
      this.say('Insurance? Up to half your bet, pays 2:1 if the dealer has blackjack.');
      this.armTimer(this.timing.dealMs, () => this.bjInsuranceTimeout());
      for (const h of map.values()) if (!this.seats[h.seat] || this.seats[h.seat]!.leaving) await this.bjInsure(h, 0, true);
      return;
    }
    await this.bjPeek();
  }

  /** Arm the decision clock (none in untimed solo play). */
  private armTimer(extraMs: number, onTimeout: () => Promise<void>) {
    if (this.config.decisionSeconds > 0) {
      const ms = extraMs + this.config.decisionSeconds * 1000;
      this.deadline = this.now() + ms;
      this.setTimer(ms, onTimeout);
    } else { this.deadline = null; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  }

  private async bjInsure(h: HandPlayer, amount: number, timedOut = false) {
    const b = h.bj!;
    if (this.phase !== 'insurance' || !b.offered || b.insurance !== null) throw new EngineError('Insurance isn’t open.');
    const max = maxInsurance(h.ante);
    if (!Number.isInteger(amount) || amount < 0 || amount > max) throw new EngineError(`Insurance is up to half your bet (${formatMoney(max)}).`);
    if (amount && !this.canAfford(h, amount)) throw new EngineError('Not enough chips for insurance.');
    if (amount) {
      const bal = await this.store.extraWager(this.hand!.id, h.playerId, this.code, amount, `${this.hand!.id}:${h.playerId}:insurance`, { extra: b.extra, insurance: amount });
      if (bal !== null) { const s = this.seats[h.seat]; if (s) s.balance = bal; }
    }
    b.insurance = amount;
    const rec: DecisionRecord = { phase: 'bj-ins' as DecisionPhase, action: (amount ? 'insure' : 'no-insurance') as Decision, recommended: 'no-insurance' as Decision,
      correct: !amount, reason: insuranceAdvice.reason, timedOut, graded: true,
      evCost: amount ? +insuranceEvCost(amount, h.ante).toFixed(4) : 0, evCostCents: amount ? Math.round(amount / 13) : 0, evExact: false };
    h.decisions.push(rec);
    await this.store.recordDecision(this.hand!.id, h.playerId, rec, { play: 0, folded: false });
    this.say(amount ? `${h.name} takes insurance (${formatMoney(amount)}).` : timedOut ? `${h.name} — no insurance (auto).` : `${h.name} declines insurance.`);
    if ([...this.hand!.players.values()].every((x) => x.bj!.insurance !== null)) { this.clearTimer(); await this.bjPeek(); }
  }
  private async bjInsuranceTimeout() {
    if (this.phase !== 'insurance') return;
    for (const h of this.hand!.players.values()) if (h.bj!.insurance === null) await this.bjInsure(h, 0, true);
  }

  /** Dealer checks for blackjack with an Ace or ten showing. A dealer blackjack ends the round at once. */
  private async bjPeek() {
    const hand = this.hand!;
    const up = intToCard(hand.dealer[0]);
    const dealerCards = hand.dealer.map(intToCard);
    if (this.bjRules.peek && (up[0] === 'A' || bjValueTen(up))) {
      if (isNatural(dealerCards, false)) {
        hand.bj!.holeShown = true;
        this.phase = 'showdown';
        this.say('The dealer has blackjack.');
        this.setTimer(this.timing.revealMs, () => this.bjSettle());
        return;
      }
      this.say('The dealer checks — no blackjack.');
    }
    await this.bjStartTurns();
  }

  private async bjStartTurns() {
    const hand = this.hand!;
    hand.bj!.order = [...hand.players.values()].sort((a, b) => a.seat - b.seat).map((h) => h.playerId);
    this.phase = 'turns';
    hand.bj!.turn = null;
    await this.bjAdvanceTurn();
  }

  /** Move to the next hand that needs a decision (drawing split hands' second cards as they come up). */
  private async bjAdvanceTurn() {
    const hand = this.hand!;
    const r = this.bjRules;
    for (const pid of hand.bj!.order) {
      const h = hand.players.get(pid)!;
      const b = h.bj!;
      for (let i = 0; i < b.hands.length; i++) {
        const x = b.hands[i];
        if (x.done) continue;
        if (x.cards.length === 1) x.cards.push(intToCard(this.draw()));
        const t = bjTotal(x.cards);
        if (t.bust || t.total === 21 || (x.splitAces && r.splitAcesOneCard) || isNatural(x.cards, x.fromSplit)) { x.done = true; continue; }
        b.active = i;
        const changed = hand.bj!.turn !== pid;
        hand.bj!.turn = pid;
        const s = this.seats[h.seat];
        if (changed && b.hands.length === 1) this.say(`${h.name}, your move — ${describeTotal(x.cards)}.`);
        if (!s || s.leaving) { await this.bjApply(h, 'stand', true); return; }
        this.armTimer(0, () => this.bjTimeout());
        return;
      }
    }
    hand.bj!.turn = null;
    await this.bjDealer();
  }
  private async bjTimeout() {
    const pid = this.hand?.bj?.turn;
    if (this.phase !== 'turns' || !pid) return;
    await this.bjApply(this.hand!.players.get(pid)!, 'stand', true);
  }

  /** Actions for the player's active hand right now (affordability applied). */
  private bjActions(h: HandPlayer): BjAction[] {
    const b = h.bj!;
    if (this.phase !== 'turns' || this.hand?.bj?.turn !== h.playerId) return [];
    const x = b.hands[b.active];
    return legalActions(x, b.hands.length, this.bjRules, this.canAfford(h, h.ante));
  }

  async bjAct(pid: string, actionId: string, handId: string, action: BjAct, handIdx?: number, amount?: number) {
    const s = this.requireSeat(pid);
    if (this.dedupe(s, actionId)) return;
    const h = this.bjp(pid);
    if (!h || this.hand!.id !== handId) throw new EngineError('That round is over.');
    if (action === 'insure' || action === 'no-insurance') {
      return this.bjInsure(h, action === 'insure' ? (amount ?? maxInsurance(h.ante)) : 0);
    }
    if (this.hand!.bj!.turn !== pid) throw new EngineError('It isn’t your turn.');
    if (handIdx !== undefined && handIdx !== h.bj!.active) throw new EngineError('That hand isn’t the one in play.');
    if (!this.bjActions(h).includes(action as BjAction)) throw new EngineError(action === 'double' || action === 'split' ? 'Not available — it needs another bet equal to your original wager, and the right cards.' : 'That move isn’t allowed now.');
    await this.bjApply(h, action as BjAction, false);
  }

  private async bjApply(h: HandPlayer, action: BjAction, timedOut: boolean) {
    const hand = this.hand!, b = h.bj!, x = b.hands[b.active];
    const available = legalActions(x, b.hands.length, this.bjRules, this.canAfford(h, h.ante));
    if (!available.includes(action)) action = 'stand';
    // Grade against the same rules and the same affordability the player faced (§31: constrained = ungraded).
    const adv = bjAdvice(x, intToCard(hand.dealer[0]), available, this.bjRules, b.hands.length);
    const rec: DecisionRecord = {
      phase: `bj-${++b.n}` as DecisionPhase, action: action as Decision, recommended: adv.best as Decision,
      correct: action === adv.best, reason: `${adv.reason}${b.hands.length > 1 ? ` (hand ${b.active + 1} of ${b.hands.length})` : ''}`,
      timedOut, graded: !adv.constrained,
    };
    if (rec.graded) {
      const cost = bjEvCost(x, intToCard(hand.dealer[0]), action, adv.best, this.bjRules);
      rec.evCost = +cost.toFixed(4); rec.evCostCents = Math.round(cost * h.ante); rec.evExact = false;
    }
    h.decisions.push(rec);
    await this.store.recordDecision(hand.id, h.playerId, rec, { play: 0, folded: false });
    // §32: verified blunders only (the strategy engine graded it and it wasn't forced by money).
    const blunder: 'hit20' | 'split10' | null = rec.graded && !rec.correct
      ? action === 'hit' && bjTotal(x.cards).total === 20 ? 'hit20'
      : action === 'split' && cardValue(x.cards[0]) === 10 && cardValue(x.cards[1]) === 10 ? 'split10' : null : null;
    if (blunder) b[blunder] = true;
    const pay = async (key: string) => {
      b.extra += h.ante;
      const bal = await this.store.extraWager(hand.id, h.playerId, this.code, h.ante, `${hand.id}:${h.playerId}:${key}`, { extra: b.extra, insurance: b.insurance ?? 0 });
      if (bal !== null) { const s = this.seats[h.seat]; if (s) s.balance = bal; }
    };
    const who = b.hands.length > 1 ? `${h.name} (hand ${b.active + 1})` : h.name;
    switch (action) {
      case 'hit': {
        x.cards.push(intToCard(this.draw()));
        const t = bjTotal(x.cards);
        if (t.bust) { x.done = true; this.say(`${who} hits — busts with ${t.total}.`); }
        else if (t.total === 21) { x.done = true; this.say(`${who} hits — 21.`); }
        break;
      }
      case 'stand': x.done = true; this.say(`${who} stands on ${describeTotal(x.cards, x.fromSplit)}${timedOut ? ' (auto)' : ''}.`); break;
      case 'double': {
        await pay(`double${b.active}`);
        x.bet *= 2; x.doubled = true;
        x.cards.push(intToCard(this.draw()));
        x.done = true;
        this.say(`${who} doubles down — ${describeTotal(x.cards, x.fromSplit)}.`);
        break;
      }
      case 'split': {
        await pay(`split${b.hands.length}`);
        const aces = x.cards[0][0] === 'A';
        const [c1, c2] = x.cards;
        b.hands.splice(b.active, 1, newHand([c1], h.ante, true, aces), newHand([c2], h.ante, true, aces));
        this.say(`${h.name} splits ${c1[0] === 'T' ? '10' : c1[0]}s — now ${b.hands.length} hands.`);
        if (aces && this.bjRules.splitAcesOneCard) for (const y of b.hands.slice(b.active, b.active + 2)) { y.cards.push(intToCard(this.draw())); y.done = true; }
        break;
      }
      case 'surrender': x.surrendered = true; x.done = true; this.say(`${who} surrenders — half the bet back.`); break;
    }
    if (blunder) this.roast.midHand(h.playerId, h.name, blunder, '20');
    this.clearTimer();
    await this.bjAdvanceTurn();
  }

  /** Dealer reveals and draws by the house rule, only if any player hand is still live. */
  private async bjDealer() {
    const hand = this.hand!;
    hand.bj!.holeShown = true;
    this.phase = 'showdown';
    const all = [...hand.players.values()].flatMap((h) => h.bj!.hands);
    const before = hand.dealer.length;
    if (dealerMustPlay(all)) {
      const final = dealerPlay(hand.dealer.map(intToCard), () => intToCard(this.draw()), this.bjRules);
      hand.dealer = final.map(cardToIntLocal);
    }
    const d = hand.dealer.map(intToCard);
    this.say(`Dealer turns over ${describeTotal(d.slice(0, 2))}${hand.dealer.length > before ? `, draws to ${describeTotal(d)}` : ''}.`);
    this.setTimer(this.timing.revealMs, () => this.bjSettle());
  }

  private async bjSettle() {
    const hand = this.hand!;
    if (hand.settled) return;
    const dealer = hand.dealer.map(intToCard);
    const r = this.bjRules;
    const players = [...hand.players.values()];
    for (const h of players) {
      const b = h.bj!;
      b.results = b.hands.map((x) => settleBjHand(x, dealer, r));
      const ins = settleInsurance(b.insurance ?? 0, dealer);
      b.insuranceNet = ins.net;
      b.net = b.results.reduce((t, x) => t + x.net, 0) + ins.net;
    }
    const dealerName = describeTotal(dealer);
    const rows = players.map((h) => {
      const b = h.bj!;
      const credit = b.results!.reduce((t, x) => t + x.credit, 0) + settleInsurance(b.insurance ?? 0, dealer).credit;
      const net = b.net!;
      const outcome = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
      const handName = b.hands.length > 1 ? `${b.hands.length} hands` : b.results![0].total;
      const settlement = { game: 'bj', hands: b.hands.map((x, i) => ({ ...x, ...b.results![i] })), insurance: b.insurance ?? 0, insuranceNet: b.insuranceNet, dealer, net };
      return {
        playerId: h.playerId, credit, net, outcome, handName, handRank: 0, tripsNet: 0, play: b.extra, folded: false, settlement,
        pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null, badBeatMultiplier: null,
        pairsVariant: null, badBeatVariant: null, baseNet: net - (b.insuranceNet ?? 0), progressiveNet: 0, progressiveHand: null,
      } as PlayerSettlementRow;
    });
    const res = await this.store.settleHand(hand.id, this.code, { hand: dealerName, qualifies: true }, (meter) => ({ jackpotAfter: meter, hits: [], rows }));
    if (!res.applied) console.warn(`[engine] hand ${hand.id} was already settled — skipping payout`);
    for (const [pid, bal] of res.balances) { const s = this.seatOf(pid); if (s) s.balance = bal; }
    hand.settled = true;
    if (res.applied) this.hooks.settled?.(hand.id, this.nightId, [...hand.players.keys()]);
    this.phase = 'settled';
    this.deadline = null;
    this.say(`Dealer: ${dealerName}. ${players.map((h) => `${h.name} ${formatMoney(h.bj!.net!, { sign: true })}`).join(' · ')}`);
    for (const h of players) {
      const bjs = h.bj!.results!.filter((x) => x.outcome === 'blackjack');
      if (bjs.length) this.say(`${h.name}: Blackjack pays 3:2 (${formatMoney(bjs[0].net, { sign: true })}).`);
      if (h.bj!.insurance) this.say(`${h.name}: Insurance ${h.bj!.insuranceNet! > 0 ? `pays 2:1 (${formatMoney(h.bj!.insuranceNet!, { sign: true })})` : 'loses'}.`);
    }
    if (res.applied) this.countRound(players.map((h) => ({ pid: h.playerId, name: h.name, net: h.bj!.net!, opening: h.ante })), 0);
    if (res.applied) this.afterSettle(this.roundFacts(hand, describeTotal(hand.dealer.map(intToCard)), []));
    this.recent.unshift({
      handId: hand.id, handNumber: hand.number, at: this.now(), dealerHand: dealerName, dealerQualifies: true,
      players: players.sort((a, b) => a.seat - b.seat).map((h) => ({ name: h.name, net: h.bj!.net!, outcome: h.bj!.net! > 0 ? 'win' : h.bj!.net! < 0 ? 'lose' : 'push',
        handName: h.bj!.hands.length > 1 ? `${h.bj!.hands.length} hands` : h.bj!.results![0].total, sideHits: [] })),
    } as never);
    this.recent = this.recent.slice(0, 15);
    for (const h of players) this.hooks.analysis(h.playerId, { handId: hand.id, decisions: h.decisions });
    this.setTimer(this.timing.resultsMs, () => this.nextRound());
  }

  private bjView(viewerId: string): BjTableView | null {
    if (this.config.game !== 'bj' && this.hand?.game !== 'bj') return null;
    const r = this.bjRules;
    const hand = this.hand?.game === 'bj' ? this.hand : null;
    const me = hand ? this.bjp(viewerId) : null;
    const turnH = hand?.bj?.turn ? hand.players.get(hand.bj.turn) : null;
    let actions: BjAct[] = [];
    let advice: BjTableView['advice'] = null;
    if (me && this.phase === 'insurance' && me.bj!.offered && me.bj!.insurance === null) {
      actions = this.canAfford(me, maxInsurance(me.ante)) && maxInsurance(me.ante) > 0 ? ['insure', 'no-insurance'] : ['no-insurance'];
      advice = { best: 'no-insurance', reason: insuranceAdvice.reason, constrained: false };
    } else if (me) {
      actions = this.bjActions(me);
      if (actions.length) {
        const a = bjAdvice(me.bj!.hands[me.bj!.active], intToCard(hand!.dealer[0]), actions as BjAction[], r, me.bj!.hands.length);
        advice = { best: a.best, reason: a.reason, constrained: a.constrained };
      }
    }
    const sh = this.shoe;
    return {
      rules: r, rulesText: rulesSummary(r),
      turn: turnH ? { playerId: turnH.playerId, seat: turnH.seat, hand: turnH.bj!.active } : null,
      dealerTotal: hand ? (hand.bj!.holeShown ? describeTotal(hand.dealer.map(intToCard)) : describeTotal([intToCard(hand.dealer[0])])) : null,
      shoe: { total: sh?.cards.length ?? r.decks * 52, dealt: sh?.pos ?? 0, cut: sh?.cut ?? Math.floor(r.decks * 52 * r.penetration), discards: sh?.discards ?? 0 },
      actions, insuranceMax: me ? maxInsurance(me.ante) : 0, advice,
    };
  }
  private seatBj(h: HandPlayer): SeatBj {
    const b = h.bj!;
    const live = this.phase === 'turns' && this.hand?.bj?.turn === h.playerId;
    return {
      hands: b.hands.map((x, i) => ({ cards: x.cards, bet: x.bet, doubled: x.doubled, fromSplit: x.fromSplit, total: describeTotal(x.cards, x.fromSplit), done: x.done,
        surrendered: x.surrendered, outcome: b.results?.[i].outcome, net: b.results?.[i].net })),
      active: live ? b.active : null, insurance: b.insurance, insuranceNet: b.results ? b.insuranceNet : undefined, offered: b.offered,
    };
  }

  viewFor(viewerId: string): TableView {
    const hand = this.hand;
    const showdown = !!hand?.settled;
    const C = (n: number) => intToCard(n);
    const community: (string | null)[] = hand && hand.game === 'uth' ? hand.community.map((c, i) => (i < hand.revealed || showdown ? C(c) : null)) : [];
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
      dealer: hand?.game === 'bj' ? { cards: hand.dealer.map((c, i) => (i === 0 || hand.bj!.holeShown ? C(c) : null)), handName: this.bjView(viewerId)?.dealerTotal ?? undefined }
        : dealerShown ? (hand.game === 'tcp' ? {
        cards: hand.dealer.map(C), handName: tcpDescribe(hand.dealerScore!), qualifies: tcpQualifies(hand.dealerScore!), best5: hand.dealer.map(C),
      } : {
        cards: hand.dealer.map(C), handName: handName(hand.dealerScore!),
        qualifies: hand.players.size ? [...hand.players.values()][0].settlement?.dealerQualifies : undefined,
        best5: bestFive([...hand.dealer, ...hand.community]).map(C),
      }) : { cards: hand ? hand.dealer.map(() => null) : [] },
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
        canReload: !!me && !this.inActiveHand(viewerId) && me.balance < this.minToPlay(),
        timeoutPolicy: me?.timeoutPolicy ?? 'default',
        autoRebet: me?.autoRebet ?? null,
      },
      recent: this.recent,
      jackpot: { amount: this.hooks.jackpotAmount(), wager: PROGRESSIVE.wager },
      nightId: this.nightId, rulesVersion: this.config.game === 'tcp' ? TCP_RULES_VERSION : RULES_VERSION,
      pendingGame: this.pendingGame,
      house: this.houseView(),
      bj: this.bjView(viewerId),
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
    const result: SeatResult | undefined = h?.bj?.results ? {
      outcome: (h.bj.net! > 0 ? 'win' : h.bj.net! < 0 ? 'lose' : 'push') as SeatResult['outcome'], net: h.bj.net!, handName: h.bj.hands.length > 1 ? `${h.bj.hands.length} hands` : h.bj.results[0].total,
      lines: [...h.bj.results.map((x) => ({ wager: 'ante' as const, result: x.outcome, net: x.net, stake: x.bet, credit: x.credit })),
        ...(h.bj.insurance ? [{ wager: 'play' as const, result: h.bj.insuranceNet! > 0 ? 'win' : 'lose', net: h.bj.insuranceNet!, stake: h.bj.insurance, credit: h.bj.insuranceNet! > 0 ? h.bj.insurance * 3 : 0, note: 'Insurance' }] : [])],
      baseNet: h.bj.net! - (h.bj.insuranceNet ?? 0), sideNet: h.bj.insuranceNet ?? 0,
    } : h?.tcp ? {
      outcome: h.tcp.outcome, net: h.tcp.net, handName: h.tcp.playerHand, best5: h.hole.map(intToCard),
      lines: (['ante', 'play', 'anteBonus', 'pairPlus', 'sixCard'] as const).filter((k) => h.tcp![k].stake > 0 || h.tcp![k].result === 'win')
        .map((k) => { const w = h.tcp![k]; return { wager: k, result: w.result, net: w.net, stake: w.stake, credit: w.credit, note: w.note, multiplier: w.multiplier, combo: w.combo }; }),
      baseNet: h.tcp.baseNet, sideNet: h.tcp.sideNet,
    } : h?.settlement ? {
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
      seat: s.seat, playerId: s.playerId, name: s.name, avatar: s.avatar, look: this.looks.get(s.playerId), balance: s.balance, connected: s.connected,
      isHost: s.playerId === this.hostId, status,
      bet: h ? { ante: h.ante, blind: h.blind, trips: h.trips, play: h.play, pairs: h.pairs, badBeat: h.badBeat, progressive: h.progressive, pairPlus: h.pairPlus, sixCard: h.sixCard }
             : { ante: s.pending.ante, blind: this.config.game === 'tcp' ? 0 : s.pending.ante, trips: s.pending.trips, play: 0, pairs: s.pending.pairs,
                 badBeat: s.pending.badBeat, progressive: s.pending.progressive, pairPlus: s.pending.pairPlus, sixCard: s.pending.sixCard },
      acted: !!h && !this.needsToAct(h), needsToAct: !!h && this.needsToAct(h), lastAction: h?.lastAction,
      cards: h ? (h.bj ? h.bj.hands[0].cards : canSee ? h.hole.map(intToCard) : h.hole.map(() => null)) : [],
      bj: h?.bj ? this.seatBj(h) : undefined,
      handName: h?.bj ? describeTotal(h.bj.hands[0].cards, h.bj.hands[0].fromSplit) : h && canSee ? (this.hand!.game === 'tcp' ? tcpDescribe(evaluate3(h.hole)) : handName(evaluate([...h.hole, ...visible]))) : undefined,
      result,
      debt: s.debt || undefined,
      pawned: s.debt ? s.pawned ?? undefined : undefined,
      leaving: s.leaving, standingUp: s.standingUp || undefined, awayByHost: s.awayByHost || undefined, sitOut: s.sitOut || undefined,
    };
  }

  /** Decisions for the viewer's current hand (for Challenge-mode grading after settlement). */
  decisionsFor(pid: string) { return this.hp(pid)?.decisions ?? []; }

  listing() {
    return {
      code: this.code, name: this.config.name, seated: this.seatedCount(), maxSeats: this.config.maxSeats,
      minAnte: this.config.minAnte, maxAnte: this.config.maxAnte, inHand: !!this.hand && !this.hand.settled,
      allowSpectators: this.config.allowSpectators, game: this.config.game,
      players: this.seats.filter((s): s is Seat => !!s).map((s) => ({ name: s.name, look: this.looks.get(s.playerId) })),
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
