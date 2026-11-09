// §32 Dealer Roast Engine — levels, categories and their rules (shared by server and browser).
// Roasts are presentation only: nothing here is read by the shuffle, settlement or networking code.

/** 0 Professional · 1 Smartass · 2 Asshole · 3 Complete Fucking Menace · 4 No Mercy. */
export type RoastLevel = 0 | 1 | 2 | 3 | 4;
export const ATTITUDES = ['professional', 'smartass', 'asshole', 'menace', 'nomercy'] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const LEVEL_OF: Record<Attitude, RoastLevel> = { professional: 0, smartass: 1, asshole: 2, menace: 3, nomercy: 4 };
export const ATTITUDE_LABEL: Record<Attitude, string> = {
  professional: 'Professional', smartass: 'Smartass', asshole: 'Asshole', menace: 'Complete Fucking Menace', nomercy: 'No Mercy',
};
export const ATTITUDE_LABEL_CLEAN: Record<Attitude, string> = {
  professional: 'Professional', smartass: 'Smartass', asshole: 'A-hole', menace: 'Complete Menace', nomercy: 'No Mercy',
};
export const ATTITUDE_NOTE: Record<Attitude, string> = {
  professional: 'Normal casino dialogue.',
  smartass: 'Sarcasm, occasional swearing, light insults.',
  asshole: 'Frequent profanity and direct mockery of gameplay.',
  menace: 'Maximum profanity, savage callbacks, elaborate takedowns.',
  nomercy: 'Relentless and openly contemptuous of terrible decisions.',
};
export const isAttitude = (v: unknown): v is Attitude => typeof v === 'string' && (ATTITUDES as readonly string[]).includes(v);

/** The 25 primary roast triggers (§32.13). */
export const PRIMARY = [
  'wrongWin', 'wrongLoss', 'rightLoss', 'badFold', 'badCall', 'checker', 'hit20', 'split10', 'bust', 'badDouble',
  'tcpFold', 'lose5', 'lose10', 'winStreak', 'bragLoss', 'progressive', 'badBeat', 'royal', 'tableLoses', 'groupMistakes',
  'sitBack', 'ignoresStrategy', 'shiftEnd', 'bigWinOut', 'grudge',
] as const;
/** Additional pools (§32.13 "Additional dialogue requirements"). */
export const EXTRA = ['intro', 'farewell', 'greet', 'comeback', 'meltdown', 'natural', 'comebackWin', 'rivalry', 'sideWin', 'improbable'] as const;
/** §34.11 Blackjack bonus outcomes (major Progressive hits reuse 'progressive'). */
export const BONUS = ['bonusWin', 'doubleThree', 'sideSweep', 'smallMainBig', 'multiBonus'] as const;
export type RoastCategory = (typeof PRIMARY)[number] | (typeof EXTRA)[number] | (typeof BONUS)[number];
export const CATEGORIES: RoastCategory[] = [...PRIMARY, ...EXTRA, ...BONUS];

