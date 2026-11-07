# Ultimate Texas Hold'em Online

A multiplayer, server-authoritative Ultimate Texas Hold'em table for up to six friends, plus solo practice. Everyone plays their own hand against one shared dealer. **Virtual, nonredeemable chips only** — there are no purchases, cash-outs or transfers anywhere in the system.

Version 2.0 is a rebuild of the single-file prototype (`ultimate-texas-holdem.html`). The poker evaluator, strategy trainer, sound engine and session statistics were carried over, audited and corrected; everything else is new.

## What's in the box

| Area | Where |
|---|---|
| Shared rules engine (evaluator, payouts, validation, strategy, exact river solver) | `src/shared/` |
| Server: Express REST, Socket.IO, table engine, PostgreSQL store, crash recovery | `src/server/` |
| Client: lobby, casino table, animations, sound, trainer, stats, replay (Vite + TypeScript) | `src/client/` |
| Database schema / migrations | `migrations/` |
| Unit + multiplayer integration tests (Vitest) | `tests/unit`, `tests/integration` |
| Browser tests (Playwright) | `tests/e2e` |
| Deployment | `Dockerfile`, `render.yaml`, `railway.json`, `docker-compose.yml`, `DEPLOY.md` |
| Test evidence | `VERIFICATION.md` |

One repository, one deployable service: the Node process serves the built client, the REST API and the WebSocket server on a single port.

## Quick start (local)

Requirements: Node.js 20+ (22 recommended) and PostgreSQL 14+ (or Docker for the bundled Postgres).

```bash
# 1. Install dependencies
npm install

# 2. Database — either start the bundled Postgres…
npm run db:up                      # docker compose up -d db  (postgres://postgres:postgres@localhost:5432/uth)
#    …or point at your own:
cp .env.example .env               # then edit DATABASE_URL

# 3. Run migrations (the server also applies them automatically on boot)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/uth npm run db:migrate

# 4. Start the dev servers (API + sockets on :3000, Vite client on :5173 with proxy)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/uth npm run dev
# open http://localhost:5173
```

No database handy? Omit `DATABASE_URL` and the server runs on an in-memory store with identical rules — fine for a quick game, but everything is lost on restart.

To try multiplayer on one machine, open the table link in a second browser profile or a private window (each gets its own guest identity).

## Tests

```bash
# Unit + multiplayer integration (needs a Postgres the tests can wipe)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/uth_test npm test

# Browser tests: builds, starts the production server on :3200 against a scratch database, drives Chrome
E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5432/uth_e2e npm run test:e2e
# If Playwright's bundled browser isn't installed: npx playwright install chromium
# or point at a local Chrome:   CHROME_PATH=/usr/bin/google-chrome npm run test:e2e
```

Both test databases default to the URLs shown; **their schemas are dropped and recreated on every run**, so never point them at real data.

## Production build

```bash
npm run build      # client -> dist/client, server -> dist/server
npm start          # node dist/server/server/index.js (uses DATABASE_URL, PORT)
```

See **DEPLOY.md** for Render, Railway, Docker, custom domains and HTTPS/WSS.

## How a hand flows

`waiting → betting → preflop → flop → river → showdown → settled → betting …`

* **Betting.** Each player builds an Ante (Blind matches automatically) and an optional Trips+. The server checks the bet against table limits *and* that the player can cover Ante + Blind + Trips + a reserved 1× Play. The hand deals as soon as every connected, active player is Ready, or when the betting clock expires once at least one player is Ready.
* **Deal.** A CSPRNG Fisher–Yates shuffle (`crypto.randomInt`) on the server. Each player gets two private cards; the dealer gets two; burn cards are drawn before flop, turn and river.
* **Decisions** run in parallel under one server clock: pre-flop 4×/3×/check, flop 2×/check, river 1×/fold. Players who already raised are skipped. On timeout the server checks (pre-flop, flop) or folds (river) — or plays basic strategy if the player opted in.
* **Showdown.** Every hand is settled independently against the same dealer hand in a single database transaction.

### Settlement rules (all amounts integer cents)

