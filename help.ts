import { BJ_RULES_VERSION, DEFAULT_BJ_RULES, rulesSummary } from '../../shared/blackjack.js';
import { styleEvent } from '../cosmetics.js';
import { BLIND_PAYTABLE, RULES_VERSION, TRIPS_PAYTABLE, TRIPS_VARIANTS, STADIUM_UTH_SOURCE, type TripsVariantId } from '../../shared/rules.js';
import type { TableConfig } from '../../shared/protocol.js';
import { BAD_BEAT_VARIANTS, PAIRS_ORDER, PAIRS_VARIANTS, type BadBeatVariant, type PairsVariant } from '../../shared/sidebets.js';
import { PROGRESSIVE, progSetup, progVariantsFor, type ProgGame, type ProgProfile } from '../../shared/progressive.js';
import { ANTE_BONUS, PAIR_PLUS, PAIR_PLUS_VARIANTS, SIX_CARD, TCP_RULES_VERSION, TCP_SOURCES } from '../../shared/tcp.js';
import { BJ_SIDES, enabledBjSides, type BjSideDef } from '../../shared/bjsides.js';
import { h, modal, money } from '../dom.js';

export function openHelp() {
  styleEvent('tutorial');
  const pay = (rows: [string, string][]) => h('table', { class: 'paytable' },
    ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))));
  const body = h('div', { class: 'help' },
    h('p', {}, 'Everyone at the table plays their own hand against the dealer. You never bet against the other players, and you all share the same five community cards and the same dealer hand.'),
    h('h3', {}, 'A hand, step by step'),
    h('ol', { class: 'steps' },
      h('li', {}, h('b', {}, 'Bet. '), 'Place an Ante. An equal Blind bet goes down automatically. Trips+ is an optional side bet. You need enough left over for a 1× Play bet.'),
      h('li', {}, h('b', {}, 'Pre-flop. '), 'Look at your two cards. Play 4× or 3× your Ante, or check.'),
      h('li', {}, h('b', {}, 'Flop. '), 'Three community cards. If you checked, play 2× or check again.'),
      h('li', {}, h('b', {}, 'River. '), 'The last two cards. If you still haven’t played, play 1× or fold (you lose Ante and Blind).'),
      h('li', {}, h('b', {}, 'Showdown. '), 'The dealer turns over two cards. Best five cards from seven win.')),
    h('h3', {}, 'How each bet is paid'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Play: '), 'pays 1 to 1 if you beat the dealer, pushes on a tie.'),
      h('li', {}, h('b', {}, 'Ante: '), 'pays 1 to 1 if you win, but pushes when the dealer doesn’t have at least a pair.'),
      h('li', {}, h('b', {}, 'Blind: '), 'pays the table below when you win with a straight or better, pushes on other wins and ties, loses when you lose. As in a casino, the 3 to 2 flush payout is rounded down to the dollar (a $25 Blind on a flush pays $37).'),
      h('li', {}, h('b', {}, 'Trips+: '), 'pays on your own hand, win or lose — even if you fold.'),
      h('li', {}, h('b', {}, 'Ultimate Pairs: '), 'pays on your two hole cards alone — a pair, or an ace with a king, queen or jack. Still pays if you fold.'),
      h('li', {}, h('b', {}, 'Bad Beat: '), 'pays when the losing hand at showdown is Three of a Kind or better, whether that’s yours or the dealer’s. Ties lose. Needs a Trips+ bet. Your real seven-card hand counts even if you folded.'),
      h('li', {}, h('b', {}, '$5 Progressive: '), 'a fixed $5 bet on a jackpot shared by every table. It is decided by your two cards and the flop, pays even if you fold later, and the $5 is not returned on a win. A royal flush takes the whole jackpot.')),
    h('div', { class: 'pay-grid' },
      h('div', {}, h('h4', {}, 'Blind'), pay(Object.entries(BLIND_PAYTABLE).map(([k, [n, d]]) => [k, `${n} to ${d}`]))),
      h('div', {}, h('h4', {}, 'Trips+'), pay(Object.entries(TRIPS_PAYTABLE).map(([k, n]) => [k, `${n} to 1`])))),
    h('h3', {}, 'Bonus bet pay tables'),
    h('p', {}, 'Each table uses one complete pay table for each bonus bet. The ones in use are shown at the table under Pay tables.'),
    h('div', { class: 'pay-grid' }, ...Object.values(PAIRS_VARIANTS).map(pairsTable)),
    h('div', { class: 'pay-grid' }, ...Object.values(BAD_BEAT_VARIANTS).map(badBeatTable)),
    h('div', { class: 'pay-grid' }, progressiveTable()),
    h('h3', {}, 'After the round'),
    h('p', {}, 'Once a hand is settled every player’s cards are turned face up, folded hands included, the way a dealer spreads them at a real table. Nobody sees another player’s cards while the hand is being played.'),
    h('h3', {}, 'Three Card Poker'),
    h('p', {}, 'The host can switch the table to Three Card Poker between hands. Everyone keeps their seat and chips.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Place an Ante. Pair Plus and Six Card Bonus are optional. Keep enough free for a Play bet equal to your Ante.'),
      h('li', {}, 'You and the dealer each get three cards. Decide once: Play 1× or Fold. Standard strategy: play Queen-6-4 or better.'),
      h('li', {}, 'The dealer qualifies with Queen high or better. If not, your Ante pays 1:1 and Play pushes. If so, the higher hand wins Ante and Play 1:1; a tie pushes.'),
      h('li', {}, 'Three-card ranks: Straight Flush, Three of a Kind, Straight, Flush, Pair, High Card — a straight beats a flush. A-2-3 is the lowest straight, A-K-Q the highest.')),
    h('div', { class: 'pay-grid' }, ...tcpTables()),
    h('h3', {}, 'Blackjack'),
    h('p', {}, 'The host can also switch to Blackjack. Everyone plays against the dealer from one six-deck shoe, taking turns in seat order.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Place one bet (whole dollars). You get two cards face up; the dealer gets one up and one face down.'),
      h('li', {}, 'If the dealer shows an Ace you may take insurance (up to half your bet; pays 2:1 if the dealer has blackjack). With an Ace or a ten showing, the dealer then checks for blackjack.'),
      h('li', {}, 'On your turn: Hit, Stand, Double (one more card for a second bet), Split a pair into two hands (up to four), or Surrender if the host allows it. Doubling and splitting need a bet equal to your original wager.'),
      h('li', {}, 'The dealer draws to 17 and stands on all 17s. Beat the dealer without going over 21 to win 1:1; a blackjack pays 3:2; ties push.')),
    h('ul', {}, ...rulesSummary(DEFAULT_BJ_RULES).map((x) => h('li', {}, x))),
    h('h3', {}, 'Timers'),
    h('p', {}, 'At multiplayer tables the server runs a decision clock. If yours runs out you check pre-flop and on the flop, and fold on the river (or play basic strategy, if you turn that on in Settings). Disconnecting doesn’t stop the table; your seat is held for two minutes.'),
    h('h3', {}, 'Keyboard'),
    h('p', {}, '4, 3, 2, 1 to play that multiple · C to check · F to fold · Enter to deal in.'),
    h('p', { class: 'muted' }, 'Chips are virtual and have no cash value.'));
  modal('How to play', body, { wide: true });
}

