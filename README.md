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

## Three Card Poker (scope addendum §23)

The same table, room, players, chat, chips and history can play **Three Card Poker**. The host picks the game in **Host controls → Casino game** (confirmation: *Switch this table to Three Card Poker? Everyone will remain seated…*). During a hand the switch is queued and applied only after that hand has fully settled; uncommitted bets, Ready states, Rebet and Same-bet presets are released; everyone sees "Tom changed the table to Three Card Poker." The server owns the game mode (`TableConfig.game`), shown in the lobby and invitation view.

* **Deal:** one 52-card deck, one card at a time to each player then the dealer, three rounds. No community cards. Your cards are private until settlement; the dealer's are hidden until the reveal.
* **Bets:** Ante (required), Pair Plus and Six Card Bonus (optional, limits set by the host). You need Ante × 2 + side bets free (the 1× Play reserve).
* **Decision:** one, simultaneous: **Play 1×** or **Fold**. Timeout folds. Reconnecting players keep their wagers and cards.
* **Dealer qualifies with Queen high or better.** Not qualified: Ante 1:1, Play pushes. Qualified: higher hand wins Ante and Play 1:1, lower loses both, exact tie pushes both.
* **Three-card ranks** (`src/shared/tcp.ts`, `evaluate3`): Straight Flush > Three of a Kind > Straight > Flush > Pair > High Card. A-K-Q highest straight, A-2-3 lowest.
* **Ante Bonus** (automatic, needs Play, paid even if the dealer wins): Straight Flush 5:1, Trips 4:1, Straight 1:1.
* **Pair Plus** (your three cards only, live after a fold): 40 / 30 / 6 / 3 / 1.
* **Six Card Bonus** (best five of your three + the dealer's three, standard five-card ranks via the existing evaluator, live after a fold): Royal 1,000, Straight Flush 200, Quads 100, Full House 20, Flush 15, Straight 10, Trips 7.
* **Strategy trainer:** Queen-6-4 or better plays. Training mode also shows the exact EV of Play vs Fold over all 18,424 possible dealer hands (never the real hidden cards); mistakes are priced exactly after the hand.
* **Isolation:** Hold'em side bets are refused in Three Card Poker and vice versa (server-checked). The Hold'em progressive gets no contributions, awards or resets during Three Card Poker; its meter and history are untouched.
* **One bankroll, separate statistics:** chips carry over between games. Every hand stores `hands.game` and its rules version (`tcp-2026.11` or `2026.11`). Statistics have *All games / Ultimate Hold'em / Three Card Poker* tabs; the bankroll graph is combined. Replays, Tonight and recaps handle both games.
* Sources: [Wizard of Odds — Three Card Poker](https://wizardofodds.com/games/three-card-poker/), [Wizard of Odds — Six Card Bonus](https://wizardofodds.com/games/three-card-poker/six-card-bonus/). Migration `008_three_card_poker.sql`.

## Avatars, Style Credits and the Casino Boutique (scope addendum §24)

Every player has an illustrated 2D portrait (layered SVG, `src/shared/avatarSvg.ts`) shown at their seat, in chat, in the lobby list, in night recaps, in replays and on their profile card (tap a player's name plate). New guests start with a random free look so a table of six never looks alike.

* **Character Creator** (`/avatar`, *Edit avatar* in the lobby): skin tone, face shape, eyes and eye colour, eyebrows, nose, expression, build, 14 hairstyles and 10 hair colours, facial hair, free clothing and basics. Live preview with three poses and a preview of your name plate; **Randomize**, **Reset this section**, **Restore saved**, **Save**. Leaving with unsaved changes asks first.
* **Outfits:** Casual, Casino Night and Custom. *Save current here* stores the clothing and accessories; *Wear* switches. Face and hair stay the same.
* **Casino Boutique** (`/boutique`): 12 categories (clothing, hats, eyewear, jewelry & watches, ties/bow ties/lapel pieces, frames, chips, card backs, backgrounds, reactions, victory animations, featured collections). Every item can be tried on in the **Mirror** before buying; purchases show the price and the balance after, and ask once. *Your items*, *Ways to earn* and *Credit history* are in the same menu.
* **Style Credits** are a separate wallet (`style_wallets`, `style_tx`, `player_items`, `avatar_profiles` — migration `009_cosmetics.sql`). They are **not chips**: nothing converts either way, they can't be bet, bought, transferred or cashed out, and no reward depends on bet size, winnings, losses or the jackpot. Earning: welcome 300; first save 50; How to Play 50; trying the trainer 50; first hand 100; 25 hands 150; 100 hands 300; both games 150; first hand with friends 100; a second game night 200 (unlocks the Regular's Pin); 20+ decisions at 75%+ basic strategy 150 (unlocks Reading Glasses); first chat message 25; and 50 for each night you play 10 hands.
* **Collections:** Classic Vegas, Old West Gambler, High Roller, Art Deco. Owning every piece unlocks that collection's exclusive frame (earned, never sold).
* **At the table:** frames, chip skins (your rack and your bet markers), personal card backs (the same back on every face-down card at your seat, so they reveal nothing), reaction sets, victory animations (gold chip shower, card sparkle, spotlight, royal flush flourish, Classic Vegas lights). Effects stay inside your seat, never block taps, never change timing, and stop under reduced motion. **Settings → Avatars → Cosmetic animations** turns them off on your device; the host can set **Player cosmetics** to All / Subtle / Off for the table without touching anyone's items.
* **Server-authoritative:** the server alone decides ownership and balances. Saved looks are re-validated against the bundled catalog (only enumerated values; no markup, SVG or URLs are ever stored or rendered). Purchases carry an idempotency key, lock the wallet row, and can never go negative; a retried purchase is answered `duplicate` and not charged.
* **Prices are configurable** without code changes: `COSMETIC_PRICES='{"fedora-black":200}'`, `STYLE_REWARDS='{"welcome":500}'`, `COSMETIC_UNAVAILABLE='["tux-white"]'` (items already owned stay usable). There are no real-money purchases; adding any would need a separate, approved project.

## Rotating dealers (scope addendum §25–26)

Twelve dealers take turns at every table: Vincent, Sophia, Marcus, Elena, James, Naomi, Rafael, Claire, André, Victoria, Daniel and Isabella (`src/shared/dealers.ts`). Each has one appearance definition (skin, face, hair, uniform) used everywhere they appear, an introduction, a personality and their own chat lines and voice cue. **Dealers are presentation only** — every dealer deals the same shuffled deck, the same rules and the same odds; the shuffle never looks at who is dealing.

* **Shift:** the dealer hands over after **25 completed rounds** (counted only when a hand's settlement is applied — voided hands don't count), after the results, never mid-hand, and never to the same dealer. The count belongs to the table and carries across game switches and restarts (`game_tables.dealer_id`, `dealer_rounds`, migration `010_dealers.sql`).
* **Early hand-over after a major win:** a single player's main-game or bonus win of at least the greater of **$2,500** or **100× their opening wager**, or a progressive payout of **$10,000** or more. Uses settled results only.
* **Host settings** (Host controls → Dealer): rotation on/off, every 10 / 25 / 50 / 100 rounds, major-win hand-overs and thresholds, introduction full / short / off, chatter often / normal / rare / off, voice volume; pick a specific dealer between hands.
* **Animations:** greeting, dealing, waiting, win and loss expressions; on a hand-over the outgoing dealer waves and slides out and the new one slides in with an introduction card. All respect reduced motion.
* **Character consistency (§26):** every avatar (players and dealers) is drawn from one definition by one renderer. Hair is anchored to each face shape (`hairFit`) and drawn in three layers (back, front, under-hat clipped at the hat line — never reshaped), so the same person looks identical in the creator, the lobby, a desktop or phone seat, chat, results and replays. Unit tests compare the hair markup across contexts; the browser test compares it between the creator, lobby and two devices at the table.

## Blackjack (scope addendum §27)

The host can switch any table to **Blackjack** between hands (Host controls → Game) — players keep their seats and chips.

* **Rules (`bj-2026.11`, shown before betting):** six decks with a visible shoe, cut card (reshuffle after ~75%) and discard tray; Blackjack pays **3:2** (exact, $1 → $1.50); dealer **stands on all 17s**; double on any first two cards, including after splits; split up to 4 hands; no resplitting aces, split aces get one card each; 21 after a split pays 1:1; insurance up to half the bet on a dealer Ace, pays 2:1; dealer **peeks** with an Ace or ten showing; late surrender optional (host setting, off by default).
* **Turns:** players act in seat order, one at a time, on a server timer (time out → Stand; insurance time out → decline). Double and split need a second bet equal to the original wager, checked by the server.
* **Layout:** dedicated felt print, dealer hand, shoe and discard tray; split hands shown side by side (compact on phones).
* **Trainer:** Casino (no hints), Training (best play highlighted with the reason), Challenge (graded after the hand) and a **practice drill** (☰ → Blackjack practice, no chips). Advice and grading follow the active rules; decisions where the recommended double/split was unaffordable are recorded as *constrained* and not graded. Blackjack accuracy is tracked separately in Statistics.
* **Storage:** `hands.game='bj'`, `hand_players.bj_extra` (doubles/splits) and `bj_insurance`, `decisions.graded` and `decisions.ev_cost_cents` (migration `011_blackjack.sql`).

## Chips (scope addendum §28)

Nine denominations: **$1, $5, $25, $100, $500, $1,000, $5,000, $25,000 and the $100,000 plaque**. The rack shows the five most useful values for the table's limits plus a **high-limit tray**; bet spots show consolidated stacks (largest chips first) and balances of $1M+ are shortened on seat plates (exact in tooltips and results). Limits go up to a $1,000,000 Ante and a $1,000,000,000 starting bankroll.

**Fifteen chip collections × nine designs** (Classic Vegas free; Emerald Elite, Midnight Blue, Crimson, Vintage Poker, Art Deco, Desert, Saloon, Royal, Platinum, Neon, Marble, Carbon, Cosmic, Diamond Reserve), all procedural SVG. Boutique → *Custom Poker Chips*: spinning 3D preview, preview on the felt, buy the whole set or a single denomination (a fifth of the set price), equip a set for your tray, override single denominations, unequip, back to Classic. A design never changes what a chip is worth.

## Animated borders (scope addendum §29)

Fifteen animated portrait borders in four price tiers (250–2,500 Style Credits): Golden Halo, Emerald Pulse, Midnight Neon, Royal Diamonds, Platinum Orbit, Card Shark, Vegas Lights, Black Smoke, Art Deco, Crimson Flame, Electric Ace, High Roller, Cosmic, Royal Flush and Diamond Crown. Each is a distinct CSS animation of transforms and opacity only (GPU-friendly), drawn inside the portrait circle so it never covers cards or seats.

* **Settings → Avatars:** *Full*, *Subtle* (slow), *Static* (no motion) or *Hide all cosmetic effects*. Local to your device; other players are unaffected.
* Animations pause while a portrait is scrolled off-screen or the tab is hidden, stop under reduced motion and when the host sets table effects to Subtle, and are hidden when the host turns effects off.

## Decision Quality vs. Results — "Wrong Call Wins" (scope addendum §31)

Statistics → **Decision Quality vs. Results** separates how you played from how the cards fell, for Ultimate Hold'em, Three Card Poker and Blackjack:

* Every completed round is classified once (a split Blackjack round counts once): **wrong call** (at least one graded decision differed from the strategy), **right call** (graded decisions and no deviation) or **ungraded** (nothing gradable — e.g. a natural, or only an unaffordable double/split). The result is the sign of the **main-game** net: side bets, bonuses, the progressive and insurance never turn a loss into a win, and a folded hand is a loss even if its bonus bet paid.
* Shown: Wrong Call Wins / Losses / Pushes, Right Call Wins / Losses / Pushes, Ungraded (all of which add up to the rounds played), Wrong Call Win Rate (= wrong-call wins ÷ all hands with a wrong call), Right Call Win Rate, hands with a deviation and individual mistakes, total EV lost, and the profit from Wrong Call Wins (labelled as luck). Lifetime, current session (latest run of hands without an hour's gap, across tables and games) and per-game tabs.
* **Hand history** filter **Wrong Call Wins** (plus Wrong Call Losses, Right Call Losses, all wrong calls, ungraded, all): game, hand number, your cards, the board and dealer cards, each wrong action with the recommended action, the reason and its EV cost, the main-game result (and the total with side bets) and whether you won despite the mistake.
* **EV cost** is fixed when the decision is recorded and never changes with the result. Hold'em: exact on the river, trainer EV on earlier streets; Three Card Poker: exact; Blackjack: infinite-deck, dealer-peeked calculation (within a few thousandths of a bet of six-deck values), insurance at 1/13 of the stake.
* Computed only on the server from the immutable `decisions` rows and settled `hand_players` rows (`GET /api/stats/quality`, `GET /api/stats/history`); there is no endpoint to submit a classification or change a counter.

## Dealer Roast Engine (scope addendum §32)

The dealers trash-talk bad plays, by name, in their own voices — profanity-heavy at the top settings, and only for players who opt in. **Presentation only:** the roast engine reads settled, public facts after the fact; it never touches the shuffle, the cards, settlement or networking, and nothing waits on it.

* **Dealer Attitude** (Host controls → Dealer): Professional · Smartass · Asshole · Complete Fucking Menace · No Mercy. Private tables start at Asshole, public tables at Smartass. It's the table's *maximum*.
* **Consent and personal controls** (asked on your first hand at a roasting table; Settings → Dealer any time): roast me by name (off until you say yes — at any attitude, the dealer never singles out someone who hasn't opted in), maximum intensity for me (also caps lines aimed at you), profanity on/off (swaps every swear word), subtitles, spoken dialogue (your browser's own speech voice; nothing is sent anywhere), dealer voice volume, mute dealer commentary. All of it is per device and never changes anyone else's view.
* **Only verified claims:** a dealer calls a play a mistake only when the strategy engine graded it wrong (constrained or ungraded decisions never count). Counts like "your 7th wrong-call win tonight" are real, recomputed from the database after a restart. Hold'em and Three Card Poker roasts wait until the hand is settled and every card is face up; Blackjack cards are public, so hitting 20 or splitting tens gets a short remark straight away.
* **Engine:** priorities (jackpots > Blackjack blunders > Wrong Call Wins > folds > …), per-player and per-situation cooldowns, at most one personal and one group line per round, never the same line within the last 100 comments (when a situation runs dry the dealer stays quiet), rare meltdowns (Menace and No Mercy only, at most once per 30 rounds), and comedic dealer-vs-player records (`dealer_rivalries`, migration `012_roast.sql`) for grudge callbacks — never read by dealing or payouts. No external AI or voice service is used.
* **Library:** `src/shared/roast/lines.ts` (one section per situation), every line tagged with id, dealer, category, intensity, facts it needs, profanity class, size, priority, cooldown and speech style. A content test checks 15+ distinct lines per dealer per authored category, no shared lines between dealers, and that the clean filter removes every swear word.

* **Rivalry callbacks:** once per shift, a dealer who has already dealt a consenting player 25+ hands on earlier shifts says so with the real count from `dealer_rivalries.witnessed` (one per settled hand that dealer dealt them).
* **When the dealer changes:** at a roasting table the outgoing dealer's farewell, the shift-end note and the new dealer's introduction come from the library; at a Professional table (or Intro off) the original fixed lines are used.

**Library status: complete — 6,300 lines.** All 25 primary situations × 12 dealers × 15 lines = **4,500**, plus all 10 additional pools × 12 × 15 = **1,800** (introductions, farewells, greetings, chat comebacks, meltdowns, Blackjack naturals, comeback wins, rivalry callbacks, side-bet wins, improbable hands). Each dealer/situation has 3 Smartass, 4 Asshole, 4 Complete Menace and 4 No Mercy lines. Run `npx vitest run tests/unit -t roast` to print the exact report.

To add or change lines, edit the situation's section in `src/shared/roast/lines.ts` (format `'<level>|<text>'`, facts in braces such as `{name}` or `{total}`); the content test catches duplicates, recycled jokes, unknown facts and banned subjects.

**Project layout: 99 files.** To keep the project at 99 files, the roast lines live in a single `lines.ts`, all unit tests are in `tests/unit/all.test.ts` and all integration tests are in `tests/integration/all.test.ts` (one `describe` section per former file; `tests/integration/harness.ts` is unchanged). Run one area with `-t`, e.g. `npx vitest run -t blackjack`.

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
* **Debt counter (just for fun):** each reload is a "marker" from the house. The marker total is kept per table (`stacks.debt`, migration `005_debt.sql`), shown under the player's balance as *IOU $…* and in the dock, and totalled in Statistics. Every new marker gets a dealer joke in chat (25 of them, rotating) and something to pawn that covers the whole debt, picked at random from that price level: 15 items at every $1,000 step up to $10,000, then 8 each at $20k, $60k, $250k, $1M and $20M — from your AirPods to a private island. The pawn shop remembers exactly what each player pawned, and paying in full gets that same item back. To add or change items or jokes, edit the lists at the top of `src/shared/debt.ts` (instructions are in the file). Virtual chips only; debt never changes balances or payouts.
* **Phones:** one compact top bar (back, table name, jackpot, Chat, ☰ menu with Invite, History, Host controls, Settings, Rules, Leave); seat cards use large corner indices instead of a centre pip; status shows as small tags (Ready / Folded / Away) instead of text under the plate; the table stretches to fill the screen (no dark side margins) with larger cards; Ante, Blind, Play and a round Bonus button share one evenly spaced row (Bonus opens the side-bet circles underneath); between hands the bet controls use the full width; the dock scrolls if a result is long.
* **Keyboard**: 4 / 3 / 2 / 1 to play, C check, F fold, Enter to deal in.
