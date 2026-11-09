// §32 Dealer Roast Engine (server). Decides WHEN a dealer says something and WHICH line, from facts the server
// has already recorded and made public. It never reads the deck, never changes a result, never delays settlement:
// every entry point is fire-and-forget from the table engine, and every failure is swallowed.
import { LEVEL_OF, RULES, type Attitude, type RoastCategory, type RoastConsent, type RoastLevel, type RoastPayload, type RoastVars, DEFAULT_CONSENT } from '../shared/roast/meta.js';
import { linesFor, type RoastLine } from '../shared/roast/library.js';
import { fill } from '../shared/roast/render.js';
import { formatMoney } from '../shared/rules.js';
import type { DecisionRecord } from '../shared/protocol.js';
import type { Store } from './store.js';

/** What one player did and got in a settled round. Built by the table engine from settled, public data. */
export interface RoundPlayer {
  pid: string; name: string;
  /** Ante (or Blackjack bet). */
  opening: number;
  mainNet: number; sideNet: number; totalNet: number;
  decisions: DecisionRecord[];
  folded: boolean;
  handName?: string;
  /** UTH: checked pre-flop and on the flop. */
  checkedThrough?: boolean;
  progressiveWin?: number; badBeatWin?: number; royal?: boolean; improbable?: string; natural?: boolean;
  bj?: { hit20: boolean; split10: boolean; busted: boolean; total?: string };
  /** §34.11 Blackjack side-bet results as recorded at settlement (never inferred). */
  bjSides?: { id: string; bet: string; combo: string | null; result: 'win' | 'lose'; net: number }[];
}
export interface RoundFacts { handId: string; nightId: string | null; game: 'uth' | 'tcp' | 'bj'; dealerHand?: string; players: RoundPlayer[] }

export interface Emit { (p: RoastPayload, fallback: string): void }
interface Ctx {
  emit: Emit;
  attitude: () => Attitude;
  dealer: () => { id: string; name: string };
  rand: (n: number) => number;
  now: () => number;
  store: Store;
  tableCode: string;
}

const GAME = { uth: 'Ultimate Texas Hold’em', tcp: 'Three Card Poker', bj: 'Blackjack' } as const;
/** Professional fallbacks: what a viewer who asked for no roasts (or the "Professional" table) sees instead. */
const PRO: Partial<Record<RoastCategory, string>> = {
  wrongWin: 'Nicely won, {name}.', wrongLoss: 'Unlucky, {name}.', rightLoss: 'Well played, {name} — the cards just didn’t cooperate.',
  badFold: '{name} folds.', badCall: '{name} calls.', checker: '{name} checks again.', hit20: '{name} hits.', split10: '{name} splits.',
  bust: '{name} busts.', badDouble: '{name} doubles down.', tcpFold: '{name} folds.', lose5: 'Hang in there, {name}.', lose10: 'Hang in there, {name}.',
  winStreak: '{name} is on a roll.', bragLoss: 'Unlucky, {name}.', progressive: 'Congratulations, {name}!', badBeat: 'Congratulations, {name}!',
  royal: 'A Royal Flush! Congratulations, {name}.', tableLoses: 'The house takes this one.', groupMistakes: 'Tough round, everyone.',
  sitBack: 'Welcome back, {name}.', ignoresStrategy: 'Good luck, {name}.', shiftEnd: 'My shift is over — thank you, everyone.',
  bigWinOut: 'What a hand. A new dealer takes over now.', grudge: 'Good to see you again, {name}.', intro: 'Good evening, everyone.',
  farewell: 'Thank you, everyone. Good luck.', greet: 'Welcome, {name}.', comeback: 'Noted, {name}.', meltdown: 'Quite a round, everyone.',
  natural: 'Blackjack, {name}!', comebackWin: 'There it is, {name}.', rivalry: 'Good to see you, {name}.', sideWin: 'Nice side bet, {name}.',
  improbable: 'Remarkable hand, {name}.', bonusWin: '{bet} pays, {name}.', doubleThree: '21+3 and Top 3 both pay, {name}.',
  sideSweep: 'No luck on the side bets, {name}.', smallMainBig: 'The side bets came through, {name}.', multiBonus: 'Bonus winners around the table.',
};

