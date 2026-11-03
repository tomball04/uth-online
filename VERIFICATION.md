# Verification report

What was actually run, where, and what it proved — and what was not tested.

**Environment:** Linux, Node.js 22.23, PostgreSQL 16 (local), Google Chrome for Testing 153, run on 2 November 2026.
**Result:** 43 of 43 automated tests passed. The unit + integration suites were run twice back to back with identical results; the browser suite was run twice.

```
npx tsc --noEmit                 → no type errors (client, server, shared, tests)
npm test  (Vitest)               → 2 files, 40 tests passed   (21 unit + 19 multiplayer integration)
npm run test:e2e (Playwright)    → 3 tests passed in real Chrome against the production build
```

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

Screenshots from these runs (desktop and iPhone, settled hand) are in `docs/screenshots/`.

## Not tested / limitations

* **Real phones and Safari.** Mobile was tested with Chrome's iPhone 13 emulation (viewport, touch, device scale), not on a physical iPhone or WebKit.
* **Public deployment.** No deployment to Render or Railway was performed from this environment. The production install path was checked instead: `npm ci --omit=dev` on the built output, boot against Postgres, health check and SPA routes served.
* **Docker image.** The Dockerfile was written but not built here (no Docker daemon available).
* **Load.** No load or soak testing. Expect a single instance to handle many concurrent tables, but this hasn't been measured.
* **Audio and animation.** Exercised in the browser runs without errors, but quality is judged by eye and ear, not by tests.
* **Pre-flop and flop EV costs** are estimates (Monte Carlo / sampled runouts) and labelled "est." in the UI. River EV is exact.
* **Deck commitment.** Each hand stores a SHA-256 of the shuffled deck for audit, but the full deck order isn't stored, so it can't be independently re-verified later; the dealt cards themselves are stored.
* **Not implemented:** registered accounts and a friends list (guest identities only, as the brief allowed); a cross-table hand-history browser (replays are reached from a table's "Table & history" panel, last 15 hands); horizontal scaling across multiple server instances.
