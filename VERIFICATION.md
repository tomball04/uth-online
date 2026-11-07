# Verification report

What was actually run, where, and what it proved — and what was not tested.

**Environment:** Linux, Node.js 22.23, PostgreSQL 16 (local), Google Chrome for Testing 153, run on 2 November 2026.
**Result:** 142 of 142 automated tests passed (6 November 2026).

```
npx tsc --noEmit                 → no type errors (client, server, shared, tests)
npm test  (Vitest)               → 13 files, 134 tests passed   (78 unit + 56 multiplayer integration)
npm run test:e2e (Playwright)    → 8 tests passed in real Chrome against the production build
```

Update 6 November 2026: refinement pass — Progressive/Envy audit under concurrency, rules version, Sit Out / Sit Back In, same bet every hand, decision countdowns and action tags, Tonight running tab and night recap, chips check, results presentation, six-browser test, restore code — section 1f.

## 1g. Three Card Poker (scope addendum §23)

**Unit (13).** Three-card evaluator: every category; Straight beats Flush; Flush beats Pair; Trips beat a Straight; A-K-Q highest and A-2-3 lowest straight; no wrap-around; steel wheel lowest straight flush; trips by rank, pair then kicker, flush and high card by descending ranks, exact ties. Dealer Queen high qualifies, Jack high does not, A-2-3 counts as a straight. Settlement: non-qualifying dealer (Ante 1:1, Play push), win / loss / tie; Ante Bonus after a dealer win (5:1, 4:1, 1:1) and never after a fold; every Pair Plus category including after a fold; every Six Card Bonus category on the best five of six with five-card ranks, two pair losing, and a case where three-card ranks would differ. Strategy: Q-6-4 plays, Q-6-3 folds, and exact enumeration over exactly 18,424 dealer hands puts Q-6-4 above −1 Ante and Q-6-3 below. Display names ("Queen High", "Pair of Kings").

**Integration (5, PostgreSQL).** Non-host and unknown-game switches refused; a switch requested mid-hand is queued (`pendingGame`), a second conflicting switch refused, the Hold'em hand finishes under Hold'em rules, then the table switches: same three seats, same balances (no new bankroll), Rebet presets cleared, chat line exact, jackpot unchanged. In Three Card Poker: Trips+ and Progressive refused; three unique cards each, dealer and others face down, empty board, only Play 1× / Fold legal, a Hold'em street or 4× refused; settlement of a straight losing to dealer trips with the Ante Bonus still paid, a Q-6-4 loss, and a folded pair with Pair Plus 1:1 and Six Card full house 20:1 (no Ante Bonus); folded cards face up afterwards; ledgers reconcile; jackpot untouched; `hands.game='tcp'`, `rules_version='tcp-2026.11'`. Jack-high dealer: Ante pays, Play pushes; the trainer grades fold-with-Q-6-4 and play-with-9-5-2 as mistakes with exact EV. Disconnect during the decision: reconnect restores cards and wagers; the timer folds the absent players; trips earn the 4:1 Ante Bonus. Switching back between hands releases an uncommitted TCP bet; TCP bets refused and UTH bets accepted; jackpot intact; statistics split (1 UTH + 3 TCP = 4 hands, nets add up, TCP decisions all phase `decide`, progressive only in UTH), one combined bankroll series; replays of both games keep their own rules (TCP has no board).

**Browser (Playwright, 2 iPhone + 4 desktop).** Host switches via ☰ → Host controls → Three Card Poker with the exact confirmation text; all six screens switch; chat shows the change; same six seats and stacks; Blind and Hold'em bonus circles hidden, Pair Plus shown. Two full hands: everyone bets at once (Pair Plus, Six Card), each player sees exactly three own cards, 15 face-down cards of the other five, no board; simultaneous Play/Fold; every screen agrees on stacks, the dealer's three cards and all 18 player cards face up. Then back to Hold'em between hands: stacks unchanged, Blind circle back, Pair Plus hidden, two players deal in. No page errors.

**By eye.** Phone (393×659) and desktop, 3 and 6 players: THREE CARD POKER printing and qualifier on the felt, three dealer cards, three cards per seat without overlaps, Play 1× / Fold buttons, Bonus circle with Pair Plus and Six Card, results with Ante Bonus and side-bet detail lines.