const BRAG = /\b(ez|easy money|too easy|can'?t lose|cant lose|i got this|watch (this|me)|mortal lock|lock it in|i'?m (a )?(genius|god|goat|him|the goat)|built different|i'?m cooking|let'?s go+|printing( money)?|owned|free money|light work|scared money|never lose|unstoppable)\b/i;
const CHALLENGE = /\b(shut up|stfu|whatever|you suck|bite me|who asked|cope|mad\??|just deal|deal the cards|be quiet|rude|you('re| are) (fired|wrong|trash|terrible|bad)|nobody asked|calm down|chill|go away|bad dealer|worst dealer)\b/i;

interface Pstat { initNight: string | null; graded: number; correct: number; wcw: number; mistakes: number; kinds: Map<string, number>; loseStreak: number; winStreak: number; checks: number; bragAt: number; bragHands: number; roastedAt: number; lastRoundRoasted: number; cats: Map<string, number> }

export class RoastDirector {
  consent = new Map<string, RoastConsent>();
  private stats = new Map<string, Pstat>();
  /** Last 100 line ids used at this table (§32.13: never repeat within 100 eligible comments). */
  private recent: string[] = [];
  private session = new Set<string>();
  private sessionNight: string | null | undefined = undefined;
  private lastSize: RoastLine['size'] | null = null;
  private round = 0;
  private lastMeltdown = -999;
  private lastMocked: string | null = null;
  private seatedAt = new Map<string, number>();
  private greeted = new Set<string>();
  /** Blunders already remarked on mid-hand (so the settled hand doesn't say it twice). */
  private midDone = new Set<string>();
  /** `dealer:pid` pairs already checked for a rivalry callback this shift (one store read per player per shift). */
  private rivalChecked = new Set<string>();

  constructor(private c: Ctx) {}

  level(): RoastLevel { return LEVEL_OF[this.c.attitude()]; }
  private consentOf(pid: string) { return this.consent.get(pid) ?? DEFAULT_CONSENT; }
  private stat(pid: string): Pstat {
    let s = this.stats.get(pid);
    if (!s) this.stats.set(pid, s = { initNight: null, graded: 0, correct: 0, wcw: 0, mistakes: 0, kinds: new Map(), loseStreak: 0, winStreak: 0, checks: 0, bragAt: 0, bragHands: 0, roastedAt: 0, lastRoundRoasted: -9, cats: new Map() });
    return s;
  }

  // ---------------------------------------------------------------- choosing a line
  /**
   * Pick a line: eligible = dealer + category, level within the cap, every fact supplied, not among the last 100
   * comments, size allowed. Prefers lines unused this session, the cap's own intensity, and a size different from
   * the last one. When every eligible line is in the last-100 window, nothing is said.
   */
  pick(cat: RoastCategory, cap: RoastLevel, vars: RoastVars, opts: { maxSize?: RoastLine['size']; allowLong?: boolean } = {}): RoastLine | null {
    if (cap < 1) return null;
    const dealer = this.c.dealer().id;
    const sizes: RoastLine['size'][] = opts.maxSize === 'short' ? ['short'] : opts.maxSize === 'medium' ? ['short', 'medium'] : opts.allowLong === false ? ['short', 'medium'] : ['short', 'medium', 'long'];
    const all = linesFor(dealer, cat).filter((l) => l.level <= cap && sizes.includes(l.size) && l.facts.every((f) => vars[f] !== undefined && vars[f] !== ''));
    const choose = (window: number) => {
      const blocked = new Set(this.recent.slice(-window));
      const ok = all.filter((l) => !blocked.has(l.id));
      if (!ok.length) return null;
      const w = ok.map((l) => (this.session.has(l.id) ? 1 : 6) * (l.level === cap ? 3 : l.level === cap - 1 ? 2 : 1) * (l.size !== this.lastSize ? 1.5 : 1) * (l.facts.length > 1 ? 1.3 : 1));
      let r = this.c.rand(1_000_000) / 1_000_000 * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ok.length; i++) { r -= w[i]; if (r <= 0) return ok[i]; }
      return ok[ok.length - 1];
    };
    // Never repeat within the last 100 comments. When a situation's lines are all used up, the dealer stays quiet
    // (the plain game announcement still shows) rather than repeat a joke.
    return choose(100);
  }

  private say(cat: RoastCategory, cap: RoastLevel, vars: RoastVars, extra: { targetId?: string; meltdown?: boolean; maxSize?: RoastLine['size']; allowLong?: boolean } = {}) {
    const dealer = this.c.dealer();
    const v: RoastVars = { dealer: dealer.name, ...vars };
    const line = this.pick(cat, cap, v, extra);
    if (!line) return false;
    this.recent.push(line.id); if (this.recent.length > 100) this.recent.shift();
    this.session.add(line.id); this.lastSize = line.size;
    const payload: RoastPayload = {
      lineId: line.id, dealer: dealer.id, cat, level: line.level, vars: v, targetId: extra.targetId, size: line.size,
      major: RULES[cat].major || extra.meltdown || undefined, meltdown: extra.meltdown || undefined, seed: this.c.rand(2 ** 31),
    };
    this.c.emit(payload, fill(PRO[cat] ?? '', v).replace(/\{\w+\}/g, '').trim() || '…');
    if (extra.targetId) { const s = this.stat(extra.targetId); s.roastedAt = this.c.now(); s.lastRoundRoasted = this.round; s.cats.set(cat, this.round); this.lastMocked = extra.targetId; }
    return true;
  }

  // ---------------------------------------------------------------- consent, chat, seats
  setConsent(pid: string, input: unknown) {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const max = Number(o.max);
    const next: RoastConsent = { targeting: o.targeting === true, max: (Number.isInteger(max) && max >= 0 && max <= 4 ? max : 4) as RoastLevel };
    this.consent.set(pid, next);
    return next;
  }
  seated(pid: string) { this.seatedAt.set(pid, this.c.now()); }
  /** First consent after sitting down → the dealer says hello (only to players who opted in). */
  maybeGreet(pid: string, name: string) {
    if (this.greeted.has(pid) || !this.consentOf(pid).targeting || this.level() < 1) return;
    if (this.c.now() - (this.seatedAt.get(pid) ?? 0) > 30_000) return;
    this.greeted.add(pid);
    this.say('greet', this.cap(pid), { name }, { targetId: pid, maxSize: 'medium' });
  }
  private cap(pid: string): RoastLevel { return Math.min(this.level(), this.consentOf(pid).max) as RoastLevel; }

  /** Player chat. Only used to notice bragging and challenges — the text itself is never repeated by a dealer. */
  onChat(pid: string, name: string, text: string) {
    try {
      if (this.level() < 1) return;
      const s = this.stat(pid);
      if (BRAG.test(text)) { s.bragAt = this.c.now(); s.bragHands = 0; }
      const dealer = this.c.dealer();
      const atDealer = new RegExp(`\\b(${dealer.name}|dealer)\\b`, 'i').test(text);
      const recentlyRoasted = this.c.now() - s.roastedAt < 60_000;
      if ((atDealer || recentlyRoasted) && (CHALLENGE.test(text) || atDealer) && this.consentOf(pid).targeting) {
        if (this.round - (s.cats.get('comeback') ?? -9) < RULES.comeback.cooldown) return;
        this.say('comeback', this.cap(pid), { name }, { targetId: pid, maxSize: 'medium' });
      }
    } catch { /* presentation only */ }
  }
  onSitBack(pid: string, name: string) {
    try {
      if (this.level() < 1 || !this.consentOf(pid).targeting) return;
      const s = this.stat(pid);
      if (this.round - (s.cats.get('sitBack') ?? -99) < RULES.sitBack.cooldown) return;
      this.say('sitBack', this.cap(pid), { name }, { targetId: pid, maxSize: 'medium' });
    } catch { /* presentation only */ }
  }

  // ---------------------------------------------------------------- mid-hand (Blackjack, cards are public)
  /** Short remark right after a verified Blackjack blunder. Never long: someone may still be deciding. */
  midHand(pid: string, name: string, kind: 'hit20' | 'split10', total?: string) {
    try {
      if (this.level() < 1 || !this.consentOf(pid).targeting) return false;
      const ok = this.say(kind, this.cap(pid), { name, total, game: GAME.bj }, { targetId: pid, maxSize: 'short' });
      if (ok) this.midDone.add(`${pid}:${kind}`);
      return ok;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- dealer changes
  onShiftEnd(reason: 'shift' | 'bigwin', rounds: number, winner?: { pid?: string; name: string; amount: number }) {
    try {
      if (this.level() < 1) return false;
      const vars: RoastVars = { rounds: String(rounds) };
      if (reason === 'bigwin') {
        if (winner) { vars.amount = formatMoney(winner.amount); if (!winner.pid || this.consentOf(winner.pid).targeting) vars.winner = winner.name; }
        return this.say('bigWinOut', this.level(), vars, { allowLong: true });
      }
      return this.say('shiftEnd', this.level(), vars, { allowLong: true });
    } catch { return false; }
  }
  onFarewell() { try { return this.level() >= 1 && this.say('farewell', this.level(), {}, { maxSize: 'medium' }); } catch { return false; } }
  onIntro(prevName: string | null) { try { return this.level() >= 1 && this.say('intro', this.level(), prevName ? { prev: prevName } : {}, { maxSize: 'medium' }); } catch { return false; } }

  /** A returning dealer remembers something real about a seated player (only events stored from earlier shifts). */
  async grudge(seated: { pid: string; name: string }[]) {
    try {
      if (this.level() < 2) return;
      const dealer = this.c.dealer().id;
      const eligible = seated.filter((p) => this.consentOf(p.pid).targeting);
      if (!eligible.length) return;
      const rows = await this.c.store.rivalries(dealer, eligible.map((p) => p.pid));
      const cands = eligible.map((p) => ({ p, r: rows.get(p.pid) })).filter((x) => x.r && x.r.events.length);
      if (!cands.length || this.c.rand(100) >= 70) return;
      const { p, r } = cands[this.c.rand(cands.length)];
      const ev = r!.events[this.c.rand(r!.events.length)];
      this.say('grudge', this.cap(p.pid), { name: p.name, grudge: grudgePhrase(ev) }, { targetId: p.pid, allowLong: true });
    } catch { /* presentation only */ }
  }

  private bumpRivalry(pid: string, d: Partial<Record<'witnessed' | 'wins' | 'jackpots' | 'mockedThenWon', number>>, ev?: RivalryEvent) {
    this.c.store.bumpRivalry(this.c.dealer().id, pid, d, ev ? { ...ev, at: this.c.now() } : undefined).catch(() => {});
  }

  // ---------------------------------------------------------------- after a settled round
  /** Load tonight's verified counts from the database once per night (excluding the hand being processed). */
  private async ensureStats(pid: string, nightId: string | null, handId: string) {
    const s = this.stat(pid);
    if (s.initNight === (nightId ?? '-')) return;
    // Rebuild tonight's counts from the database, so a restart never makes a dealer quote a wrong number.
    const hs = (await this.c.store.qualityHands(pid)).filter((h) => h.tableCode === this.c.tableCode && h.nightId === nightId && h.handId !== handId);
    s.graded = 0; s.correct = 0; s.wcw = 0; s.mistakes = 0; s.kinds = new Map();
    for (const h of hs) {
      const g = h.decisions.filter((d) => d.graded !== false);
      s.graded += g.length; s.correct += g.filter((d) => d.correct).length;
      const bad = g.filter((d) => !d.correct);
      s.mistakes += bad.length;
      for (const b of bad) s.kinds.set(`${b.phase}:${b.action}>${b.recommended}`, (s.kinds.get(`${b.phase}:${b.action}>${b.recommended}`) ?? 0) + 1);
      if (bad.length && h.mainNet > 0) s.wcw++;
    }
    s.initNight = nightId ?? '-';
  }

  /** Called once per applied settlement. Returns how many lines were said (for tests). */
  async afterRound(f: RoundFacts): Promise<number> {
    try {
      this.round++;
      if (this.sessionNight !== f.nightId) { this.sessionNight = f.nightId; this.session.clear(); }
      const L = this.level();
      // Streaks and stats are tracked even on a Professional table, so switching attitude mid-night stays accurate.
      const cands: { cat: RoastCategory; pid?: string; vars: RoastVars; pri: number }[] = [];
      let mistakesAll = 0; const mistakers: string[] = []; const sameKinds = new Map<string, number>();
      for (const p of f.players) {
        await this.ensureStats(p.pid, f.nightId, f.handId);
        const s = this.stat(p.pid);
        const graded = p.decisions.filter((d) => d.graded !== false);
        const bad = graded.filter((d) => !d.correct);
        const won = p.mainNet > 0, lost = p.mainNet < 0;
        // Tonight's verified counts, including this hand.
        s.graded += graded.length; s.correct += graded.length - bad.length; s.mistakes += bad.length;
        for (const b of bad) s.kinds.set(`${b.phase}:${b.action}>${b.recommended}`, (s.kinds.get(`${b.phase}:${b.action}>${b.recommended}`) ?? 0) + 1);
        if (bad.length && won) s.wcw++;
        mistakesAll += bad.length;
        if (bad.length) mistakers.push(p.pid);
        for (const b of bad) sameKinds.set(`${b.phase}:${b.action}>${b.recommended}`, (sameKinds.get(`${b.phase}:${b.action}>${b.recommended}`) ?? 0) + 1);
        const prevLose = s.loseStreak;
        s.loseStreak = lost ? s.loseStreak + 1 : 0; s.winStreak = won ? s.winStreak + 1 : 0;
        s.checks = p.checkedThrough ? s.checks + 1 : 0;
        if (s.bragAt) s.bragHands++;
        const base: RoastVars = { name: p.name, game: GAME[f.game], hand: p.handName, dealerHand: f.dealerHand, amount: formatMoney(Math.abs(p.mainNet)) };
        if (s.wcw >= 2) base.wcw = String(s.wcw);
        if (s.graded >= 8) base.acc = `${Math.round((s.correct / s.graded) * 100)}%`;
        if (s.mistakes >= 2) base.mistakes = String(s.mistakes);
        const add = (cat: RoastCategory, vars: RoastVars = {}) => cands.push({ cat, pid: p.pid, vars: { ...base, ...vars }, pri: RULES[cat].priority });
        const has = (pred: (d: DecisionRecord) => boolean) => bad.some(pred);

        // Major, positive (or at least spectacular) events first.
        if (p.progressiveWin && p.progressiveWin >= 500_000) add('progressive', { amount: formatMoney(p.progressiveWin) });
        if (p.royal) add('royal');
        if (p.badBeatWin) add('badBeat', { amount: formatMoney(p.badBeatWin) });
        if (p.improbable) add('improbable', { hand: p.improbable });
        // Verified Blackjack blunders (mid-hand short remarks already happened; the settled hand can still sting).
        if (p.bj?.hit20 && !this.midDone.has(`${p.pid}:hit20`)) add('hit20', { total: '20' });
        if (p.bj?.split10 && !this.midDone.has(`${p.pid}:split10`)) add('split10');
        if (has((d) => (d.action as string) === 'double')) add('badDouble');
        if (f.game === 'tcp' && has((d) => d.action === 'fold')) add('tcpFold');
        if (f.game === 'uth' && has((d) => d.phase === 'river' && d.action === 'fold')) add('badFold');
        if (f.game === 'uth' && has((d) => d.phase === 'river' && d.action === 'play1')) add('badCall');
        if (bad.length && won) add('wrongWin');
        else if (bad.length && lost) add('wrongLoss');
        if (!bad.length && graded.length && lost) add('rightLoss');
        if (s.bragAt && s.bragHands <= 2 && this.c.now() - s.bragAt < 5 * 60_000 && lost) { add('bragLoss'); s.bragAt = 0; }
        if (lost && s.loseStreak === 5) add('lose5', { streak: '5' });
        if (lost && s.loseStreak >= 10 && s.loseStreak % 5 === 0) add('lose10', { streak: String(s.loseStreak) });
        if (won && [4, 7, 10, 15, 20].includes(s.winStreak)) add('winStreak', { streak: String(s.winStreak) });
        if (won && prevLose >= 5) add('comebackWin', { streak: String(prevLose) });
        if (p.checkedThrough && s.checks > 0 && s.checks % 4 === 0) add('checker', { streak: String(s.checks) });
        if (p.bj?.busted && !p.bj.hit20) add('bust', { total: p.bj.total });
        if (p.natural) add('natural');
        // Rivalry callback: once per shift, a dealer who has dealt this player many hands on earlier shifts says so.
        const rk = `${this.c.dealer().id}:${p.pid}`;
        if (!this.rivalChecked.has(rk) && this.consentOf(p.pid).targeting) {
          this.rivalChecked.add(rk);
          const r = await this.c.store.rivalries(this.c.dealer().id, [p.pid]).then((m) => m.get(p.pid)).catch(() => undefined);
          if (r && r.witnessed >= RIVALRY_MIN) add('rivalry', { witnessed: String(r.witnessed) });
        }
        // §34.11 Blackjack bonus outcomes, from the recorded side-bet results only.
        const sw = (p.bjSides ?? []).filter((x) => x.result === 'win');
        const sl = (p.bjSides ?? []).filter((x) => x.result === 'lose');
        const t213 = sw.find((x) => x.id === 'twentyone3'), top3 = sw.find((x) => x.id === 'top3');
        if (t213 && top3) add('doubleThree', { amount: formatMoney(t213.net + top3.net) });
        const best = [...sw].sort((a, b) => b.net - a.net)[0];
        if (best && best.combo && !(t213 && top3 && (best === t213 || best === top3))) add('bonusWin', { bet: best.bet, combo: best.combo, amount: formatMoney(best.net) });
        if (sl.length >= 3 && !sw.length) add('sideSweep', { count: String(sl.length) });
        if (p.bjSides && sw.length && Math.abs(p.mainNet) <= p.opening && p.sideNet >= 10 * p.opening) add('smallMainBig', { amount: formatMoney(p.sideNet) });
        if (p.sideNet >= Math.max(25_000, 10 * p.opening) && !p.progressiveWin && !p.bjSides?.length) add('sideWin', { amount: formatMoney(p.sideNet) });
        // Session-level patterns (verified counts only).
        const repeated = bad.some((b) => (s.kinds.get(`${b.phase}:${b.action}>${b.recommended}`) ?? 0) >= 3);
        if (bad.length && ((s.graded >= 10 && s.correct / s.graded < 0.55) || repeated)) add('ignoresStrategy', { acc: s.graded >= 8 ? `${Math.round((s.correct / s.graded) * 100)}%` : undefined, mistakes: String(s.mistakes) });
        // Comedic rivalry records (never read by dealing or payouts).
        const big = p.totalNet <= -Math.max(50_000, 20 * p.opening);
        {
          // `witnessed` counts hands this dealer has dealt the player (one per settled round), read back by 'rivalry'.
          const ev: RivalryEvent | undefined = p.bj?.hit20 ? { kind: 'hit20' } : p.bj?.split10 ? { kind: 'split10' } : p.progressiveWin && bad.length ? { kind: 'jackpotDespite', amount: p.progressiveWin }
            : big ? { kind: 'bigLoss', amount: -p.totalNet } : s.mistakes >= 5 && s.mistakes - bad.length < 5 ? { kind: 'wrong5', amount: s.mistakes } : undefined;
          const mockedThenWon = this.lastMocked === p.pid && p.mainNet >= 10 * p.opening ? 1 : 0;
          this.bumpRivalry(p.pid, { witnessed: 1, wins: won ? 1 : 0, jackpots: p.progressiveWin ? 1 : 0, mockedThenWon }, ev);
        }
        if (cands.some((c) => c.pid === p.pid && c.cat === 'bragLoss')) this.bumpRivalry(p.pid, {}, { kind: 'bragLoss' });
      }
      this.midDone.clear();
      // Group events.
      const n = f.players.length;
      if (n >= 3 && f.players.every((p) => p.mainNet < 0)) cands.push({ cat: 'tableLoses', vars: { count: String(n), game: GAME[f.game] }, pri: RULES.tableLoses.priority });
      if (mistakers.length >= 2) cands.push({ cat: 'groupMistakes', vars: { count: String(mistakers.length), game: GAME[f.game] }, pri: RULES.groupMistakes.priority });
      // Several players winning DIFFERENT bonus bets in the same round.
      const bonusWinners = f.players.map((p) => new Set((p.bjSides ?? []).filter((x) => x.result === 'win').map((x) => x.id))).filter((x) => x.size);
      if (bonusWinners.length >= 2 && new Set(bonusWinners.flatMap((x) => [...x])).size >= 2)
        cands.push({ cat: 'multiBonus', vars: { count: String(bonusWinners.length) }, pri: RULES.multiBonus.priority });
      if (L < 1) return 0;

      // Meltdown: rare, only at Complete Fucking Menace and No Mercy, never more than once per 30 rounds.
      const jackpotFool = f.players.some((p) => (p.progressiveWin || p.royal || p.badBeatWin) && p.decisions.some((d) => d.graded !== false && !d.correct));
      const sameMistake = [...sameKinds.values()].some((k) => k >= 3);
      if (L >= 3 && this.round - this.lastMeltdown >= 30 && ((mistakesAll >= 3 && mistakers.length >= 2) || jackpotFool || sameMistake) && this.c.rand(100) < 50) {
        if (this.say('meltdown', L, { count: String(Math.max(mistakers.length, 1)), game: GAME[f.game] }, { meltdown: true, allowLong: true })) {
          this.lastMeltdown = this.round;
          return 1;
        }
      }

      // Choose what to say: majors always; otherwise the most important personal line and the most important group line.
      const minorChance = [0, 30, 45, 60, 70][L];
      const usable = cands.filter((cnd) => {
        const rule = RULES[cnd.cat];
        if (!cnd.pid) return true;
        const cs = this.consentOf(cnd.pid);
        if (!cs.targeting) return false;                                      // never roast someone who opted out
        const st = this.stat(cnd.pid);
        if (rule.cooldown && this.round - (st.cats.get(cnd.cat) ?? -99) <= rule.cooldown) return false;
        return true;
      }).sort((a, b) => b.pri - a.pri);
      let said = 0; const done = new Set<string>();
      let personal = 0, group = 0;
      for (const cnd of usable) {
        const rule = RULES[cnd.cat];
        if (cnd.pid && done.has(cnd.pid)) continue;
        if (!rule.major) {
          if (cnd.pid ? personal >= 1 : group >= 1) continue;
          if (cnd.pri < 45 && this.c.rand(100) >= minorChance) continue;
          if (cnd.pid && this.round - this.stat(cnd.pid).lastRoundRoasted <= 1 && cnd.pri < 50) continue;
        }
        if (said >= 3) break;
        const cap = cnd.pid ? this.cap(cnd.pid) : L;
        const ok = this.say(cnd.cat, cap, cnd.vars, { targetId: cnd.pid, allowLong: cnd.pri >= 50 || rule.major });
        if (!ok) continue;
        said++; if (cnd.pid) { done.add(cnd.pid); personal++; } else group++;
      }
      return said;
    } catch (e) {
      console.warn('[roast]', (e as Error).message);
      return 0;
    }
  }
}

export interface RivalryEvent { kind: 'hit20' | 'split10' | 'bigLoss' | 'wrong5' | 'jackpotDespite' | 'bragLoss'; amount?: number; at?: number }
/** Hands a dealer must have dealt a player (on earlier shifts) before the rivalry callback can fire. */
export const RIVALRY_MIN = 25;

export interface RivalryRow { witnessed: number; wins: number; jackpots: number; mockedThenWon: number; events: RivalryEvent[] }

/** A remembered event as a past-tense phrase ("Last shift you {grudge}."). Only real stored events get here. */
export function grudgePhrase(e: RivalryEvent): string {
  switch (e.kind) {
    case 'hit20': return 'hit on twenty';
    case 'split10': return 'split a pair of tens';
    case 'bigLoss': return `dropped ${formatMoney(e.amount ?? 0)} in a single hand`;
    case 'wrong5': return `made ${e.amount ?? 5} strategy mistakes in one night`;
    case 'jackpotDespite': return `won a ${formatMoney(e.amount ?? 0)} jackpot right after a wrong call`;
    case 'bragLoss': return 'talked trash in chat and lost the very next hand';
  }
}
