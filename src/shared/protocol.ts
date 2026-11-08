import type { RoastConsent, RoastPayload } from './roast/meta.js';
import type { BjAction, BjOutcome, BjRules } from './blackjack.js';
import type { DealerSettings } from './dealers.js';
// Wire protocol between client and server. The server sends each socket a *view* that contains
// only what that viewer is authorized to see. Hidden cards are represented as null.

import type { CardStr } from './cards.js';
import type { Decision, DecisionPhase, GameId, InitialBets, Settlement } from './rules.js';
import type { BadBeatVariant, PairsVariant } from './sidebets.js';
import type { CardBack, EffectsLevel, FeltColor } from './themes.js';
import type { PublicLook } from './cosmetics.js';

export type WagerKey = 'ante' | 'blind' | 'play' | 'trips' | 'pairs' | 'badBeat' | 'progressive' | 'anteBonus' | 'pairPlus' | 'sixCard';
import type { Advice, Outs } from './strategy.js';

export type Phase = 'waiting' | 'betting' | 'preflop' | 'flop' | 'river' | 'decide' | 'insurance' | 'turns' | 'showdown' | 'settled';

export interface TableConfig {
  name: string;
  isPublic: boolean;
  allowSpectators: boolean;
  maxSeats: number;            // 1..6 (1 only for solo)
  minAnte: number;             // cents
  maxAnte: number;             // cents
  maxTrips: number;            // cents
  maxPairs: number;            // cents, Ultimate Pairs limit
  maxBadBeat: number;          // cents, Bad Beat limit
  pairsVariant: PairsVariant['id'];     // complete pay table, never mixed
  badBeatVariant: BadBeatVariant['id'];
  progressive: boolean;        // $5 Five Card Progressive offered at this table
  /** Which casino game the table plays. The server switches it between hands only. */
  game: GameId;
  maxPairPlus: number;         // cents, Three Card Poker
  maxSixCard: number;          // cents, Three Card Poker
  felt: FeltColor;             // host's choice, shown to everyone
  cardBack: CardBack;
  /** Host limit on cosmetic effects (§24). */
  effects: EffectsLevel;
  startingBankroll: number;    // cents
  decisionSeconds: number;     // 0 = no timer (solo only)
  /** Blackjack: late surrender allowed (off by default). */
  bjSurrender: boolean;
  bettingSeconds: number;      // countdown once someone is ready
  solo: boolean;
  /** Rotating dealer presentation (§25). Never affects cards or payouts. */
  dealer: DealerSettings;
}

export interface SeatView {
  seat: number;
  playerId: string;
  name: string;
  avatar: string;              // legacy emoji, used only when no portrait is saved
  /** Public avatar look (§24). Cosmetic only. */
  look?: PublicLook;
  balance: number;             // cents (table stack)
  connected: boolean;
  isHost: boolean;
  status: 'sitting-out' | 'betting' | 'ready' | 'in-hand' | 'waiting-next' | 'folded';
  bet: { ante: number; blind: number; trips: number; play: number; pairs: number; badBeat: number; progressive: number; pairPlus: number; sixCard: number };
  acted: boolean;              // has submitted decision for current phase (or doesn't need to)
  needsToAct: boolean;
  lastAction?: Decision;
  cards: (CardStr | null)[];   // [] if not in hand; null = face-down
  handName?: string;           // only when cards are visible to this viewer
  result?: SeatResult;
  /** Blackjack: this seat's hands (all cards are public in blackjack) and insurance. */
  bj?: SeatBj;
  leaving?: boolean;
  /** Just for fun: total virtual chips borrowed by reloading at this table (cents). */
  debt?: number;
  /** What this player has at the pawn shop (just for fun). */
  pawned?: string;
  standingUp?: boolean;        // host moved them to spectators; takes effect after this hand
  awayByHost?: boolean;        // the host set them away
  /** Sitting out (or will sit out from the next hand, if still in this one). */
  sitOut?: boolean;
}

export interface SeatResult {
  outcome: Settlement['outcome'];
  net: number;
  handName: string;
  best5?: CardStr[];
  lines: { wager: WagerKey; result: string; net: number; stake: number; credit: number; note?: string; multiplier?: number; combo?: string; variant?: string }[];
  baseNet: number;
  sideNet: number;
}