const n = (x: number) => x.toLocaleString('en-US');
/** Three Card Poker pay tables: Ante Bonus, Pair Plus, Six Card Bonus. */
export function tcpTables(pairPlusVariant?: string) {
  const rows = (o: Partial<Record<string, number>>) => Object.entries(o).map(([k, v]) => [k, `${v!.toLocaleString('en-US')} to 1`] as [string, string]);
  const pp = pairPlusVariant ? PAIR_PLUS_VARIANTS[pairPlusVariant] : null;
  return [
    h('div', {}, h('h4', {}, 'Ante Bonus'), payRows(rows(ANTE_BONUS)), h('p', { class: 'muted tiny' }, 'Automatic with a Play bet, paid on the Ante even if the dealer wins. Not after a fold.')),
    h('div', {}, h('h4', {}, `Pair Plus${pp ? ` — ${pp.name}` : ''}`), payRows(rows(pp?.table ?? PAIR_PLUS)), h('p', { class: 'muted tiny' }, 'Your three cards only. Pays even if you fold. Highest line only (a Mini Royal is A-K-Q of one suit, paid only by Mini Royal tables). Source: Wizard of Odds Pairplus tables.')),
    h('div', {}, h('h4', {}, 'Six Card Bonus'), payRows(rows(SIX_CARD)), h('p', { class: 'muted tiny' }, 'Best five of your three + the dealer’s three, normal poker ranks. Pays even if you fold.')),
  ];
}