| Wager | Player wins | Tie | Player loses | Fold |
|---|---|---|---|---|
| Ante | 1:1, **push if dealer has less than a pair** | push | lose (push if dealer doesn't qualify) | lose |
| Play | 1:1 | push | lose | — |
| Blind | paytable on straight+, otherwise push | push | lose | lose |
| Trips+ | paytable on the player's own hand regardless of the dealer — **including after a fold** |

Blind: Royal 500:1, Straight Flush 50:1, Quads 10:1, Full House 3:1, Flush 3:2, Straight 1:1. **Casino breakage:** the 3:2 flush payout is rounded down to the whole dollar, as at a real table ($25 Blind → $37, $5 → $7, $1 → $1). No payout anywhere is ever a fraction of a dollar.
Trips+: Royal 50:1, Straight Flush 40:1, Quads 30:1, Full House 8:1, Flush 6:1, Straight 5:1, Trips 3:1.
Both tables are unchanged from the prototype.

### Bonus bets: Ultimate Pairs and Bad Beat

Players can place Trips+, Ultimate Pairs and Bad Beat in any combination before the deal; they lock when the cards come out. Each is settled on its own, stays live after a fold, and is paid as stake returned plus profit.

| Bet | Pays on | Companion wagers | Ties |
|---|---|---|---|
| Ultimate Pairs | The player's two hole cards (one variant also uses the dealer's) — only the highest line pays | Ante + Blind | — |
| Bad Beat | The **losing** hand at showdown, Three of a Kind or better, whether the player's or the dealer's; full 7-card comparison with kickers | Ante + Blind + **Trips+** | Lose |

Each table uses one complete pay table per bonus bet, chosen at creation (or by the host between hands — every change is announced in chat). Defaults are marked.

| Variant | Lines |
|---|---|
| **Ultimate Pairs Bonus 4** (default) | A♥A♦ 100:1 · other AA 30:1 · A-K/Q/J suited 20:1 · A-K/Q/J unsuited 10:1 · 2-2 to K-K 4:1 |
| Ultimate Pairs Bonus 2 | Player **and dealer** AA 1,000:1 · AA 30:1 · AKs 25:1 · AQs/AJs 20:1 · AKo 15:1 · JJ–KK 10:1 · AQo/AJo 5:1 · 22–TT 3:1 |
| **Bad Beat Bonus 01** (default) | Losing straight flush 10,000:1 · quads 500:1 · full house 40:1 · flush 25:1 · straight 20:1 · trips 9:1 |
| Bad Beat Bonus 02 | Losing straight flush 7,500:1 · quads 500:1 · full house 50:1 · flush 30:1 · straight 20:1 · trips 9:1 |

Sources: Ultimate Pairs = Maryland Lottery and Gaming Control Agency, *Ultimate Texas Hold'Em Poker Standard Rules v1.5*, Paytables D and B; Bad Beat = California Bureau of Gambling Control *Ultimate Texas Hold'em Bad Beat Bonus* options sheet, Options 1 and 2 (also MLGCA Paytables A and B). Neither source specifies companion wagers or fold handling, so those follow the project addendum (§22). Every variant — id, rows, multipliers, companions, fold handling, limits, source — is defined in one place: `src/shared/sidebets.ts`.

Privacy: the Bonus 2 dealer-aces line is never previewed or confirmed before the dealer's cards are shown. Nobody sees another player's hole cards while a hand is live.

**Cards face up after the round.** Once a hand is settled every seat's cards are turned face up for everyone at the table — folded hands included — with the hand name, the bonus-bet combinations and the replay. This mirrors a dealer spreading the cards at the end of a real hand.

### $5 Five Card Progressive (linked jackpot)

An optional, fixed **$5** bet scored on the player's **two hole cards plus the three flop cards**. One meter is shared by every table on the server and stored in the database (`progressive_meter`), so it survives restarts and grows with play at any table.

| Hand (hole + flop) | Pays |
|---|---|
| Royal Flush | 100% of the jackpot |
| Straight Flush | 10% of the jackpot |
| Four of a Kind | $1,500 |
| Full House | $250 |
| Flush | $200 |
| Straight | $150 |
| Three of a Kind | $45 |

* **Envy bonus:** every *other* progressive bettor at the table receives $5,000 for each Royal and $1,500 for each Straight Flush hit there.
* Awards are paid instead of the $5 — the wager is not returned (standard for progressives).
* Meter: seeded at **$10,000**; **$3.50 of each $5 (70%)** is added when the cards are dealt. A Royal resets the meter to the seed (cents lost to rounding carry into the new meter); a Straight Flush can't take the meter below the seed. Percentage awards are paid in whole dollars, rounded down. Multiple hits at one table are paid in seat order.
* The bet is decided on the flop, so it **stays live if the player later folds**. Hosts can switch the progressive off for their table between hands (announced in chat).
* Concurrency and exactly-once: the meter row is locked `FOR UPDATE` inside the settlement transaction, the award is computed against the locked value, and every meter-paid award is written to `progressive_hits` (unique per hand + player). Two tables can never both collect the same jackpot. A hand voided by a crash refunds the $5 and removes its contribution from the meter.
* A Royal or Straight Flush hit is announced in chat at the table and as a notice at every other table.