export interface TableView {
  code: string;
  config: TableConfig;
  phase: Phase;
  handId: string | null;
  handNumber: number;
  seq: number;                       // monotonically increasing state version
  serverNow: number;                 // ms epoch on server when the view was built
  deadline: number | null;           // ms epoch: decision/betting deadline (server time)
  community: (CardStr | null)[];     // always length 5 during a hand
  dealer: { cards: (CardStr | null)[]; handName?: string; qualifies?: boolean; best5?: CardStr[] };
  seats: (SeatView | null)[];
  spectators: number;
  you: {
    playerId: string;
    seat: number | null;
    role: 'player' | 'spectator';
    isHost: boolean;
    legal: Decision[];             // decisions you may submit right now
    canBet: boolean;
    pending: InitialBets;
    lastBet: InitialBets | null;
    canReload: boolean;
    timeoutPolicy: 'default' | 'strategy';
    /** Your same-bet-every-hand wager, if on. */
    autoRebet: InitialBets | null;
  };
  recent: HandSummary[];
  /** Linked jackpot meter shared by every table on this server (cents). */
  jackpot: { amount: number; wager: number };
  /** Open table night (running tab), null before the first hand of a night. */
  nightId: string | null;
  rulesVersion: string;
  /** A game switch the host queued until the current hand settles. */
  pendingGame: GameId | null;
  /** The dealer persona working this table (§25). Presentation only. */
  house: HouseView;
  /** Blackjack table state (null for the poker games). */
  bj: BjTableView | null;
}

export type BjAct = BjAction | 'insure' | 'no-insurance';
export interface BjHandView {
  cards: CardStr[]; bet: number; doubled: boolean; fromSplit: boolean; total: string; done: boolean; surrendered: boolean;
  outcome?: BjOutcome; net?: number;
}
export interface SeatBj { hands: BjHandView[]; active: number | null; insurance: number | null; insuranceNet?: number; offered: boolean }
export interface BjTableView {
  rules: BjRules;
  rulesText: string[];
  /** Whose turn it is, and which of their hands. */
  turn: { playerId: string; seat: number; hand: number } | null;
  dealerTotal: string | null;
  shoe: { total: number; dealt: number; cut: number; discards: number };
  /** Your choices right now (empty when it isn't your turn). */
  actions: BjAct[];
  insuranceMax: number;
  /** Basic-strategy advice for your active hand (the client decides whether to show it). */
  advice: { best: BjAct; reason: string; constrained: boolean } | null;
}

export interface HouseView {
  dealerId: string;
  /** Completed rounds since this dealer started; rotation happens at `config.dealer.every`. */
  rounds: number;
  /** A rotation is queued for the next betting round (after results are shown). */
  rotating: null | { reason: 'shift' | 'bigwin' | 'host'; next?: string };
  /** The most recent change, for the transition animation. */
  event: null | { kind: 'rotate' | 'intro'; from: string | null; to: string; reason: 'shift' | 'bigwin' | 'host' | 'open'; winner?: string; at: number };
  /** Settled big win this round (dealer reaction). */
  bigWin: null | { name: string; amount: number };
}

export interface HandSummary {
  handId: string;
  handNumber: number;
  at: number;
  dealerHand: string;
  dealerQualifies: boolean;
  players: { name: string; net: number; outcome: string; handName: string; sideHits?: string[] }[];
}

export interface ChatMessage {
  id: string;
  at: number;
  kind: 'player' | 'dealer' | 'system';
  playerId?: string;
  name?: string;
  /** For dealer lines that are roasts: the plain Professional text. Browsers render `roast` within the viewer's own limits. */
  text: string;
  /** §32 dealer roast (rendered by each browser from the shared library, filtered by that viewer's settings). */
  roast?: RoastPayload;
}

export const REACTIONS = ['Nice hand!', 'Good luck!', 'Ouch!', 'Well played!', 'Wow!'] as const;
/** A classic reaction, or a line from a reaction set the player has equipped (§24). */
export type Reaction = string;

