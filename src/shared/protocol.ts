// Wire protocol between client and server. The server sends each socket a *view* that contains
// only what that viewer is authorized to see. Hidden cards are represented as null.

import type { CardStr } from './cards.js';
import type { Decision, DecisionPhase, Settlement } from './rules.js';
import type { Advice } from './strategy.js';

export type Phase = 'waiting' | 'betting' | 'preflop' | 'flop' | 'river' | 'showdown' | 'settled';

export interface TableConfig {
  name: string;
  isPublic: boolean;
  allowSpectators: boolean;
  maxSeats: number;            // 1..6 (1 only for solo)
  minAnte: number;             // cents
  maxAnte: number;             // cents
  maxTrips: number;            // cents
  startingBankroll: number;    // cents
  decisionSeconds: number;     // 0 = no timer (solo only)
  bettingSeconds: number;      // countdown once someone is ready
  solo: boolean;
}

export interface SeatView {
  seat: number;
  playerId: string;
  name: string;
  avatar: string;              // emoji or initials color seed
  balance: number;             // cents (table stack)
  connected: boolean;
  isHost: boolean;
  status: 'sitting-out' | 'betting' | 'ready' | 'in-hand' | 'waiting-next' | 'folded';
  bet: { ante: number; blind: number; trips: number; play: number };
  acted: boolean;              // has submitted decision for current phase (or doesn't need to)
  needsToAct: boolean;
  lastAction?: Decision;
  cards: (CardStr | null)[];   // [] if not in hand; null = face-down
  handName?: string;           // only when cards are visible to this viewer
  result?: SeatResult;
  leaving?: boolean;
}

export interface SeatResult {
  outcome: Settlement['outcome'];
  net: number;
  handName: string;
  best5?: CardStr[];
  lines: { wager: 'ante' | 'blind' | 'play' | 'trips'; result: string; net: number; note?: string }[];
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
    pending: { ante: number; trips: number };
    lastBet: { ante: number; trips: number } | null;
    canReload: boolean;
    timeoutPolicy: 'default' | 'strategy';
  };
  recent: HandSummary[];
}

export interface HandSummary {
  handId: string;
  handNumber: number;
  at: number;
  dealerHand: string;
  dealerQualifies: boolean;
  players: { name: string; net: number; outcome: string; handName: string }[];
}

export interface ChatMessage {
  id: string;
  at: number;
  kind: 'player' | 'dealer' | 'system';
  playerId?: string;
  name?: string;
  text: string;
}

export const REACTIONS = ['Nice hand!', 'Good luck!', 'Ouch!', 'Well played!', 'Wow!'] as const;
export type Reaction = (typeof REACTIONS)[number];

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
}

// ------------------------- client -> server -------------------------
export interface ClientToServer {
  'table:join': (p: { code: string; asSpectator?: boolean }, ack: (r: Ack<{ seat: number | null }>) => void) => void;
  'table:sit': (p: { seat?: number }, ack: (r: Ack<{ seat: number }>) => void) => void;
  'table:leave': (ack: (r: Ack) => void) => void;
  'bet:place': (p: { actionId: string; ante: number; trips: number }, ack: (r: Ack) => void) => void;
  'bet:clear': (p: { actionId: string }, ack: (r: Ack) => void) => void;
  'player:ready': (p: { actionId: string; ready: boolean }, ack: (r: Ack) => void) => void;
  'player:decide': (p: { actionId: string; handId: string; phase: DecisionPhase; decision: Decision }, ack: (r: Ack) => void) => void;
  'player:reload': (ack: (r: Ack) => void) => void;
  'player:prefs': (p: { timeoutPolicy?: 'default' | 'strategy'; sitOut?: boolean }, ack: (r: Ack) => void) => void;
  'chat:send': (p: { text: string }, ack: (r: Ack) => void) => void;
  'chat:react': (p: { reaction: Reaction }, ack: (r: Ack) => void) => void;
  'host:kick': (p: { playerId: string }, ack: (r: Ack) => void) => void;
  'host:close': (ack: (r: Ack) => void) => void;
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
}

export type { Advice };