const payRows = (rows: [string, string][]) => h('table', { class: 'paytable' }, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))));
const sourceLine = (v: PairsVariant | BadBeatVariant) => h('p', { class: 'muted tiny' }, 'Source: ',
  h('a', { href: v.source.url, target: '_blank', rel: 'noopener' }, v.source.title), `, ${v.source.section}.`);

export function pairsTable(v: PairsVariant) {
  return h('div', {}, h('h4', {}, v.name), payRows(v.rows.map((r) => [r.label, `${n(r.payout)} to 1`])),
    h('p', { class: 'muted tiny' }, 'Only the highest winning line pays. Settles at showdown; stays live if you fold.'), sourceLine(v));
}
export function badBeatTable(v: BadBeatVariant) {
  return h('div', {}, h('h4', {}, v.name), payRows(v.rows.map((r) => [`Losing ${r.losing}`, `${n(r.payout)} to 1`])),
    h('p', { class: 'muted tiny' }, 'Pays on the losing hand. Ties lose. Requires Ante, Blind and Trips+. Stays live if you fold.'), sourceLine(v));
}

export function progressiveTable(jackpot?: number) {
  const rows: [string, string][] = PROGRESSIVE.rows.map((r) => [r.hand,
    r.kind === 'meter' ? (r.pct === 100 ? `100% of jackpot${jackpot ? ` (${money(jackpot)})` : ''}` : `${r.pct}% of jackpot`) : money(r.amount!)]);
  const envy = Object.entries(PROGRESSIVE.envy).map(([k, v]) => `${money(v!)} for each ${k}`).join(', ');
  return h('div', {}, h('h4', {}, `${PROGRESSIVE.name} — ${money(PROGRESSIVE.wager)}`), payRows(rows),
    h('p', { class: 'muted tiny' }, `${PROGRESSIVE.cards}. Envy bonus to every other progressive bettor at the table: ${envy}. `
      + `Awards are paid instead of the $5, not in addition to it. Percentages are paid in whole dollars. The jackpot starts at ${money(PROGRESSIVE.seed)} and `
      + `${money(PROGRESSIVE.contribution)} of every $5 goes on the meter. Stays live if you fold.`),
    h('p', { class: 'muted tiny' }, 'Sources: ', ...PROGRESSIVE.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)]),
      '. Seed, meter rate and fold handling are this site’s choices.'));
}