export interface DecisionRecord {
  phase: DecisionPhase;
  action: Decision;
  recommended: Decision;
  correct: boolean;
  reason: string;
  timedOut: boolean;
  evCost?: number;        // ante units
  evExact?: boolean;
  evCostCents?: number;
  /** False when the decision can't be graded (no verified strategy, or the best play was unaffordable). §31 */
  graded?: boolean;
  /** River: dealer's single-card outs + exact beating hands. Flop: your outs to improve. Pre-flop: none. */
  outs?: Outs;
}

// ------------------------- client -> server -------------------------
export interface ClientToServer {
  'table:join': (p: { code: string; asSpectator?: boolean }, ack: (r: Ack<{ seat: number | null }>) => void) => void;
  'table:sit': (p: { seat?: number }, ack: (r: Ack<{ seat: number }>) => void) => void;
  'table:leave': (ack: (r: Ack) => void) => void;
  'bet:place': (p: { actionId: string; ante: number; trips: number; pairs?: number; badBeat?: number; progressive?: number; pairPlus?: number; sixCard?: number }, ack: (r: Ack) => void) => void;
  'bet:clear': (p: { actionId: string }, ack: (r: Ack) => void) => void;
  'player:ready': (p: { actionId: string; ready: boolean }, ack: (r: Ack) => void) => void;
  'player:decide': (p: { actionId: string; handId: string; phase: DecisionPhase; decision: Decision }, ack: (r: Ack) => void) => void;
  /** Blackjack action on your active hand, or an insurance answer. */
  'bj:act': (p: { actionId: string; handId: string; action: BjAct; hand?: number; amount?: number }, ack: (r: Ack) => void) => void;
  'player:payDebt': (p: { amount: number }, ack: (r: Ack<{ balance: number; debt: number; paid: number }>) => void) => void;
  'player:reload': (ack: (r: Ack<{ balance: number; debt: number }>) => void) => void;
  'player:prefs': (p: { timeoutPolicy?: 'default' | 'strategy'; sitOut?: boolean; autoRebet?: boolean }, ack: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack: (r: Ack) => void) => void;
  'chat:react': (p: { reaction: Reaction }, ack: (r: Ack) => void) => void;
  'host:kick': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'host:close': (ack: (r: Ack) => void) => void;
  /** Cosmetic only, allowed at any time. */
  'host:theme': (p: { felt?: FeltColor; cardBack?: CardBack; effects?: EffectsLevel }, ack: (r: Ack) => void) => void;
  /** Set a seated player away (sitting out) or back. */
  'host:away': (p: { playerId: string; away: boolean }, ack: (r: Ack) => void) => void;
  /** Move a seated player to the rail as a spectator; their stack is kept for when they sit again. */
  'host:standUp': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'host:endNight': (ack: (r: Ack) => void) => void;
  'host:game': (p: { game: GameId }, ack: (r: Ack<{ queued: boolean }>) => void) => void;
  'host:dealer': (p: { settings?: Partial<DealerSettings>; dealerId?: string }, ack: (r: Ack<{ queued: boolean }>) => void) => void;
  'roast:prefs': (p: RoastConsent, ack: (r: Ack<RoastConsent>) => void) => void;
  'host:settings': (p: Partial<TableConfig>, ack: (r: Ack) => void) => void;
}

// ------------------------- server -> client -------------------------
export interface ServerToClient {
  'table:state': (v: TableView) => void;
  'table:closed': (p: { reason: string }) => void;
  'chat:message': (m: ChatMessage) => void;
  'chat:history': (m: ChatMessage[]) => void;
  'chat:reaction': (p: { playerId: string; seat: number | null; reaction: Reaction }) => void;
  'hand:analysis': (p: { handId: string; decisions: DecisionRecord[] }) => void;
  'kicked': (p: { reason: string }) => void;
  'night:ended': (p: { nightId: string }) => void;
  'jackpot:hit': (p: { tableName: string; playerName: string; hand: string; amount: number; same: boolean }) => void;
  /** Style Credits earned (§24). Never chips. */
  'style:earned': (p: { rewards: string[]; balance: number }) => void;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface PublicTableListing {
  code: string;
  name: string;
  seated: number;
  maxSeats: number;
  minAnte: number;
  maxAnte: number;
  inHand: boolean;
  allowSpectators: boolean;
  game: GameId;
  /** Who is seated, with public avatar looks (cosmetic). */
  players?: { name: string; look?: PublicLook }[];
}

export type { Advice };
