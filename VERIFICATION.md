# Verification report

What was actually run, where, and what it proved — and what was not tested.

**Environment:** Linux, Node.js 22.23, PostgreSQL 16 (local), Google Chrome for Testing 153, run on 2 November 2026.
**Result:** 109 of 109 automated tests passed.

```
npx tsc --noEmit                 → no type errors (client, server, shared, tests)
npm test  (Vitest)               → 8 files, 104 tests passed   (62 unit + 42 multiplayer integration)
npm run test:e2e (Playwright)    → 5 tests passed in real Chrome against the production build
```

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
* **Side-bet privacy choice:** other players see a folded seat's bonus-bet amounts and whether each won, but never the combination. Tell me if you'd rather hide folded seats' bonus results entirely.
* **Pre-flop and flop EV costs** are estimates (Monte Carlo / sampled runouts) and labelled "est." in the UI. River EV is exact.
* **Deck commitment.** Each hand stores a SHA-256 of the shuffled deck for audit, but the full deck order isn't stored, so it can't be independently re-verified later; the dealt cards themselves are stored.
* **Not implemented:** registered accounts and a friends list (guest identities only, as the brief allowed); a cross-table hand-history browser (replays are reached from a table's "Table & history" panel, last 15 hands); horizontal scaling across multiple server instances.
