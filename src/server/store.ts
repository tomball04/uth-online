import type { RivalryEvent, RivalryRow } from './roast.js';
import type { QHand } from '../shared/quality.js';
// Persistence interface. Two implementations: PgStore (production, PostgreSQL) and MemoryStore
// (zero-config local dev and fast tests). Both enforce the same invariants:
//   * every balance change is a ledger row with a unique tx_key (idempotent),
//   * balances never go negative,
//   * a hand is settled at most once.

import type { DecisionRecord, TableConfig } from '../shared/protocol.js';
import type { NightHand } from '../shared/recap.js';
import type { GameId } from '../shared/rules.js';
import type { AvatarData, PublicLook } from '../shared/cosmetics.js';

export interface PlayerRow { id: string; name: string; avatar: string }
export interface StackRow { balance: number; reloads: number; debt: number }
export interface TableRow { code: string; hostId: string; config: TableConfig; handCounter: number; closed: boolean; dealer?: { dealerId: string | null; rounds: number } }

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

export interface StyleTx { id: number; kind: 'earn' | 'purchase'; amount: number; balanceAfter: number; itemId: string | null; rewardId: string | null; note: string; at: number }
export interface CosmeticState { balance: number; owned: { itemId: string; method: string; at: number }[]; avatar: AvatarData | null; rewards: { rewardId: string; at: number }[] }
/** Facts the reward rules read. None of them involve wager size, wins, losses or jackpots. */
export interface RewardFacts { hands: number; games: GameId[]; friendHands: number; nights: number; nightHands: number; decisions: number; correct: number }
export type PurchaseResult =
  | { status: 'ok' | 'duplicate'; balance: number }
  | { status: 'owned'; balance: number }
  | { status: 'insufficient'; balance: number };

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
  /** §25: the dealer working this table and rounds into the shift (presentation only). */
  updateDealer(code: string, dealerId: string, rounds: number): Promise<void>;
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
  /** Blackjack: debits a double, split or insurance wager (idempotent by key) and records the round's running totals. */
  extraWager(handId: string, playerId: string, code: string, amount: number, key: string, totals: { extra: number; insurance: number }): Promise<number | null>;
  recordDecision(handId: string, playerId: string, d: DecisionRecord, state: { play: number; folded: boolean }): Promise<void>;
  updateDecisionEV(handId: string, playerId: string, phase: string, evCost: number, exact: boolean, cents?: number): Promise<void>;
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
  /** §31: every settled hand for this player with its recorded decisions (oldest first). */
  qualityHands(playerId: string, game?: GameId): Promise<QHand[]>;
  /** §32: comedic dealer-vs-player records (never read by dealing or settlement). */
  rivalries(dealerId: string, playerIds: string[]): Promise<Map<string, RivalryRow>>;
  bumpRivalry(dealerId: string, playerId: string, d: Partial<Record<'witnessed' | 'wins' | 'jackpots' | 'mockedThenWon', number>>, ev?: RivalryEvent): Promise<void>;
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

  // ---- §24 cosmetics. Fully separate from stacks and the chip ledger.
  getCosmetics(playerId: string): Promise<CosmeticState>;
  saveAvatar(playerId: string, data: AvatarData): Promise<void>;
  /** Public looks for a set of players (seats, chat, recap, replay). Players without a saved look are omitted. */
  publicLooks(playerIds: string[]): Promise<Map<string, PublicLook>>;
  /**
   * Credits a reward and/or grants items, once per `key`. Returns applied=false if the key was already used.
   * Never touches casino chips.
   */
  grant(playerId: string, g: { key: string; rewardId: string | null; amount: number; items: string[]; method: 'reward' | 'collection'; note: string }):
    Promise<{ applied: boolean; balance: number }>;
  /** Buys an item for `price` credits, atomically and once per `key`. */
  purchase(playerId: string, itemId: string, price: number, key: string, note: string): Promise<PurchaseResult>;
  styleHistory(playerId: string, limit: number): Promise<StyleTx[]>;
  rewardFacts(playerId: string, nightId: string | null): Promise<RewardFacts>;
}

export type SettlementBuilder = (jackpot: number) => {
  rows: PlayerSettlementRow[]; jackpotAfter: number;
  hits: { playerId: string; hand: string; amount: number; meterBefore: number }[];
};

export const JACKPOT_ID = 'five-card-5';

export class InsufficientFunds extends Error {}

/** Normalizes a raw row from either store into a §31 QHand (fills EV cents from ante units for older rows). */
export function toQHand(x: {
  handId: string; handNumber: number; tableCode: string; game: GameId; at: number; nightId: string | null; mainNet: number; totalNet: number;
  folded: boolean; hole: string[]; community: string[]; dealer: string[]; ante: number; settlement: unknown; decisions: any[];
}): QHand {
  const st = x.game === 'bj' && x.settlement && typeof x.settlement === 'object' ? x.settlement as { hands?: { cards: string[] }[]; dealer?: string[] } : null;
  return {
    handId: x.handId, handNumber: x.handNumber, tableCode: x.tableCode, game: x.game, at: x.at, nightId: x.nightId,
    mainNet: x.mainNet, totalNet: x.totalNet, folded: x.folded, hole: x.hole, community: x.game === 'uth' ? x.community : [],
    dealer: st?.dealer ?? x.dealer, bjHands: st?.hands?.map((h) => h.cards),
    decisions: x.decisions.map((d) => {
      const evCost = d.evCost === null || d.evCost === undefined ? null : Number(d.evCost);
      const evCents = d.evCents !== null && d.evCents !== undefined ? Number(d.evCents) : evCost !== null ? Math.round(evCost * x.ante) : null;
      return { phase: d.phase, action: d.action, recommended: d.recommended, correct: !!d.correct, graded: d.graded !== false, timedOut: !!d.timedOut,
        reason: d.reason ?? '', evCost: d.correct ? 0 : evCost, evCents: d.correct ? 0 : evCents };
    }),
  };
}