/** The pay tables in force at one table — shown before anyone bets. */
export function openPayTables(c: TableConfig, jackpot?: number) {
  const suit = ['♠ Spades', '♥ Hearts', '♦ Diamonds', '♣ Clubs'][c.jackpotSuit ?? 0];
  if (c.game === 'bj') {
    const r = { ...DEFAULT_BJ_RULES, lateSurrender: !!c.bjSurrender };
    const open = c.bjSides ? enabledBjSides(c.bjSides) : [];
    modal(`Blackjack rules at ${c.name}`, h('div', { class: 'help' },
      h('ul', {}, ...rulesSummary(r).map((x) => h('li', {}, x))),
      h('div', { class: 'pay-grid' }, h('div', {}, h('h4', {}, 'Payouts'), payRows([['Blackjack (Ace + 10 on the first two cards)', '3 to 2'], ['Win', '1 to 1'], ['Insurance (dealer has blackjack)', '2 to 1'], ['Surrender', 'half your bet back'], ['Tie', 'push']]))),
      h('p', { class: 'muted' }, `Bets ${'$'}${c.minAnte / 100}–${'$'}${c.maxAnte / 100}, whole dollars. Doubling and each split add a bet equal to your original wager, and are only offered when your stack covers it.`),
      h('h3', {}, 'Bonus bets at this table'),
      open.length ? h('div', { class: 'pay-grid' }, ...open.map((d) => bjSideTable(d, c.bjSides.bets[d.id]?.variant, c.bjSides.bets[d.id]))) : h('p', { class: 'muted' }, 'Classic Blackjack: no side bets at this table.'),
      c.bjProg?.on ? h('div', { class: 'pay-grid' }, progTable('bj', c.bjProg.variant, c.bjProg.profile, jackpot, suit)) : null,
      open.length ? h('p', { class: 'muted tiny' }, 'The six All Bets wagers are Nevada’s eight-deck All Bets Blackjack pay tables run on this six-deck shoe — an adapted profile, not the approved eight-deck game; the published house edges do not apply.') : null,
      h('p', { class: 'muted tiny' }, `Rules ${BJ_RULES_VERSION}. The dealer never changes these rules, and the shoe is never reshuffled because of anyone's wins or losses. Side bets never change the cards dealt.`)), { wide: true });
    return;
  }
  if (c.game === 'tcp') {
    modal(`Pay tables at ${c.name}`, h('div', { class: 'help' },
      h('p', {}, h('b', {}, 'Three Card Poker. '), 'Ranks: Straight Flush, Three of a Kind, Straight, Flush, Pair, High Card. Dealer qualifies with Queen high or better. Not qualified: Ante pays 1:1, Play pushes. Otherwise higher hand wins Ante and Play 1:1; a tie pushes.'),
      h('div', { class: 'pay-grid' }, ...tcpTables(c.pairPlusVariant)),
      c.tcpProg?.on ? h('div', { class: 'pay-grid' }, progTable('tcp', c.tcpProg.variant, c.tcpProg.profile, jackpot, suit)) : h('p', { class: 'muted' }, 'The Three Card Progressive is closed at this table.'),
      h('p', { class: 'muted' }, `Bonus limits: Pair Plus up to $${c.maxPairPlus / 100}, Six Card Bonus up to $${c.maxSixCard / 100}. Each game has its own jackpot meter; switching games never moves or resets one.`),
      h('p', { class: 'muted tiny' }, `Rules ${TCP_RULES_VERSION}. Sources: `, ...TCP_SOURCES.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)]))), { wide: true });
    return;
  }
  const trips = TRIPS_VARIANTS[(c.tripsVariant ?? 'uth-02') as TripsVariantId];
  modal(`Pay tables at ${c.name}`, h('div', { class: 'help' },
    h('div', { class: 'pay-grid' },
      h('div', {}, h('h4', {}, 'Blind'), payRows(Object.entries(BLIND_PAYTABLE).map(([k, [a, b]]) => [k, `${a} to ${b}`]))),
      h('div', {}, h('h4', {}, `Trips — ${trips.name}`), payRows(Object.entries(trips.table).map(([k, x]) => [k, `${x} to 1`])),
        h('p', { class: 'muted tiny' }, 'Source: ', h('a', { href: STADIUM_UTH_SOURCE.url, target: '_blank', rel: 'noopener' }, STADIUM_UTH_SOURCE.title)))),
    h('div', { class: 'pay-grid' }, pairsTable(PAIRS_VARIANTS[c.pairsVariant]), badBeatTable(BAD_BEAT_VARIANTS[c.badBeatVariant])),
    c.progressive ? h('div', { class: 'pay-grid' }, progTable('uth', c.uthProg?.variant ?? 'five-card-5', c.uthProg?.profile ?? 'casino', jackpot, suit)) : h('p', { class: 'muted' }, 'The progressive is switched off at this table.'),
    h('p', { class: 'muted' }, `Blind flush (3 to 2) is rounded down to the dollar. Bonus limits: Trips up to $${c.maxTrips / 100}, Ultimate Pairs up to $${c.maxPairs / 100}, Bad Beat up to $${c.maxBadBeat / 100}. Pay tables only change between hands, and every change is announced in chat.`),
    h('p', { class: 'muted tiny' }, `Rules version ${RULES_VERSION}. Every hand records the rules version and pay tables it was played under.`)),
    { wide: true });
}

