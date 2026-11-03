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

Blind: Royal 500:1, Straight Flush 50:1, Quads 10:1, Full House 3:1, Flush 3:2, Straight 1:1.
Trips+: Royal 50:1, Straight Flush 40:1, Quads 30:1, Full House 8:1, Flush 6:1, Straight 5:1, Trips 3:1.
Both tables are unchanged from the prototype.

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
* **Bankrolls.** Each player has a stack per table, created at that table's starting bankroll on first sit. Once the stack can't cover a minimum hand (3× the minimum Ante) and no hand is in progress, the player may **Reload** back to the starting bankroll; reloads are counted in statistics.
* **Scaling.** Live table state is in one Node process. Run exactly **one instance**; it comfortably hosts many concurrent tables.

## Using it

* **Create a private table** → copy the invite link (`/table/XXXXXXXX`) → friends open it, pick a name, and land in a free seat.
* **Public tables** appear in the lobby when the host ticks "List in public tables".
* **Practice solo** creates a one-seat table with no decision clock, using the same engine.
* **Settings** (per device): strategy trainer (Casino / Training / Challenge), effects and ambience volume, full / fast / reduced motion, four-colour deck; per table: timeout policy and sit-out.
* **Host controls**: edit limits/timers/visibility between hands, remove a player, close the table. The host has no access to cards, the shuffle, payouts or anyone's chips.
* **Keyboard**: 4 / 3 / 2 / 1 to play, C check, F fold, Enter to deal in.