export interface CategoryRule {
  title: string;
  /** Higher wins when several things happen in one round. */
  priority: number;
  /** Hands before the same player can hear this category again. */
  cooldown: number;
  /** personal = about one player (needs their opt-in); group = the table; house = the dealer. */
  target: 'personal' | 'group' | 'house';
  /** Requires the strategy engine to have graded a decision as a mistake. */
  verifiedMistake?: boolean;
  /** Special announcement (bigger caption). */
  major?: boolean;
}
export const RULES: Record<RoastCategory, CategoryRule> = {
  wrongWin: { title: 'Wrong Call Win', priority: 70, cooldown: 2, target: 'personal', verifiedMistake: true },
  wrongLoss: { title: 'Wrong Call Loss', priority: 35, cooldown: 3, target: 'personal', verifiedMistake: true },
  rightLoss: { title: 'Right Call Loss', priority: 25, cooldown: 4, target: 'personal' },
  badFold: { title: 'Terrible fold', priority: 58, cooldown: 2, target: 'personal', verifiedMistake: true },
  badCall: { title: 'Bad river call', priority: 55, cooldown: 2, target: 'personal', verifiedMistake: true },
  checker: { title: 'Repeated checking', priority: 22, cooldown: 8, target: 'personal' },
  hit20: { title: 'Hit on 20', priority: 78, cooldown: 0, target: 'personal', verifiedMistake: true },
  split10: { title: 'Split tens', priority: 76, cooldown: 0, target: 'personal', verifiedMistake: true },
  bust: { title: 'Blackjack bust', priority: 28, cooldown: 3, target: 'personal' },
  badDouble: { title: 'Terrible double down', priority: 60, cooldown: 2, target: 'personal', verifiedMistake: true },
  tcpFold: { title: 'Three Card Poker bad fold', priority: 58, cooldown: 2, target: 'personal', verifiedMistake: true },
  lose5: { title: 'Five-hand losing streak', priority: 46, cooldown: 0, target: 'personal' },
  lose10: { title: 'Ten-hand losing streak', priority: 52, cooldown: 0, target: 'personal' },
  winStreak: { title: 'Winning streak', priority: 38, cooldown: 0, target: 'personal' },
  bragLoss: { title: 'Bragged, then lost', priority: 54, cooldown: 3, target: 'personal' },
  progressive: { title: 'Major Progressive jackpot', priority: 95, cooldown: 0, target: 'personal', major: true },
  badBeat: { title: 'Bad Beat payout', priority: 85, cooldown: 0, target: 'personal', major: true },
  royal: { title: 'Royal Flush', priority: 90, cooldown: 0, target: 'personal', major: true },
  tableLoses: { title: 'Entire table loses', priority: 48, cooldown: 4, target: 'group' },
  groupMistakes: { title: 'Several bad decisions', priority: 50, cooldown: 3, target: 'group', verifiedMistake: true },
  sitBack: { title: 'Back from sitting out', priority: 30, cooldown: 6, target: 'personal' },
  ignoresStrategy: { title: 'Keeps ignoring strategy', priority: 44, cooldown: 10, target: 'personal', verifiedMistake: true },
  shiftEnd: { title: 'Shift change', priority: 80, cooldown: 0, target: 'house' },
  bigWinOut: { title: 'Replaced after a major win', priority: 82, cooldown: 0, target: 'house' },
  grudge: { title: 'Returning grudge', priority: 40, cooldown: 0, target: 'personal' },
  intro: { title: 'Introduction', priority: 81, cooldown: 0, target: 'house' },
  farewell: { title: 'Farewell', priority: 81, cooldown: 0, target: 'house' },
  greet: { title: 'Greeting a player', priority: 20, cooldown: 0, target: 'personal' },
  comeback: { title: 'Chat comeback', priority: 45, cooldown: 2, target: 'personal' },
  meltdown: { title: 'Dealer meltdown', priority: 100, cooldown: 0, target: 'group', major: true },
  natural: { title: 'Blackjack natural', priority: 30, cooldown: 3, target: 'personal' },
  comebackWin: { title: 'Unexpected comeback', priority: 42, cooldown: 0, target: 'personal' },
  rivalry: { title: 'Rivalry callback', priority: 15, cooldown: 12, target: 'personal' },
  sideWin: { title: 'Large side-bet win', priority: 40, cooldown: 2, target: 'personal' },
  improbable: { title: 'Spectacularly improbable', priority: 65, cooldown: 0, target: 'personal', major: true },
  bonusWin: { title: 'Blackjack bonus win (Perfect Pairs, Lucky Ladies, Buster, triple sevens…)', priority: 47, cooldown: 1, target: 'personal' },
  doubleThree: { title: 'Won both 21+3 and Top 3', priority: 72, cooldown: 0, target: 'personal', major: true },
  sideSweep: { title: 'Lost several side bets at once', priority: 26, cooldown: 4, target: 'personal' },
  smallMainBig: { title: 'Small main result, huge side-bet payout', priority: 62, cooldown: 2, target: 'personal' },
  multiBonus: { title: 'Several players win different bonuses', priority: 57, cooldown: 3, target: 'group' },
};

/** Facts a line may use. A line is eligible only when every fact it names is known and verified. */
export const FACTS = ['name', 'game', 'hand', 'dealerHand', 'amount', 'total', 'streak', 'wcw', 'acc', 'mistakes', 'count', 'witnessed', 'grudge', 'winner', 'rounds', 'dealer', 'prev', 'bet', 'combo'] as const;
export type Fact = (typeof FACTS)[number];
export type RoastVars = Partial<Record<Fact, string>>;

/** One roast as sent to browsers. The browser renders it within the viewer's own limits. */
export interface RoastPayload {
  lineId: string;
  dealer: string;
  cat: RoastCategory;
  level: RoastLevel;
  vars: RoastVars;
  targetId?: string;
  size: 'short' | 'medium' | 'long';
  major?: boolean;
  meltdown?: boolean;
  /** Seed for choosing a gentler alternative in browsers whose limit is lower. */
  seed: number;
}

/** Per-player settings the server needs (the rest stay in the browser). */
export interface RoastConsent { targeting: boolean; max: RoastLevel }
export const DEFAULT_CONSENT: RoastConsent = { targeting: false, max: 4 };
