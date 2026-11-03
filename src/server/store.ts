// Persistence interface. Two implementations: PgStore (production, PostgreSQL) and MemoryStore
// (zero-config local dev and fast tests). Both enforce the same invariants:
//   * every balance change is a ledger row with a unique tx_key (idempotent),
//   * balances never go negative,
//   * a hand is settled at most once.

import type { DecisionRecord, TableConfig } from '../shared/protocol.js';

export interface PlayerRow { id: string; name: string; avatar: string }
export interface StackRow { balance: number; reloads: number }
export interface TableRow { code: string; hostId: string; config: TableConfig; handCounter: number; closed: boolean }

export interface HandStartPlayer {
  playerId: string; seat: number; name: string; hole: string[];
  ante: number; blind: number; trips: number;
}
export interface HandStart {
  id: string; tableCode: string; handNumber: number; deckCommitment: string;
  dealerCards: string[]; community: string[]; players: HandStartPlayer[];
}
export interface PlayerSettlementRow {
  playerId: string; credit: number; net: number; outcome: string; handName: string; handRank: number;
  tripsNet: number; play: number; folded: boolean; settlement: unknown;
}

export interface PlayerStats {
  hands: number; net: number; wins: number; losses: number; pushes: number; folds: number;
  biggestWin: number; biggestLoss: number; bestHand: string | null; totalWagered: number;
  decisions: number; correctDecisions: number;
  byPhase: { phase: string; action: string; count: number; correct: number }[];
  commonMistakes: { phase: string; action: string; recommended: string; count: number; evCost: number }[];
  evLost: number;
  trips: { bets: number; wins: number; net: number };
  handsWithFriends: number; reloads: number; tables: number;
  series: { at: string; cumulative: number }[];
}

export interface ReplayData {
  handId: string; tableCode: string; handNumber: number; startedAt: string; settledAt: string | null;
  status: string; dealer: string[]; community: string[]; dealerHand: string | null; dealerQualifies: boolean | null;
  deckCommitment: string;
  players: {
    playerId: string; name: string; seat: number; hole: string[] | null; folded: boolean;
    ante: number; blind: number; trips: number; play: number; net: number | null; outcome: string | null;
    handName: string | null; settlement: unknown;
  }[];
  decisions: (DecisionRecord & { playerId: string; at: string })[];
}

export interface RecentHandRow {
  handId: string; handNumber: number; at: number; dealerHand: string; dealerQualifies: boolean;
  players: { name: string; net: number; outcome: string; handName: string }[];
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
  reloadStack(playerId: string, code: string, amount: number): Promise<StackRow>;

  /** Atomically records the hand and debits Ante+Blind+Trips from every participant. */
  startHand(h: HandStart): Promise<Map<string, number>>;
  /** Debits a Play wager. Returns new balance, or null if this tx_key was already applied. */
  wager(handId: string, playerId: string, code: string, amount: number, key: string): Promise<number | null>;
  recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }): Promise<void>;
  updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean): Promise<void>;
  /** Atomically credits payouts. `applied` is false if the hand was already settled/voided. */
  settleHand(handId: string, code: string, dealer: { hand: string; qualifies: boolean }, rows: PlayerSettlementRow[]):
    Promise<{ applied: boolean; balances: Map<string, number> }>;
  /** Startup recovery: refund every committed stake of hands interrupted by a restart. */
  voidActiveHands(): Promise<{ hands: number; refunds: number }>;

  playerStats(playerId: string): Promise<PlayerStats>;
  recentHands(code: string, limit: number): Promise<RecentHandRow[]>;
  handReplay(handId: string): Promise<ReplayData | null>;
  /** Sum of ledger amounts for a stack — used to reconcile balances in tests and audits. */
  ledgerSum(playerId: string, code: string): Promise<number>;
}

export class InsufficientFunds extends Error {}