/** One progressive's table at a profile. "For 1": awards are the whole payout; the wager is not returned. */
export function progTable(game: ProgGame, variantId: string, profile: ProgProfile, jackpot?: number, suit?: string) {
  let p;
  try { p = progSetup(variantId, profile); } catch { return h('p', { class: 'muted' }, 'Unknown progressive.'); }
  const v = p.variant;
  const rows: [string, string][] = v.rows.map((r) => [r.label.replace('jackpot suit', `jackpot suit (${suit ?? '♠ Spades'})`),
    r.kind === 'meter' ? (r.pct === 100 ? `100% of the meter${jackpot ? ` (${money(jackpot)})` : ''}` : `${r.pct}% of the meter`) : `${money(Math.round(r.amount! * p.scale))} for ${money(p.wager)}`]);
  const envy = Object.entries(v.envy).map(([k, x]) => `${money(Math.round(x * p.scale))} for each ${k}`).join(', ');
  return h('div', {}, h('h4', {}, `${v.name} — ${money(p.wager)}`),
    h('p', { class: `prog-profile ${p.custom ? 'custom' : ''}` }, p.custom
      ? `Custom High Roller profile: ${money(p.wager)} bet, meter starts at ${money(p.seed)}. Fixed awards scale with the bet. No house edge is shown because none has been computed for this configuration.`
      : `Published profile: ${money(p.wager)} bet as documented, meter starts at ${money(p.seed)}.`),
    payRows(rows),
    h('p', { class: 'muted tiny' }, `${v.cards}. ${envy ? `Envy bonus to every other ${v.short} bettor at the table: ${envy}. ` : 'No Envy bonus. '}`
      + `Awards are “for 1”: paid instead of the bet, not in addition. Percentages are paid in whole dollars. ${v.contributionPct}% of every bet goes on this meter; only the highest award applies.`),
    h('ul', { class: 'muted tiny' }, ...v.notes.map((x) => h('li', {}, x))),
    h('p', { class: 'muted tiny' }, 'Sources: ', ...v.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)])));
  void game;
}

/** One Blackjack side bet: rule, the selected table, limits, source and any adaptation note. */
export function bjSideTable(d: BjSideDef, variantId?: string, set?: { min: number; max: number }) {
  if (d.status !== 'playable') return h('div', { class: 'side-off' }, h('h4', {}, `${d.name} — not offered`), h('p', { class: 'muted tiny' }, d.unavailable ?? ''));
  const v = d.variants.find((x) => x.id === variantId) ?? d.variants[0];
  return h('div', {}, h('h4', {}, `${d.name}${d.variants.length > 1 ? ` — ${v.name}` : ''}`),
    h('p', { class: 'tiny' }, d.rule),
    payRows(v.rows.map((r) => [r.label, `${n(r.pays)} to 1`])),
    h('p', { class: 'muted tiny' }, `${set ? `Bets ${money(set.min)}–${money(set.max)}. ` : ''}Highest line only. Settles ${d.phase === 'initial' ? 'right after the deal' : d.phase === 'dealer-hole' ? 'when the dealer’s hole card is shown' : 'when the dealer’s hand is complete'}; independent of your hand.`),
    h('ul', { class: 'muted tiny' }, ...d.notes.map((x) => h('li', {}, x))),
    h('p', { class: 'muted tiny' }, 'Source: ', ...d.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)])));
}
export const BJ_UNAVAILABLE = () => BJ_SIDES.filter((d) => d.status !== 'playable');

