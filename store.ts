// Persistence interface. Two implementations: PgStore (production, PostgreSQL) and MemoryStore
// (zero-config local dev and fast tests). Both enforce the same invariants:
//   * every balance change is a ledger row with a unique tx_key (idempotent),
//   * balances never go negative,
//   * a hand is settled at most once.

import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import type { NightHand } from '../shared/recap.js';
import type { GameId } from '../shared/rules.js';

export interface PlayerRow { id: string; name: string; avatar: string }
export interface StackRow { balance: number; reloads: number; debt: number }
export interface TableRow { code: string; hostId: string; config: TableConfig; handCounter: number; closed: boolean }

export interface HandStartPlayer {
  playerId: string; seat: number; name: string; hole: string[];
  ante: number; blind: number; trips: number; pairs: number; badBeat: number; progressive: number;
  pairPlus?: number; sixCard?: number;
}
export interface HandStart {
  id: string; tableCode: string; handNumber: number; deckCommitment: string;
  dealerCards: string[]; community: string[]; players: HandStartPlayer[];
  pairsVariant: string; badBeatVariant: string;
  nightId: string; rulesVersion: string;
  game?: GameId;
}
export interface DebtEvent { id: number; playerId: string; name: string; kind: 'marker' | 'payoff'; amount: number; debtAfter: number; item: string; at: number }
export interface NightRow { id: string; tableCode: string; startedAt: number; endedAt: number | null; hands: number }
export interface PlayerSettlementRow {
  playerId: string; credit: number; net: number; outcome: string; handName: string; handRank: number;
  tripsNet: number; play: number; folded: boolean; settlement: unknown;
  pairsNet: number; badBeatNet: number; pairsCombo: string | null; badBeatCombo: string | null;
  pairsMultiplier: number | null; badBeatMultiplier: number | null;
  pairsVariant: string | null; badBeatVariant: string | null; baseNet: number;
  progressiveNet: number; progressiveHand: string | null;
  pairPlusNet?: number; sixCardNet?: number; anteBonusNet?: number; pairPlusHand?: string | null; sixCardHand?: string | null;
}

export interface SideBetStats {
  bets: number; wins: number; wagered: number; returned: number; net: number; biggestPayout: number;
  combos: { combo: string; count: number }[];
}

export interface PlayerStats {
  hands: number; net: number; wins: number; losses: number; pushes: number; folds: number;
  biggestWin: number; biggestLoss: number; bestHand: string | null; totalWagered: number;
  decisions: number; correctDecisions: number;
  byPhase: { phase: string; action: string; count: number; correct: number }[];
  commonMistakes: { phase: string; action: string; recommended: string; count: number; evCost: number }[];
  evLost: number;
  trips: { bets: number; wins: number; net: number };
  side: { trips: SideBetStats; pairs: SideBetStats; badBeat: SideBetStats; progressive: SideBetStats; pairPlus: SideBetStats; sixCard: SideBetStats };
  game: GameId | null;
  baseNet: number; baseWagered: number;
  handsWithFriends: number; reloads: number; tables: number; debt: number;
  series: { at: string; cumulative: number }[];
}

export interface ReplayData {
  handId: string; tableCode: string; handNumber: number; startedAt: string; settledAt: string | null;
  status: string; dealer: string[]; community: string[]; dealerHand: string | null; dealerQualifies: boolean | null;
  deckCommitment: string;
  pairsVariant: string | null; badBeatVariant: string | null; rulesVersion: string | null; game: GameId;
  players: {
    playerId: string; name: string; seat: number; hole: string[] | null; folded: boolean;
    ante: number; blind: number; trips: number; pairs: number; badBeat: number; progressive: number; pairPlus: number; sixCard: number; play: number; net: number | null; outcome: string | null;
    handName: string | null; settlement: unknown;
  }[];
  decisions: (DecisionRecord & { playerId: string; at: string })[];
}