**Not verified:** Three Card Poker on a real iPhone/Safari; host settings form for Pair Plus / Six Card limits beyond typecheck (the server limits are tested through bet validation only by code review); a 6-seat TCP layout with the longest names; Ante/Play house edge (≈3.37% of the Ante) is quoted, not recomputed. Pair Plus 40-30-6-3-1 (7.276%) and Six Card Bonus 1000-200-100-20-15-10-7 (8.561%, all 20,358,520 six-card hands) were computed here by full enumeration with the shipped evaluators. Note: the scope's Pair Plus table pays a flush 3:1; the more widely used table pays 4:1 and has a much lower house edge (about 2.3%) — say if you'd like that instead.

## 1f. Refinement pass (6 November 2026)

**Progressive and Envy audit (integration, PostgreSQL).**
* Six players at one table, five with the $5 bet, all deciding at once. Rigged flop Q♠ J♠ 10♠: Ann royal, Bo straight flush, Cy trips, Di straight, Ed two pair (then folds), Flo no progressive (folds). Asserted for every seat: the exact credit (royal = whole meter in whole dollars + $1,500 Envy; straight flush = 10% of the reseeded meter + $5,000 Envy; trips $45 + $6,500; straight $150 + $6,500; Ed folded and still gets $6,500 Envy; Flo gets nothing); the meter afterwards; two `progressive_hits` rows with the right meter-before values; every player's ledger sum equals their stack; a player at another table is untouched. Envy is never taken from the meter.
* Four tables each settling a royal at the same instant, each settlement fired twice: exactly four applied, retries rejected, claims serialized on the meter row (the first takes the whole meter, each later one the reseeded meter), conservation holds (`paid + meter after = meter before + 4 × reseed`), every ledger reconciles.
* Already covered and still passing: fold eligibility, hole + flop only, seat order for several winners, rounding remainder carried into the reseed, crash recovery removing a voided hand's contribution.

**Rules version.** `RULES_VERSION = 2026.11` is stored on every hand (`hands.rules_version`), shown in the pay tables and in replays.

**Sit Out / Sit Back In, same bet every hand (integration).** Sitting out skips the next deal without losing the seat or chips; sitting back in mid-hand shows *Next hand* and deals you in after. Same bet: refused with nothing to repeat; once confirmed, the bet is re-placed and the player readied automatically at the next betting round (asserted with Ante, Trips+ and Progressive); changing the bet by hand turns it off. The server re-checks limits and affordability every hand and turns it off with a chat note if the bet can't be covered (by code review; no test drains a stack for this).