/** Form fields for choosing pay tables and bonus limits (create table + host settings). */
export function sideBetFields(c?: Partial<TableConfig>) {
  const sel = (name: string, label: string, opts: { id: string; name: string }[], val?: string) =>
    h('label', {}, label, h('select', { name }, ...opts.map((o) => h('option', { value: o.id, selected: o.id === val }, o.name))));
  const num = (name: string, label: string, value: number) => h('label', {}, label, h('input', { name, type: 'number', value, min: 0, step: 1 }));
  const profiles = [{ id: 'casino', name: 'Published (casino) profile' }, { id: 'high-roller', name: 'High Roller — custom ($5, $25,000 start)' }];
  const progs = (g: ProgGame) => progVariantsFor(g).map((v) => ({ id: v.id, name: v.name }));
  return [
    sel('tripsVariant', 'Trips pay table (UTH)', Object.values(TRIPS_VARIANTS).map((t) => ({ id: t.id, name: `${t.name}${t.id === 'uth-02' ? ' (default)' : ''}` })), c?.tripsVariant ?? 'uth-02'),
    sel('pairsVariant', 'Ultimate Pairs pay table', PAIRS_ORDER.map((id) => PAIRS_VARIANTS[id]), c?.pairsVariant ?? 'up-bonus4'),
    sel('badBeatVariant', 'Bad Beat pay table', Object.values(BAD_BEAT_VARIANTS), c?.badBeatVariant ?? 'bb-01'),
    num('maxPairs', 'Maximum Ultimate Pairs ($)', (c?.maxPairs ?? 2500) / 100),
    num('maxBadBeat', 'Maximum Bad Beat ($)', (c?.maxBadBeat ?? 2500) / 100),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'progressive', checked: c?.progressive !== false }), ' Offer the Hold’em progressive'),
    sel('uthProgVariant', 'Hold’em progressive', progs('uth'), c?.uthProg?.variant ?? 'five-card-5'),
    sel('uthProgProfile', 'Hold’em progressive profile', profiles, c?.uthProg?.profile ?? 'casino'),
    sel('pairPlusVariant', 'Pair Plus pay table (Three Card Poker)', Object.values(PAIR_PLUS_VARIANTS), c?.pairPlusVariant ?? 'pp-8'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'tcpProgOn', checked: c?.tcpProg?.on !== false }), ' Offer the Three Card Progressive'),
    sel('tcpProgVariant', 'Three Card Progressive table', progs('tcp'), c?.tcpProg?.variant ?? 'tcp-pt7'),
    sel('tcpProgProfile', 'Three Card Progressive profile', profiles, c?.tcpProg?.profile ?? 'high-roller'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'bjProgOn', checked: c?.bjProg?.on !== false }), ' Offer the 21+3 Progressive (Blackjack)'),
    sel('bjProgProfile', '21+3 Progressive profile', profiles, c?.bjProg?.profile ?? 'high-roller'),
    sel('jackpotSuit', 'Jackpot suit (suit-specific awards)', ['♠ Spades', '♥ Hearts', '♦ Diamonds', '♣ Clubs'].map((x, i) => ({ id: String(i), name: x })), String(c?.jackpotSuit ?? 0)),
  ];
}

export function readSideBetFields(fd: FormData) {
  const d = (k: string) => Math.round(Number(fd.get(k)) * 100);
  return { pairsVariant: String(fd.get('pairsVariant')), badBeatVariant: String(fd.get('badBeatVariant')), maxPairs: d('maxPairs'), maxBadBeat: d('maxBadBeat'),
    progressive: fd.get('progressive') === 'on', tripsVariant: String(fd.get('tripsVariant')), pairPlusVariant: String(fd.get('pairPlusVariant')),
    uthProg: { variant: String(fd.get('uthProgVariant')), profile: String(fd.get('uthProgProfile')) },
    tcpProg: { on: fd.get('tcpProgOn') === 'on', variant: String(fd.get('tcpProgVariant')), profile: String(fd.get('tcpProgProfile')) },
    bjProg: { on: fd.get('bjProgOn') === 'on', variant: 'bj-213-16', profile: String(fd.get('bjProgProfile')) },
    jackpotSuit: Number(fd.get('jackpotSuit')) };
}