export interface RecentHandRow {
  handId: string; handNumber: number; at: number; dealerHand: string; dealerQualifies: boolean;
  players: { name: string; net: number; outcome: string; handName: string; sideHits?: string[] }[];
}

export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  createPlayer(id: string, name: string, avatar: string, tokenHash: string): Promise<PlayerRow>;
  playerByTokenHash(hash: string): Promise<PlayerRow | null>;
  updatePlayer(id: string, p: { name?: string; avatar?: string }): Promise<void>;

  createTable(code: string, hostId: string, config: TableConfig): Promise<void>;
  loadTable(code: string): Promise<TableRow | null>;
  updateTable(code: string, p: { config?: TableConfig; hostId?: string; closed?: boolean; handCounter?: number }): Promise<void>;

  getStack(playerId: string, code: string): Promise<StackRow | null>;
  createStack(playerId: string, code: string, amount: number): Promise<StackRow>;
  reloadStack(playerId: string, code: string, amount: number, pawn?: { name: string; item: string }): Promise<StackRow>;
  /** Pays back up to `amount` of the stack's debt from its balance. Returns the new stack and what was paid. */
  payDebt(playerId: string, code: string, amount: number, pawn: { name: string; item: (debtAfter: number) => string }): Promise<StackRow & { paid: number }>;
  /** The table's pawn-shop log, newest first. */
  debtEvents(code: string, limit: number): Promise<DebtEvent[]>;

  /** Atomically records the hand, debits every initial wager, and adds progressive contributions to the meter. */
  startHand(h: HandStart): Promise<{ balances: Map<string, number>; jackpot: number }>;
  /** Current linked progressive meter (cents). */
  getJackpot(): Promise<number>;
  /** Debits a Play wager. Returns new balance, or null if this tx_key was already applied. */
  wager(handId: string, playerId: string, code: string, amount: number, key: string): Promise<number | null>;
  recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }): Promise<void>;
  updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean): Promise<void>;
  /**
   * Atomically credits payouts. `build` is called inside the transaction with the locked progressive meter and
   * returns the final rows plus the meter after any jackpot awards. `applied` is false if already settled/voided.
   */
  settleHand(handId: string, code: string, dealer: { hand: string; qualifies: boolean }, build: SettlementBuilder):
    Promise<{ applied: boolean; balances: Map<string, number>; jackpot: number }>;
  /** Startup recovery: refund every committed stake of hands interrupted by a restart. */
  voidActiveHands(): Promise<{ hands: number; refunds: number }>;

  /** Statistics for one game, or all games when `game` is omitted. The bankroll series always covers every game. */
  playerStats(playerId: string, game?: GameId): Promise<PlayerStats>;
  recentHands(code: string, limit: number): Promise<RecentHandRow[]>;
  handReplay(handId: string): Promise<ReplayData | null>;
  /**
   * The table's open night. Opens a new one (closing the old) when there is none, when the last settled
   * hand is older than `idleMs`, or when `fresh` is set by the host.
   */
  openNight(code: string, idleMs: number, fresh: boolean): Promise<NightRow>;
  /** Closes the open night; returns it, or null if none was open. */
  endNight(code: string): Promise<NightRow | null>;
  getNight(id: string): Promise<NightRow | null>;
  listNights(code: string, limit: number): Promise<NightRow[]>;
  /** Settled hands of a night, oldest first. */
  nightHands(nightId: string): Promise<NightHand[]>;
  /** Ledger totals by kind for one stack (signed cents): buyin, wager, payout, refund, reload. */
  ledgerSummary(playerId: string, code: string): Promise<Record<string, number>>;
  /** Sum of ledger amounts for a stack — used to reconcile balances in tests and audits. */
  ledgerSum(playerId: string, code: string): Promise<number>;
}

export type SettlementBuilder = (jackpot: number) => {
  rows: PlayerSettlementRow[]; jackpotAfter: number;
  hits: { playerId: string; hand: string; amount: number; meterBefore: number }[];
};

export const JACKPOT_ID = 'five-card-5';

export class InsufficientFunds extends Error {}