Sources: Hollywood Casino at Penn National Race Course, *Ultimate Texas Hold'em progressive table guide* (Five Card Progressive pay table and Envy amounts); Washington State Gambling Commission, *Ultimate Texas Hold'em* rules, Multi-Game Link jackpot Paytable 01 (the same table per $1, hole cards + flop, seed at least the largest fixed award, fold eligibility at the operator's discretion). The seed, the 70% meter rate and fold handling are this project's operator choices. Defined in `src/shared/progressive.ts`.

### Bugs fixed from the prototype

1. **Dealer non-qualification.** The prototype paid the Play bet and pushed the Blind whenever the dealer failed to qualify — even when the dealer's unqualified hand beat the player. Qualification now only affects the Ante; Play and Blind are always decided by comparing hands.
2. **Trips+ on folds.** The prototype counted a folded hand's Trips+ win in the net but never returned stake + winnings to the bankroll. Folded Trips+ now pays in full.
3. **Affordability.** Bets now reserve the mandatory 1× Play on top of Ante + Blind + Trips, and raise buttons only appear when affordable.
4. **Strategy chart.** Added King-x suited, Q6+ suited and J8+ suited; removed J9 offsuit; pocket 2s now check (the prototype said 3×). Flop rule now recognises any hidden pair (not only 4s+), requires hole-card involvement for two pair, requires a hidden 10+ for four-flush draws, and checks pocket 2s.
5. **River and EV.** The "pair of 3s or better" river heuristic is replaced by an exact solver over all 990 possible dealer hands. Fixed per-mistake EV constants (e.g. "2.50 antes") are replaced by exact river EV and sampled estimates for flop/pre-flop, labelled as estimates. Results and decisions are graded separately ("lucky" wins no longer offset EV losses).
6. **Evaluator.** Fixed-width score encoding; two pair takes its kicker from all remaining cards; full house handles two sets. Cross-checked against an independent evaluator on 20,000 random hands.

## Architecture notes

* **Server-authoritative.** Clients send only intents (`bet:place`, `player:ready`, `player:decide`, …) with a unique `actionId`. The server validates phase, hand id, legality and affordability inside a per-table async mutex. Duplicate `actionId`s are acknowledged without effect; stale phase or hand ids are rejected.
* **Per-viewer redaction.** Each socket receives a view built for that player: other players' hole cards and the dealer's cards are `null` until showdown, unrevealed board cards are `null`, and folded hands stay private afterwards. Nothing is hidden with CSS. Tests scan every payload for leaks.
* **Money.** Integer cents everywhere. Every balance change is a ledger row with a unique `tx_key`; stacks have `CHECK (balance >= 0)`; settlement locks the hand row and refuses to settle twice. `ledgerSum(player, table)` always equals the stack balance.
* **Crash recovery.** On boot, any hand still `active` (interrupted by a restart) is voided and every committed stake is refunded exactly once via the ledger. Tables reload from the database when someone rejoins by code.
* **Identity.** Guests get a 256-bit random bearer token (stored client-side; only its SHA-256 is stored server-side). Refreshing or reopening the link restores the same player, seat and stack.
* **Progressive.** Contributions are added in the deal transaction; awards are resolved by a callback the store runs inside the settlement transaction with the meter locked (`SettlementBuilder`), so the meter value used is the one written back (migration `004_progressive.sql`).
* **Side bets.** Ultimate Pairs and Bad Beat are debited with the Ante, Blind and Trips+ in the deal transaction and paid in the settlement transaction, so they share the same exactly-once guarantees. Each hand row records the pay tables in force; each player row records stake, combination, multiplier and net per bonus bet (migration `002_side_bets.sql`). Strategy, EV and the main-game return figures exclude side bets.
* **Bankrolls.** Each player has a stack per table, created at that table's starting bankroll on first sit. Once the stack can't cover a minimum hand (3× the minimum Ante) and no hand is in progress, the player may **Reload** back to the starting bankroll; reloads are counted in statistics.
* **Scaling.** Live table state is in one Node process. Run exactly **one instance**; it comfortably hosts many concurrent tables.

## Using it

* **Create a private table** → copy the invite link (`/table/XXXXXXXX`) → friends open it, pick a name, and land in a free seat.
* **Public tables** appear in the lobby when the host ticks "List in public tables".
* **Practice solo** creates a one-seat table with no decision clock, using the same engine.
* **Settings** (per device): strategy trainer (Casino / Training / Challenge), effects and ambience volume, full / fast / reduced motion, four-colour deck; per table: timeout policy and sit-out.
* **Table look (host's choice):** felt colour (emerald, sapphire, burgundy, charcoal, royal purple, teal) and card backs (burgundy, navy, black, forest green, purple, gold) are set by the host — in Host controls or Settings — and everyone at the table sees the same table. Changes apply instantly (even mid-hand; they are cosmetic) and are announced in chat. Other players see the current look read-only.
* **Outs on mistakes**: every wrongly played street is listed after the hand in all modes. River mistakes show the dealer's single-card outs (the "fewer than 21" rule of thumb) and the exact number of the 990 dealer hands that beat you; flop mistakes show your outs to improve and the chance of hitting by the river. Training mode shows the same outs before you act. Pre-flop has no outs; it shows the reason and the EV cost.
* **Host controls**: edit limits/timers/visibility between hands; per player **Set away / Bring back** (they keep the seat but sit out until they tap *Sit back in*), **Move to spectators** (mid-hand they finish the hand first; their chips stay on the table for when they sit again) and **Remove**; close the table. The host has no access to cards, the shuffle, payouts or anyone's chips.
* **Sit Out / Sit Back In:** keep your seat and chips while you skip hands (button in the dock and the ☰ menu); mid-hand it takes effect after the hand.
* **Same bet every hand:** confirm once and your bet is re-placed and dealt in each hand. It turns off if you change the bet, tap Not ready, or can't cover it; the server re-checks limits and chips every hand.
* **Decision countdowns and action tags:** every deciding player's avatar shows the seconds left (server clock, red in the last 5); seats show Checked / Played 3× / Folded / Ready / Away.
* **Results:** amounts float over the name plate, never the cards; the winning five light up first, then a compact one-line-per-bet breakdown fades in, with one detail line for winning bonus bets.
* **Tonight (running tab) and the night recap:** leaderboard with net and W-L-P, biggest win and loss (with replay), best hands, bonus hits, awards (hottest streak, most folds, sharpest player, deepest in debt), and *Your chips at this table* — starting chips + reloads − wagers + payouts = your stack, checked against the ledger. The host can **End the night**; everyone gets the recap and a **Share recap** image. A night also ends after 4 hours without a hand. Past nights stay listed. Built from settled hand records (`table_nights`, migration `006_nights.sql`).
* **Pay off and the pawn shop:** between hands, tap *Pay off* next to your IOU to pay markers back from your stack — your winnings above a starting stack, or everything in front of you. The Tonight tab keeps a running *Pawn shop* list of every marker and payoff at the table (who pawned what, for how much, and what they still owe; paying in full gets the item back). Payoffs are ledger rows (kind `reload`, negative), so the chips check still balances. Migration `007_pawn_shop.sql`.
* **Rules version:** `2026.11`, recorded on every hand and shown in the pay tables and replays.
* **Restore code:** Settings → Use another device shows a private code; paste it under *Have a restore code?* on another device to play as the same guest.
* **Debt counter (just for fun):** each reload is a "marker" from the house. The marker total is kept per table (`stacks.debt`, migration `005_debt.sql`), shown under the player's balance as *IOU $…* and in the dock, and totalled in Statistics. Every new marker gets a dealer joke in chat plus the cheapest thing you could pawn to cover the whole debt — from your AirPods up to a private island (`src/shared/debt.ts`). Virtual chips only; debt never changes balances or payouts.
* **Phones:** one compact top bar (back, table name, jackpot, Chat, ☰ menu with Invite, History, Host controls, Settings, Rules, Leave); seat cards use large corner indices instead of a centre pip; status shows as small tags (Ready / Folded / Away) instead of text under the plate; the table stretches to fill the screen (no dark side margins) with larger cards; Ante, Blind, Play and a round Bonus button share one evenly spaced row (Bonus opens the side-bet circles underneath); between hands the bet controls use the full width; the dock scrolls if a result is long.
* **Keyboard**: 4 / 3 / 2 / 1 to play, C check, F fold, Enter to deal in.
