import type { RoastConsent, RoastPayload } from './roast/meta.js';
import type { BjAction, BjOutcome, BjRules } from './blackjack.js';
import type { DealerSettings } from './dealers.js';
// Wire protocol between client and server. The server sends each socket a *view* that contains
// only what that viewer is authorized to see. Hidden cards are represented as null.

import type { CardStr } from './cards.js';
import type { Decision, DecisionPhase, GameId, InitialBets, Settlement, TripsVariantId } from './rules.js';
import type { ProgProfile } from './progressive.js';
import type { BjSidesConfig } from './bjsides.js';
import type { BadBeatVariant, PairsVariant } from './sidebets.js';
import type { CardBack, EffectsLevel, FeltColor } from './themes.js';
import type { PublicLook } from './cosmetics.js';

export type WagerKey = 'ante' | 'blind' | 'play' | 'trips' | 'pairs' | 'badBeat' | 'progressive' | 'anteBonus' | 'pairPlus' | 'sixCard' | 'bjSide';
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
  progressive: boolean;        // UTH progressive offered at this table
  /** §36.3 Trips configuration UTH-01 … UTH-05 (default UTH-02). */
  tripsVariant: TripsVariantId;
  /** Three Card Poker Pair Plus table. */
  pairPlusVariant: string;
  /** §37 per-game progressive: variant and profile (published 'casino' or custom 'high-roller'). UTH on/off is `progressive`. */
  uthProg: { variant: string; profile: ProgProfile };
  tcpProg: { on: boolean; variant: string; profile: ProgProfile };
  bjProg: { on: boolean; variant: string; profile: ProgProfile };
  /** Designated jackpot suit for suit-specific progressive awards (0 spades, 1 hearts, 2 diamonds, 3 clubs). */
  jackpotSuit: number;
  /** §34.5 Blackjack side bets (Classic / All Bets / Custom). */
  bjSides: BjSidesConfig;
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
  /** §34 total Blackjack bonus bets placed (cents). */
  bonus?: number;
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
  lines: { wager: WagerKey; result: string; net: number; stake: number; credit: number; note?: string; multiplier?: number; combo?: string; variant?: string; sideId?: string; name?: string }[];
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
  /** The progressive meter for the game being played (null when that game's progressive is off). */
  jackpot: { amount: number; wager: number; meterId?: string; variant?: string; name?: string; custom?: boolean } | null;
  /** §37.7 every game's meter at this table's settings, shown together but never one jackpot. */
  jackpots?: { game: GameId; meterId: string; name: string; amount: number; wager: number; on: boolean; custom: boolean }[];
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
export interface SeatBj {
  hands: BjHandView[]; active: number | null; insurance: number | null; insuranceNet?: number; offered: boolean;
  /** §34 side bets: stake per wager, and each result once it can be shown without revealing the hole card. */
  sides?: { id: string; name: string; stake: number; phase: string; result?: 'win' | 'lose'; label?: string | null; pays?: number; net?: number }[];
  /** 21+3 Progressive: the qualifying hand once known. */
  prog?: { stake: number; combo: string | null; amount?: number; label?: string } | null;
}
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
  /** §40 host only: share (or update) what the host is playing on Spotify. */
  'music:now': (p: MusicNow, ack: (r: Ack) => void) => void;
  /** §40 host only: stop sharing. */
  'music:stop': (ack: (r: Ack) => void) => void;
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
  /** §40 the table's shared now-playing (null = host not sharing). serverNow lets clients correct clock skew. */
  'music:state': (p: { music: MusicState | null; serverNow: number }) => void;
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

// ------------------------- §40 table music (Spotify listen-along) -------------------------
/** What the host is playing. Only metadata and a Spotify track URI travel; audio is never relayed. */
export interface MusicNow {
  uri: string;          // spotify:track:<22 base62>
  name: string;
  artist: string;
  art: string | null;   // https://i.scdn.co/image/… only
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
}
export interface MusicState extends MusicNow {
  hostId: string;
  hostName: string;
  /** Server time the host's position was sampled; listeners add (now - at) when playing. */
  at: number;
}

const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const ms = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : null);

/** Validate a host's now-playing report. Returns null for anything that isn't a plain Spotify track. */
export function parseMusicNow(p: unknown): MusicNow | null {
  if (!p || typeof p !== 'object') return null;
  const x = p as Record<string, unknown>;
  const uri = String(x.uri ?? '');
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return null;
  const durationMs = ms(x.durationMs, 3_600_000);
  const progressMs = ms(x.progressMs, 3_600_000);
  if (durationMs === null || progressMs === null) return null;
  const art = typeof x.art === 'string' && /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]{1,64}$/.test(x.art) ? x.art : null;
  return {
    uri, name: clip(x.name, 120) || 'Unknown track', artist: clip(x.artist, 120), art,
    durationMs, progressMs: Math.min(progressMs, durationMs), isPlaying: x.isPlaying === true,
  };
}

/** Where a listener should be right now, given the shared state and the current server-synced time. */
export function musicPosition(m: MusicState, now: number): number {
  const p = m.isPlaying ? m.progressMs + Math.max(0, now - m.at) : m.progressMs;
  return Math.min(p, m.durationMs);
}