**Tonight and the recap (integration + unit).** Two rigged hands: the running tab has the right hands count, order, net per player (equal to each stack's change from the ledger), folds, best hand, biggest win and loss, best hands with hole cards, Trips+ hit and decision counts. A stranger gets 404. Only the host can End the night, not mid-hand, not twice; everyone receives `night:ended`; the ended night keeps its recap; the next hand opens a new night and the dealer says so. Unit tests cover streaks, folded hands excluded from best hands, bonus ordering, the debt award and the 5-decision minimum for "Sharpest player".

**Six-browser test (Playwright).** Two iPhone-sized and four desktop browsers at one table: everyone bets and deals in at once; on both phones all six name plates are on screen and none overlap, with no sideways scrolling; one player refreshes mid-hand and gets the same cards and turn back; another player's tab is closed, the table shows her *Away*, she returns in a new tab and acts; simultaneous decisions on every street; after settlement every screen shows the same board, the same 12 face-up hole cards and the same stacks; the Tonight tab lists six players and the chips check says *Matches your stack*. No page errors.

**Restore code (Playwright).** Copy the code from Settings on a desktop browser; on an iPhone-sized browser a wrong code is refused, the right one signs in as the same player.

**By eye (393×659 iPhone viewport, desktop 1366×860).** Seconds left on every deciding player's avatar; Checked / Deciding / Folded tags; amounts float over the name plate rather than the cards; the winning five light up first and the compact breakdown fades in after; Tonight tab and recap modal on phone and desktop; Same bet every hand row.

**Pay off and pawn shop (integration, PostgreSQL).** Zero refused; $10 paid leaves $20 owed and $5 in chips with the dealer's chat line; asking for $500 pays only the $5 you have; with no chips it's refused; mid-hand it's refused; ledger still equals the stack and the chips check reports *balanced*; the pawn-shop list has the two markers and two payoffs in order with the pawned item; reloading afterwards adds a new marker. Checked by eye on an iPhone viewport: IOU and Pay off under the bet circles, the payoff sheet, the Pawn shop list.

**Not verified in this pass:** a real iPhone or Safari (emulation only); the share image on an actual phone's share sheet (the canvas drawing runs without errors in Chrome; download is the fallback); the 4-hour automatic night rollover (logic shared with the tested manual path, but no test waits 4 hours or mocks the clock); the deploy notes' roll-back claim.

Update 3 November 2026 (later): host-chosen felt and card backs, host Set away / Move to spectators, debt counter, phone layout — section 1e.

## 1e. Host look and seat controls, debt counter, phone layout

**Integration (memory store).** Only the host can change the felt/backs; unknown values rejected; the other player's view updates and chat announces it. Host sets a player away → `sitting-out` with `awayByHost`; brings them back; a player readying comes back on their own. Host can't stand themselves up; standing a player up mid-hand flags `standingUp`, they finish the hand, then become a spectator; sitting again restores the same balance from the database.

**Integration (PostgreSQL) + unit.** A $15-bankroll table: losing everything and reloading gives `debt $15` in the ack, the seat view and chat ("Ed takes a $15 marker. Total debt: $15. … pawn your AirPods …"); a second bust gives $30 with a different joke; debt is persisted (`stacks.debt`) and in `/api/stats/me`; ledger still reconciles with the balance. Unit: pawn item is the cheapest that covers the debt, item values ascend, jokes never repeat back to back, exact line wording.

**Browser (Playwright, iPhone 13 + desktop).** Phone top bar hides Invite (menu button instead); host picks Burgundy felt and Gold backs from ☰ → Host controls → guest's page switches to `data-felt=burgundy`, `data-back=gold`; guest's Settings shows the look read-only; host taps Set away → guest sees *I'm back*, taps it, and *Deal me in* returns. No page errors.

**By eye (393×659, the size of an iPhone with Safari's bars).** 3- and 6-player tables during betting, pre-flop and settlement: no overlapping name plates, no status text under the felt, community-card centre suits smaller, seat cards show corner indices only, menu sheet. Desktop 6-seat layout re-checked for regressions.

Update 3 November 2026: casino rounding, cards face up after the round, $5 Five Card Progressive — section 1d.

## 1d. Rounding, face-up cards, progressive

**Blind rounding (unit).** The 3:2 flush payout rounds down to the dollar: $1 → $1, $20 → $30, $25 → $37; asserted that no Blind payout is ever a fraction of a dollar. This fixes the "50 cents" flush payouts.

**Folded hands shown after settlement (integration).** Folded Eli's 3♠ 5♦ and "High Card" are in every other player's view once the hand settles, and in the replay; during the hand they are still `null` for other viewers (existing redaction test still passes). Folded Ace's A♥ A♦ Ultimate Pairs combination is announced to everyone after the round.

**Progressive — unit (6).** Hole + flop only (turn/river ignored); fixed table $1,500/$250/$200/$150/$45 and nothing for two pair; Royal + Straight Flush at one table in seat order with both Envy bonuses, meter reset and the 67¢ rounding remainder carried into the new meter; Straight Flush floored at the seed; settles as a non-returned wager that survives a fold; only exactly $5 accepted, refused where the table has it off, and included in affordability.

**Progressive — integration (6 × 2 stores: PostgreSQL and in-memory).** Two tables on one server share one $10,000 meter; three $5 bets raise it by $10.50 at both tables; rigged hand: Kim A♠K♠ + Q♠J♠10♠ (Royal) → $10,010 + $1,500 envy; Ace 9♠8♠ (Straight Flush) → $1,000 + $5,000 envy; Jo folds 2♣3♦ → $6,500 envy; meter ends at exactly $10,000; ledger sums equal balances; `progressive_hits` has two rows; chat says "JACKPOT! Kim hits a Royal Flush…"; the other table gets `jackpot:hit` with `same: false` and sees the reset meter; stats show the bet and "Envy bonus"; host switching it off rejects new $5 bets. Crash-recovery test now also asserts the voided hand's $3.50 contribution is removed from the meter.

**By eye (Chrome, desktop + iPhone size).** Jackpot sign in the top bar; $5 Progressive circle toggles a fixed $5 regardless of chip; Royal banner, result line "$10,007 (Royal Flush — 100% of the jackpot; the $5 is not returned)", envy banner for the folded player, folded cards face up at Ace's seat after the round.

Update 2 November 2026 (later): table outline no longer crosses name plates; felt and card-back colours; outs on mistakes — section 1c.

Update 2 November 2026: Ultimate Pairs and Bad Beat side bets (addendum §22) added — sections 1b, 2b and browser test 4 below.

## 1. Rules engine — unit tests (21)

| Test | What it proves |
|---|---|
| Evaluator vs independent reference, 20,000 random hand pairs | The fast evaluator orders every pair exactly as a separately written brute-force evaluator does, and agrees on category |
| Category names, wheel, steel wheel, two sets, third-pair kicker | Edge cases the prototype could get wrong |
| Dealer doesn't qualify, player wins | Ante push, Play wins, Blind push |
| **Dealer doesn't qualify but beats player** | Ante push, **Play and Blind lose** (the prototype paid Play here) |
| Flush win | Blind pays 3:2 as exact integer cents (150¢ on $1) |
| Tie | Everything pushes |
| **Fold with Trips+** | Ante and Blind lose, Trips+ is paid and credited |
| Royal flush | Blind 500:1, Trips+ 50:1 |
| 2,000 random settlements | `net = credit − stake`, always an integer |
| Fractional cents | Rejected |
| Affordability | Requires Ante + Blind + Trips + 1× Play; limits; whole dollars |
| Pre-flop chart, 15 boundary hands | Matches published basic strategy (incl. K-x suited, Q6s, J8s, JT offsuit, 22 check) |
| Flop rules, 8 cases | Hidden pair, board-only pair, two pair with hole card, pocket 2s, set of 2s, four-flush with hidden 10 vs 9, straight draw |
| River solver | Enumerates exactly 990 dealer hands; wins + ties + losses = 990; nuts → play, board-plays → fold |
| EV estimates / mistake cost | Correct ordering for strong and weak hands; optimal actions cost nothing |

## 1c. Outs (3 unit tests + integration assertions)

* River dealer outs match the strategy chart: A♦3♣ on K♠9♦7♣4♥2♠ = 15 outs (pairing any board card); 6♦3♣ on the same board = 35 (adds any A, Q, J, 10, 8), and the exact solver agrees (play / fold).
* Flop: A♣8♣ on K♣7♣2♦ = 15 outs (9 clubs, 3 aces, 3 eights), 54.1% to hit by the river; board-only improvements never count; no outs pre-flop.
* Integration: Fay's timed-out river fold with pocket tens is recorded as a mistake carrying the dealer's outs (990 combinations); her flop decision carries her improvement outs. Outs are saved with each decision (migration `003_decision_outs.sql`) and shown in replays.
* Visual checks in Chrome: name plates above the rail line on desktop and iPhone; sapphire felt + navy backs applied across the table and in the Settings preview; a folded A♥A♦ hand listing its pre-flop, flop (4 outs: A×2, 9×2) and river (2 dealer outs, 96 of 990 hands) mistakes.

## 1b. Side-bet rules — unit tests (30)

| Addendum §22.8 requirement | Test |
|---|---|
| A♥A♦ pays 100:1 (either order); only the highest line pays | Bonus 4: `A♥ A♦` → 100, never 100 + 30 |
| Other pocket aces 30:1 | A♠A♣, A♥A♠, A♦A♣, A♥A♣ → 30 |
| Suited / unsuited ace-face | A-K/Q/J suited → 20; unsuited → 10 |
| Lower pocket pairs | 2-2, 7-7, 10-10, K-K → 4 |
| Non-qualifying hands | K-Q suited, A-9 suited, A-10, 7-2, K-J → lose |
| Settlement after folding | Folded A♠A♣ with $5 Ultimate Pairs → +$150, net −$20 + $150 |
| Alternate player-and-dealer aces payout | Bonus 2: player AA + dealer AA → 1,000; player AA alone → 30; all eight Bonus 2 lines; Bonus 4 never pays 1,000 |
| Dealer-dependent payout not revealed early | In-hand preview shows 30:1 with the 1,000:1 marked "pending", never confirmed |
| Player loses with Three of a Kind / Straight / Full House | 9:1 / 20:1 / 40:1, losing hand named |
| Dealer loses with Three of a Kind / Four of a Kind | 9:1 / 500:1 |
| Qualifying tie pays nothing | Both full houses tie → Bad Beat loses ("Tied hands") |
| Losing hand below Three of a Kind | Two pair loses to trips → no payout |
| Folding with the side bet active | Folded trips beaten → pays; folded full house beating dealer trips → pays; folded weak hand → loses ("a fold is not a bad beat") |
| Dealer non-qualification | Dealer high card: Ante pushes, Bad Beat loses, Trips+ still pays |
| Trips+ eligibility | Bad Beat without Trips+ rejected; with Trips+ accepted; limits and affordability enforced |
| Large payouts | $25 losing straight flush → exactly $250,000 (Bonus 01) and $187,500 (Bonus 02), integer cents |
| Main game loses, side bets win | Base −$30; Trips+ +$40, Pairs +$20, Bad Beat +$200; net +$230 = credit − stake |
| Variant registry | Every variant has a source URL, companions, fold handling and ≥ 4 lines |

## 2b. Side bets at a multiplayer table — integration tests (7, real Postgres)

1. Selected pay tables are in the table state before anyone bets.
2. Bad Beat without Trips+, negative, string, fractional and over-limit side bets are rejected by the server.
3. Three players, one rigged hand: Kim (all three bonus bets) +$185, Ace (Ultimate Pairs only, **folded**, A♥A♦) +$480, Jo (Trips+ and Bad Beat, one pair) −$40. Each line asserted: stake, multiplier, combination, credit. A duplicated `bet:place` is applied once; side bets are locked after the deal; Ace disconnects and reconnects mid-hand and still receives exactly one payout row. Ledger sums equal balances for every player.
4. Hand history stores each player's side-bet stakes, combinations, multipliers, nets and the hand's pay-table ids.
5. Chat announces "Bad Beat! Dealer's Three of a Kind beaten — 9:1 for Kim" and "Ace wins the Ultimate Pairs bonus" without revealing the folded A♥A♦; other players' views omit the folded seat's combination.
6. Statistics report each side bet separately (bets, hits, wagered, returned, net, biggest payout, winning combinations) and the main-game result apart from them.
7. Host switches to Bonus 2 / Bonus 02 between hands (announced in chat, effective next hand); an unknown pay table is refused; switching during a hand is refused.
8. Separate table on Bonus 2: player A♠A♣ vs dealer A♥A♦ — dealer cards hidden until showdown, then 1,000:1 = +$5,000, ledger reconciles.

## 2. Multiplayer integration — real server, real Socket.IO clients, real PostgreSQL (19)

Each suite starts the actual `createApp()` server on a random port with a freshly dropped-and-migrated Postgres schema, creates guests over HTTP, and drives separate `socket.io-client` connections exactly as browsers would. Decks are injected in-process for scenarios that need known cards (this hook is a constructor argument, not reachable over the network); other hands use the production CSPRNG shuffle.

| Requirement | Test and evidence |
|---|---|
| Multiple players join one table; all six seats occupied | Six clients seated 0–5; a seventh is admitted as a spectator; public listing shows 6/6 |
| Unique cards, shared community, private hole cards | Every player sees only their own two cards; all see identical flop/turn/river; dealer hidden until showdown |
| Independent decisions, different Play multipliers at one table | Ava 4×, Ben 3×, Cal check→2×, Dee check→check→1×, Eli fold, Fay never acts |
| Correct independent payouts against one dealer | Exact nets asserted: +$50, −$55 (incl. Trips+), −$40, −$30, −$25, −$20 |
| Timeout behaviour | Fay's pre-flop and flop default to check, river to fold, by server timer; recorded as timed out |
| Hidden information never sent | Raw socket traffic of all six clients scanned: no other player's cards and no dealer cards before settlement; river cards absent before the river |
| Dealer non-qualification | Rigged hand: Ante pushes; player beaten by an unqualified dealer loses Play and Blind |
| Trips+ after fold | Folded set of 9s: Trips+ +$15 credited; net −$5 |
| Affordability and reserved Play | $60 stack: $20 Ante allowed, $20 + $5 Trips rejected with the exact amount; 3×/4×/2× hidden when unaffordable; 1× always available |
| Malicious requests | Negative, zero, fractional, string, NaN, null, huge and sub-minimum bets rejected; short action ids rejected; deciding without a hand rejected; Ready without a bet rejected |
| Duplicate WebSocket messages | The same Play message sent three times concurrently → one ledger debit; a fresh id after acting is rejected |
| Stale messages | Flop action during pre-flop rejected as stale; wrong hand id rejected; illegal decision for the phase rejected; betting locked mid-hand |
| Double settlement | Calling `settleHand` again on a settled hand returns `applied: false` and changes no balance |
| Authorization | Socket with an invalid token refused; non-host cannot kick or change settings; spectator cannot take an occupied or nonexistent seat or bet |
| Chat safety | Control characters and angle brackets stripped; burst of messages rate-limited; only the five fixed reactions accepted |
| Host moderation | Settings change between hands; invalid limits rejected; kicked player receives `kicked`, seat freed, cannot rejoin |
| Disconnect mid-hand | Seat shows "away", stays in hand; table advances on the server clock alone |
| Refresh / reconnect | New socket with the same token restores seat, hole cards, all wagers, balance and connection status |
| Joining mid-hand | Late player is seated as "waiting-next" with no cards or actions; can bet from the next round |
| Multiple tables | Two tables play simultaneously; distinct hands; neither table's code appears in the other's traffic; all cards unique per table |
| Spectators | Spectator never receives hole cards before showdown |
| Replay | Saved community and dealer cards returned; folded opponent's cards withheld; non-participant gets 404 |
| Statistics | Hands, Trips+ bets and "hands with friends" recorded; mis-sized raise graded with a positive EV cost |
| Persistence and crash recovery | Hand interrupted mid-flop; server torn down; new server on the same database voids the hand and refunds all $65 exactly once; second recovery pass refunds nothing; same token and table code reconnect to the restored stack |
| Bankroll reconciliation | After every settled scenario, the ledger sum equals the stack balance for every player |
| Solo mode | Same engine on the in-memory store; one seat; no decision clock |

## 3. Browser tests — Playwright in Chrome, production build (3)

The test harness runs `npm run build`, boots `node dist/server/server/index.js` against a scratch Postgres database, and drives separate browser contexts.

1. **Two devices, one table, via invite link.** Desktop host creates a private table; a second player opens the invite URL in iPhone 13 emulation, chooses a name, is auto-seated. Both bet with chips, deal in, act (4× vs check→check→1×). Asserted: each sees two face-up cards of their own and two face-down for the other; identical flop and identical final board and dealer cards on both screens; each displayed balance equals $1,000 + displayed net; **no horizontal scrolling on the phone**, and own cards, board, dealer cards, own seat and betting spots all inside the 390px viewport; chat message reaches the other player; zero page errors.
2. **Refresh mid-hand.** After a 4× raise, the page is reloaded: same seat, same two hole cards, same $20 Play wager shown.
3. **Solo with Training mode.** Training hint and a highlighted recommended action are shown each street; following the recommendations ends with no graded mistakes.

4. **Side bets in the browser.** Pay tables shown before betting; Bad Beat without Trips+ shows an error; desktop places all three bonus bets and sees "On the table $65 · Reserved for 1× Play $25"; on the iPhone the bonus circles stay hidden until the Bonus bets panel is opened; the other player sees the bonus amount on the felt; bonus circles are disabled after the deal and the phone panel collapses; the result lists every wager and a separate "Main game / Bonus bets" subtotal; the displayed balance equals $1,000 − $50 + the bonus-bet result.

Screenshots from these runs (desktop and iPhone, settled hand) are in `docs/screenshots/`.

## Not tested / limitations

* **Real phones and Safari.** Mobile was tested with Chrome's iPhone 13 emulation (viewport, touch, device scale), not on a physical iPhone or WebKit.
* **Public deployment.** No deployment to Render or Railway was performed from this environment. The production install path was checked instead: `npm ci --omit=dev` on the built output, boot against Postgres, health check and SPA routes served.
* **Docker image.** The Dockerfile was written but not built here (no Docker daemon available).
* **Load.** No load or soak testing. Expect a single instance to handle many concurrent tables, but this hasn't been measured.
* **Audio and animation.** Exercised in the browser runs without errors, but quality is judged by eye and ear, not by tests.
* **Side-bet animations** (the Ultimate Pairs ribbon, the Bad Beat banner with both hands highlighted, the larger shimmer for 100:1+ payouts) were checked by eye on a rigged hand in Chrome, not by automated assertions. A real 10,000:1 straight-flush bad beat was tested in settlement code, not played through the UI.
* **Face-up policy:** after a hand settles everyone's cards, folded hands included, are shown to the table, with bonus combinations announced in chat. During a hand nobody sees another player's cards.
* **Pre-flop and flop EV costs** are estimates (Monte Carlo / sampled runouts) and labelled "est." in the UI. River EV is exact.
* **Deck commitment.** Each hand stores a SHA-256 of the shuffled deck for audit, but the full deck order isn't stored, so it can't be independently re-verified later; the dealt cards themselves are stored.
* **Not implemented:** registered accounts and a friends list (guest identities only, as the brief allowed); a cross-table hand-history browser (replays are reached from a table's History panel, last 15 hands, and from the Tonight tab); horizontal scaling across multiple server instances.
