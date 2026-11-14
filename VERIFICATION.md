# Verification report

What was actually run, where, and what it proved — and what was not tested.

**Environment:** Linux, Node.js 22.23, PostgreSQL 16 (local), Google Chrome for Testing 153; latest full run 13 November 2026.
**Result:** 334 of 334 automated tests passed (13 November 2026, final run): 320 in Vitest and 14 browser tests in Playwright. Tracked project files: **98** (cap 99).

```
npx tsc --noEmit                 → no type errors (client, server, shared, tests)
node scripts/count-files.mjs     → OK: 98 tracked project files (cap 99)
npm test  (Vitest)               → 2 files, 320 tests passed   (unit + multiplayer integration on PostgreSQL 16)
npm run test:e2e (Playwright)    → 14 tests passed in real Chrome against the production build (8.0 min)
```

Update 13 November 2026 (§40 table music): Spotify listen-along — section 1l. Vitest 320/320 (13 new: 4 unit, 9 integration), Playwright 14/14 (1 new). **Spotify itself was mocked** in every test; no real Spotify account, app or audio was used — see 1l for exactly what that does and doesn't prove.

Update 8 November 2026 (§33–§39 release): payout audit and corrections, Three Card Poker stored-rank fix and new Three Card Progressive, all Stadium UTH tables, UTH Progressive V2, a shared progressive service with separate meters and a High Roller profile, the Blackjack side-bet catalog with Bonus Bets panel, host presets and bonus statistics, 900 new dealer lines, and a 99-file guard — section 1k. Final runs: Vitest 307/307, Playwright 13/13. One Vitest run made while the six-browser Playwright suite was running timed out twice in the §25 rotation tests (waiting for a hand to settle); the same suite passed 307/307 when run on its own afterwards. In that Playwright run the old side-bet browser test failed only because pay tables were renamed to their Stadium ids (“UP-04”, “BB-01”); the expectation was updated and the final full run passed.

Update 8 November 2026 (99-file layout): the project was consolidated to exactly 99 files with no change to app behavior. The 36 roast-line files became `src/shared/roast/lines.ts`; the 13 unit test files became `tests/unit/all.test.ts`; the 14 integration test files became `tests/integration/all.test.ts`, with each former file as its own `describe` section in the original order; and a stray demo log was removed. Re-run after the change: type check clean; Vitest 274/274, the same tests as before; production build OK; the §32 browser test passed against the new build. The full 12-test browser suite was not rerun after this layout-only change; its last full run (12/12) was on the same app code just before it.

Update 8 November 2026 (final): **§32 dialogue library complete — 6,300 lines** (4,500 primary + 1,800 additional), rivalry callback wired, library farewells/intros on dealer changes — section 1j. Vitest 274/274 and Playwright 12/12 on the final build. Two §25 integration tests were updated to accept library lines for the same rotation events (explained in 1j). By eye: joining a No Mercy Blackjack table, each opted-in player gets a greeting from the new pool ("Good evening, Vic. Your file is open. It's fucking empty. For now."), and Tom's bust gets a live roast.

Update 8 November 2026 (later): Dealer Roast Engine (§32) — engine, consent, settings and the first 1,440 dialogue lines; **the dialogue library is not complete** (section 1j has the exact count). The first full browser run after adding it failed 8 of 12 older tests: the new opt-in card was a fixed pop-up that covered table controls on both desktop and phone. It now sits in the chat panel and never overlaps the table; the rerun passed 12/12.

Update 8 November 2026: rotating dealers (§25), character consistency (§26), six-player Blackjack (§27), chips to the $100,000 plaque with 15 collections (§28), animated borders (§29), the end-to-end flow (§30) and Decision Quality vs. Results / Wrong Call Wins (§31) — section 1i. Getting the new browser tests to pass took several runs: test-selector fixes, and one real Blackjack display bug (described in 1i). The final full runs passed: Vitest 245/245 and Playwright 11/11.

Update 7 November 2026: more pawn variety — 15 items at every $1,000 step to $10,000 plus five bigger tiers, a random pick per marker, 25 dealer jokes. Unit tests check tier sizes, sorting, no duplicates, random and seeded picks; integration tests check that chat, the seat, the payoff message and the pawn-shop list all name the same pawned item.

Update 6 November 2026: avatars, Style Credits and the Casino Boutique (§24) — section 1h.

Earlier update: refinement pass — Progressive/Envy audit under concurrency, rules version, Sit Out / Sit Back In, same bet every hand, decision countdowns and action tags, Tonight running tab and night recap, chips check, results presentation, six-browser test, restore code — section 1f.

## 1l. Table music — Spotify listen-along (§40)

**Design.** The host's browser reads the host's own Spotify (`GET /me/player/currently-playing`, every 4 s) and sends `music:now` only when the track, play/pause or position (±2 s) changes, plus a 20 s heartbeat. The server checks the sender is the table's host, validates (`spotify:track:` + 22 base-62 characters only; title/artist ≤120 chars with control characters removed; artwork kept only if it is an `https://i.scdn.co/image/…` URL; times clamped to the track), rate-limits (4 burst, 1 per 2 s), stamps server time and relays `music:state` to that table only. Listeners compute the host's position from server time and play the same URI on their own account — in the tab (Web Playback SDK device "UTH Table") or on their Spotify app (Web API, no device id) — re-syncing on track change, play/pause, or drift over 2.5 s. Sign-in is OAuth PKCE in the browser (no secret); tokens are in that browser's localStorage and are never sent to our server. State is memory-only per table and is cleared when the host stops, disconnects, leaves or hosting passes on; a refreshing host resumes sharing automatically (sessionStorage).

| Test | What it checks | Result |
|---|---|---|
| unit `music` ×4 | URI/field validation and rejection (episodes, open.spotify URLs, short ids, injected chars, NaN/negative times), artwork host allow-list, clamping, listener position while playing/paused and under clock skew | pass |
| integration `music` ×9 (real server + Socket.IO) | public client-id endpoint; CSP contains exactly the four Spotify hosts and still `frame-ancestors 'none'`; joiners and late spectators receive current state; non-host `music:now`/`music:stop` rejected; one chat line per new track (not per pause); rate limit; stop clears for everyone; host leaving clears it, the new host can share and the old one can't; another table never receives it | pass |
| e2e `§40` (3 browsers, Chrome) | host PKCE round trip returns to the same table (S256 challenge, verifier ≥43 chars, client id sent); host shares; desktop listener's top bar and chat show the song; *Listen here* plays the host URI on the SDK device at the host's position (±6 s window allowing for test timing); phone listener (iPhone 13 emulation) uses *Play on my Spotify app* (no device id); host pauses → listener pauses within one poll; host refresh → sharing drops then resumes and the listener resumes; host stops → listeners told; no page errors | pass |

Screenshots: desktop listener panel and phone listener panel (in the delivered contact sheet).

**Not verified — Spotify was mocked.** The tests replace `accounts.spotify.com`, `api.spotify.com` and the SDK script (`sdk.scdn.co/spotify-player.js`) with stand-ins that follow Spotify's documented request/response shapes. Not tested: a real Spotify sign-in, real audio, the real SDK in Chrome, real token refresh, Premium/non-Premium (`PREMIUM_REQUIRED`) and not-on-the-user-list (403) responses — the messages for those are written from Spotify's documentation. Spotify's February 2026 Development Mode rules restrict which Web API endpoints new apps may call; whether the player endpoints used here (`/me/player`, `/me/player/currently-playing`, `/play`, `/pause`, `/seek`) remain available to a new Development Mode app was **not confirmed** from the published material and needs checking with a real app. The Web Playback SDK does not support mobile browsers (hence the app mode on phones); Safari/WebKit was not tested.

## 1k. Payout audit, progressives, Blackjack side bets and the 99-file cap (scope addenda §33–§39)

**Status:** every *enabled* game and wager below passed its payout tests. Wagers whose published tables could not be verified are **disabled** (listed at the end), not approximated.

### §35 Three Card Poker defect — what was found and fixed
* **Reproduced exactly** (unit + live-table integration test): player 8♠ 8♥ 8♦ vs dealer A♣ J♣ 6♣. The settlement code (`settleTcp`) already ranked Three of a Kind above Flush and paid correctly: Ante 1:1, Play 1:1, Ante Bonus 4:1, Pair Plus 30:1 (default table). Reversed hands lose correctly. A 6×6 category matrix, kickers, A-K-Q / A-2-3 straights (no wrap), ties and Queen-high qualification are all tested.
* **Defect 1 — stored ranking:** `TCP_EQUIV_RANK` stored Three Card hands on a five-card scale (Flush 5 > Straight 4 > Three of a Kind 3). Best-hand stats, "hand of the night" and history ordering therefore placed a Flush above Three of a Kind. **Fix:** stored rank now follows Three Card order (`TCP_STORED_RANK`); migration 013 rewrites existing settled TCP rows. Test: the live repro hand is stored with rank 4 and reported as the best hand.
* **Defect 2 — Progressive:** Three Card Poker had **no progressive at all** (the circle belonged to Hold’em and was refused at TCP tables), so no Three Card Progressive could ever pay. **Fix:** Three Card Poker Progressive Link (Nevada) with its own meter; PT7 default. It reads only the player’s three cards and is resolved whatever the Ante/Play outcome or a fold (Nevada: “always resolved regardless of the outcome of the main theme”). Test: Three of a Kind at $5 pays 500 chips total, the $5 not returned.

### Verified payout matrix (implemented code checked against the source; X:1 = winnings plus stake back; “for 1” = total paid, stake not returned)
| Game / wager | Table(s) | Source | Profile | Payouts | Convention | Fold / qualification |
|---|---|---|---|---|---|---|
| UTH Blind | — | WSGC Stadium UTH | source-accurate | RF 500, SF 50, 4K 10, FH 3, Fl 3:2, St 1; win below St pushes | X:1 (3:2 rounded down to $1) | lost on fold |
| UTH Trips | UTH-01…05 (default 02) | WSGC Stadium UTH, “Trips Bonus” | source-accurate | 01: 50/40/30/9/7/4/3 · 02: 50/40/30/8/6/5/3 · 03: 50/40/30/8/7/4/3 · 04: 50/40/20/7/6/5/3 · 05: 50/40/30/7/6/5/3 | X:1 | pays on folded hands |
| UTH Ultimate Pairs | UP-01…06 (default UP-04) | WSGC Stadium UTH paytables 1–6; MLGCA v1.5 B/D | source-accurate | 01: AA30 AKs25 AQ/AJs20 AKo15 KK–JJ10 AQ/AJo5 22–TT3 · 02: as 01 + both-aces 1000 · 03: AA30 A+face s20 o10 pair5 · 04: A♥A♦100 AA30 20/10 pair4 · 05: A♥A♦50 AA25 20/10 pair5 · 06: AA25 20/10 pair5 | X:1, highest row once | dealer-card row never confirmed before the reveal |
| UTH Bad Beat | BB-01…03 (default BB-01) | WSGC Stadium UTH; CA BGC | source-accurate | SF 10000/7500/2500 · 4K 500 · FH 40/50/50 · Fl 25/30/30 · St 20 · Trips 9 | X:1 on the LOSING hand | ties never qualify; losing hand ≥ Trips; full kickers |
| UTH Progressive | Five Card ($5) | Hollywood PNRC guide; WSGC Paytable 01 | source-accurate pays; seed/rate operator | RF 100% · SF 10% · 4K $1,500 · FH $250 · Fl $200 · St $150 · Trips $45; Envy $5,000/$1,500 | for 1 | live after fold |
| UTH Progressive | V2 ($1) | Wizard of Odds “Small Progressive” (Nevada V2 PDF not readable here) | pays per WoO; seed/rate operator | hidden RF 100% (+$100 Envy) · board RF 1,000 · SF 250 · 4K 75 · FH 10 (per $1) | for 1; highest only | live after fold; board royal never drains meter |
| TCP Ante/Play | — | Wizard of Odds | source-accurate | 1:1; dealer Q-high qualifies; not qualified: Ante 1:1, Play push | X:1 | fold loses Ante |
| TCP Ante Bonus | — | Wizard of Odds Table 1 | source-accurate | SF 5, Trips 4, St 1 | X:1 | needs a Play bet |
| TCP Pair Plus | pp-1…10, pp-mr1…6 (default pp-8) | Wizard of Odds Pairplus tables | source-accurate | e.g. pp-8: 40/30/6/3/1; Mini Royal tables add A-K-Q suited (80/50/50/200/100/50) | X:1 | pays on fold |
| TCP Six Card Bonus | 1000/200/100/20/15/10/7 | Wizard of Odds | source-accurate | standard five-card ranks, best 5 of 6 | X:1 | pays on fold |
| TCP Progressive | PT1b, PT2b, PT3a, PT6, PT7 (default), PT8 | Nevada Three Card Poker Progressive Link | pays source-accurate; High Roller custom | A-K-Q jackpot suit 100% · A-K-Q other 500 · SF 70/100/75/80/120/100 · Trips 60/90/50/60/100/50 · St 6/–/5/7/–/6 (per $1) | for 1 | independent of main result and fold |
| BJ main | 3:2 natural, 1:1 win, insurance 2:1, push | existing §27 rules | — | six decks, S17, peek, DAS, split to 4, one card to split aces | X:1 | — |
| BJ Perfect Player / Dealer Pairs | All Bets 25/12/6; Player also PA Paytable B 30/10/5 | NV All Bets Blackjack; PA §633c.1 | **adapted six-deck** | perfect / coloured / mixed | X:1 | dealer pairs settle with the hole card |
| BJ 21+3 | All Bets 100/40/30/10/5 | NV All Bets | adapted six-deck | suited trips / SF / trips / straight / flush | X:1 | after the deal |
| BJ Top 3 | All Bets 270/180/90; PA second table 1000/100/70 | NV All Bets; PA §633c.7 | adapted six-deck | suited trips / SF / trips | X:1 | independent of 21+3 |
| BJ Buster | All Bets 2000/800/250/50/18/4/2 | NV All Bets; PA §633c.13 | adapted six-deck | 8+ w/ BJ, 7 w/ BJ, 8+, 7, 6, 5, 3–4 cards | X:1 | no extra draws: dealer not drawing ⇒ no bust ⇒ loses |
| BJ Lucky Lucky | All Bets 200/100/50/25/15/3/2/2 | NV All Bets | adapted six-deck | suited 777, suited 678, 777, 678, suited 21, 21, 20, 19 | X:1 | ace counts as in Blackjack (source silent) |
| BJ Lucky Ladies | PT-FLTLL-01/02/03 | NV Lucky Ladies V7 App. A | source-accurate | Q♥ pair + dealer BJ 1000 · Q♥ pair 200/150/125 · matched 20/25/20 · suited 20/10/9 · any 20 4 | X:1 | settles with the hole card |
| BJ Match the Dealer | six-deck 22/15/11/8/4 | Las Vegas Advisor (secondary) | six-deck only | 2 suited / suited+unsuited / 1 suited / 2 unsuited / 1 unsuited | X:1 | after the deal |
| BJ 21+3 Progressive | PT-PRG-213-16 | NV 21+3 Progressive V5 | pays source-accurate; High Roller custom default | Mini Royal jackpot suit 100% · Mini Royal 500 · SF 75 · Trips 30 · St 5; Flush loses (per $1) | for 1 | independent of the hand and of ordinary 21+3 |

**Discrepancies found and corrected:** (1) TCP stored rank (above); (2) no TCP progressive (above); (3) the UP-02 / UP-04 names were “Bonus 2/4” and Bad Beat “Bonus 01/02” — renamed to the Stadium identifiers and the missing UP-01/03/05/06 and BB-03 added; (4) Trips had one table — the five Stadium configurations are now selectable; (5) the progressive wager size was hard-coded at $5 in validation and on screen — it now follows the table’s variant/profile. No discrepancy was found in the Blind, Ante/Play, existing UP-02/UP-04 rows, BB-01/02 rows, Pair Plus default or Six Card tables.

**Unverified — disabled in the betting menu (shown as unavailable with the reason):** Royal Match, Super Sevens, Blazing 7’s, Hot 3, Super 4, an Ace-combination Progressive Blackjack, Lucky Ladies PT-FLTLL-04 (garbled columns in the source), Three Card Poker Bad Beat Progressive and Bad Beat Bonus (Nevada PDFs are scanned images with no text layer). The UP-02 placement of the 1,000:1 both-aces award follows the scope and MLGCA Paytable B; the WSGC text layer does not say which of its first two columns holds it.

**Progressive Envy** is used only where the source names it: Five Card (both sources), UTH V2 (hidden royal, $100 per $1), TCP PT1b/2b/6/7 ($100/$25 per $1 — Nevada lists Envy for these tables without stating the base; the amounts are the Wizard of Odds figures for the same table). None on PT3a, PT8 or 21+3 Progressive.

**Tests added** (all passing): unit — the §35 repro both ways, the 6×6 matrix, kickers/straights/ties/qualification, stored-rank order, Mini Royal handling, every Pair Plus table (positive + negative per row), every Six Card row, all five Trips configurations, Blind, all six Ultimate Pairs schedules (A♥A♦, both aces, dealer-pending), all three Bad Beat schedules both ways plus ties and kickers, UTH V2 categories and Envy, meter separation and High Roller scaling, percentage/multiple-winner/seed handling, 21+3 Progressive categories, every Blackjack side bet row, validation (closed wager, limits, whole dollars, insufficient bankroll), host preset parsing, and the 99-file cap. Integration (PostgreSQL) — six players with six different side-bet mixes on a rigged shoe (every result, stats endpoint, progressive history, stored rules profile, ledger reconciliation), dealer blackjack before play, every hand busting (no extra dealer card; Buster loses), rebet after the host changes the menu, four tables claiming the 21+3 jackpot at once (paid once each, serialized, conservation exact, retries never pay twice), restart refunds with side bets and meter contribution reversal, and the §35 repro at a live table. Browser — six players in Chrome, each choosing a different mix in the Bonus Bets panel; every recorded result is re-derived from the hand’s actual cards.

**Not covered by a dedicated test:** a dealer rotation triggered specifically by a Blackjack bonus win (rotation uses the round’s total net, which now includes side-bet payouts; the §25 rotation tests are unchanged); a High-Roller house-edge figure (deliberately not shown); the progressive Envy for TCP at a live multi-player table (covered at unit level).

**File count:** 97 tracked files (cap 99), checked by `scripts/count-files.mjs` in `npm run build`, `npm test` and a unit test. To make room, the six documentation screenshots became one contact sheet (`docs/screenshots.jpg`).

## 1j. Dealer Roast Engine (scope addendum §32, v2 "No Mercy", §32.13 library) — library complete

**Library status (exact, from `contentReport()` and the content test):** 6,300 lines = 12 dealers × 15 lines × 35 situations.
- **Primary (§32.13 requirement): 4,500 / 4,500.** All 25 categories: Wrong Call Win, Wrong Call Loss, Right Call Loss, terrible Hold'em river fold, bad river call, repeated checking, Three Card Poker bad fold, Blackjack hit on 20, split tens, Blackjack bust, terrible double down, 5-hand and 10-hand losing streaks, winning streak, bragging before losing, major Progressive, Bad Beat, Royal Flush, entire table losing, several bad decisions, back from sitting out, repeatedly ignoring strategy, end of shift, replacement after a major win, returning grudge.
- **Additional pools: 1,800 (10 × 180).** Introductions, farewells, greetings, chat comebacks (never quote what the player wrote), meltdowns, Blackjack naturals, comeback wins, rivalry callbacks, side-bet wins, improbable hands.
- Every dealer/situation has 3 Smartass, 4 Asshole, 4 Complete Menace and 4 No Mercy lines. All 6,300 ids are unique; no two lines are the same text with a different name or punctuation (across all dealers and all situations); no 9-word run is reused by 4+ dealers in a situation.

**Changes in this round:**
- *Rivalry callback wired:* once per shift, for a consenting player whom this dealer has already dealt 25+ hands, the dealer quotes the real count. To make that number honest, `dealer_rivalries.witnessed` now counts settled hands that dealer dealt the player (+1 per hand). It used to count mistakes, which the lines would have misdescribed. Existing rows keep their old totals.
- *Dealer changes:* at a roasting table, the farewell, shift-end/major-win note and introduction now come from the library. Two §25 integration tests compared chat with the old fixed lines; they now accept either the fixed line or the library line for the same event. Professional tables still use the fixed lines.

**What is built and tested (unit 25, integration 4 on PostgreSQL, browser 1):**
- *Content validation:* every authored dealer/category has ≥15 distinct non-placeholder lines; near-duplicates (same text with a different name or punctuation) are rejected; no line is shared between dealers; every line carries id, dealer, category, intensity, required facts (from a fixed list), profanity class, size, priority, cooldown and speech style; Smartass lines stay mild and No Mercy lines swear; a banned-term check for slurs, protected characteristics, appearance, self-harm and sexual or violent content passes on all 6,300 lines (by pattern — I also read every line while writing it, and rewrote lines that leaned on drugs, depression, violence or gendered references to players).
- *Rendering:* fact substitution; the clean filter leaves zero profanity in all 6,300 lines and keeps shouted lines shouted, with no false positives inside words ("Michelle", "shell").
- *Viewer limits:* mute hides; a Professional viewer gets the plain text; a lower personal maximum gets a gentler line from the same dealer and situation, the same one on every device; profanity off cleans whatever is shown; one viewer's settings never change the payload others receive.
- *Director:* hit-20 roast goes to the right player by name and is short mid-hand; players who didn't opt in are never targeted; a player's own maximum caps lines aimed at them even at No Mercy; a Professional table never roasts and a Smartass table only uses Smartass lines; no line repeats in 40 consecutive triggers (and the dealer goes quiet rather than repeat); each dealer only uses their own lines; no double roast for the same blunder; ungraded or correct decisions never produce a mistake roast; quoted wrong-call-win counts equal the real verified count (absent until there are two); grudge phrases come only from stored events; rivalry callbacks fire at most once per shift, only for opted-in players with 25+ stored hands, and quote exactly the stored count (which goes up by one per settled hand); a failing database never throws into the table engine.
- *Integration (sockets, PostgreSQL):* at a No Mercy Blackjack table, hitting 20 produces exactly one short `hit20` roast for the opted-in player, from the dealer on shift, with a Professional fallback text; the opted-out player is never targeted; the same rigged round at a Professional table settles to identical cards and balances with no roasts, and every stack equals its ledger; in Hold'em a verified river fold is roasted only after settlement (no roast during the hand) and a player with no graded mistakes never gets a mistake roast; Dealer Attitude is host-only and validated, private tables default to Asshole, public to Smartass; consent input is sanitized.
- *Browser (desktop host + iPhone guest):* host sets No Mercy; both see the opt-in card; Tom opts in, Vic keeps it general and turns profanity off with a Smartass cap on his phone; after a few hands Tom gets a verified-mistake roast; nobody is ever roasted by Vic's id; every roast on Vic's phone is free of profanity; the phone caption ends above the dealer's cards. No page errors.
- *By eye:* desktop caption above the felt on the rail; phone caption over the header bar (taps pass through) clamped to two lines.

**Not verified / not done:** spoken dialogue was not heard (no audio in this environment) — the code falls back to text when speech synthesis is missing, but no automated test covers a real voice; meltdown, grudge, greeting, comeback, rivalry and rotation roasts are tested at the director level with real lines, but the browser test only drives ordinary mistake roasts; group triggers for "several players lose side bets" and "contradictory predictions in chat" are not implemented; the joke quality and how funny each line is cannot be tested — that's for your table to judge.

## 1i. Dealers, Blackjack, chips, borders and Decision Quality (scope addenda §25–31)

Built in this order: §26 character consistency → §25 dealers → §27 Blackjack → §28 chips → §29 borders → §31 decision quality → §30 end-to-end flow. Run on 8 November 2026.

**§25 Rotating dealers — integration (7, PostgreSQL).** A new table opens with a roster dealer who chats under their own name. Host settings are validated and host-only (non-host refused; shift must be 10/25/50/100; bad thresholds and unknown dealers refused); a dealer pick is refused mid-hand. Rotation after the 10th completed round: the results stay with the old dealer, the new one takes over at the next betting round with `rotate/shift` and their short intro in chat, never the same dealer. A major win rotates early, once, from settled results only. The shift count belongs to the table and survives a game switch; dealer changes never touch the deck. Host pick between hands. Restart: same dealer and count; a voided hand does not count. The **default 25-round shift** is exercised in the §30 flow test below (25 six-player rounds, hand-over exactly after the 25th).

**§26 Character consistency — unit (6) + browser.** For every hairstyle: identical hair markup across all eight expressions and three poses; identical under every hat (hair is clipped at the hat line, never reshaped); one transform per face shape; long and tied-back hair drawn behind shoulders in the same head turn; facial hair fitted to each jaw; deterministic output at any size. In the browser test the same player's `.hair-front` markup is compared between the Character Creator, the lobby card, her desktop seat, the same seat on another player's iPhone, and again after switching to Blackjack — all identical. Screenshots by eye: 14 hairstyles × face shapes grid, the 12 dealers and 8 expressions.

**§27 Blackjack — unit (36), integration (10, PostgreSQL), browser (1, six players).**
- *Unit:* hard/soft/multiple-ace totals; S17 dealer; exact 3:2 (including $1 → $1.50); natural vs natural push; dealer blackjack beats 21; busts lose even when the dealer busts; split 21 pays 1:1; doubles pay on the doubled bet; surrender returns half; insurance pays 2:1 only against a blackjack; double/split need the money and the right cards; 20+ basic-strategy cells (hard, soft, pairs); surrender only when enabled; no-DAS variant; unaffordable ideal double/split → best available and marked constrained.
- *Integration:* rules shown before betting; side bets, half dollars and unaffordable bets refused; natural pays 3:2 exactly; dealer stands on soft 17; hole card hidden from everyone until the dealer plays; dealer blackjack with peek: naturals push, others lose, insurance 2:1, insurance timeout declines; split + double after split + cap at four hands; split aces one card each and 21 is not a blackjack; no double/split without the chips; out-of-turn and stale-hand moves refused; late surrender when the host enables it; a disconnected player is stood by the server timer; game switches only between rounds and keep everything; six players act in seat order and settle independently. Every test reconciles each stack with its ledger.
- *Browser (2 iPhone + 4 desktop):* host switches to Blackjack; two full rounds; each round everyone sees exactly one face-down dealer card while players act; players act strictly in seat order (recorded from the screens), never two at once; insurance is declined when offered; all six screens agree on every balance afterwards and the dealer's cards are face up. No page errors.

**§28 Chips — unit (4), integration (2) + browser.** Nine denominations $1…$100,000 plaque; 15 collections × 9 = 135 designs, each with a legible value and no scripts; catalog has a set plus nine singles per collection and a set implies its singles; values come from numbers, never designs; a $12,345,678 amount is a handful of chips and plaques. Integration: buy a set and singles, equip per denomination, unequip — stack equals ledger throughout (Style Credits never touch chips); a **$1,000,000 Ante on a $10,000,000 stack settles exactly**. Browser: after buying one Emerald Elite $25 chip, that player's rack shows the $25 in Emerald and the $5 in Classic. By eye: chip browser (3D spin, felt preview), high-limit tray, consolidated stacks, phone rack.

**§29 Animated borders — unit (4) + browser.** 15 borders render 15 distinct SVGs, each with its own animation class; four price tiers (250–2,500); previews contain no scripts, handlers or external references; buying needs enough Style Credits (refused otherwise, balance unchanged), a retried purchase key doesn't charge twice, unowned borders can't be equipped and owned ones can; settlement code (`rules`, `blackjack`, `tcp`, `sidebets`, `progressive`, `evaluator`) never reads cosmetics. Browser: a bought border shows on the lobby card and, for both players, on her seat. Device setting Full / Subtle / Static / Hide, off-screen and hidden-tab pause, reduced-motion and host effects levels are CSS/observer rules **checked by code review and a screenshot of all 15, not by an automated test** (see limitations).

**§31 Decision Quality vs. Results — unit (8), integration (5, PostgreSQL) + browser.**
- *Unit:* one deviation → wrong call; result is the main-game sign only; a folded hand whose side bet won is a loss; constrained/unverified decisions are ungraded, never "correct"; EV lost is identical whether the hand won or lost and is reported as unknown rather than guessed; summary rates, multiple mistakes in a hand counted once, per-game split, and all seven buckets add up to the rounds played; session = latest run without an hour's gap; history filters. Blackjack EV matches published infinite-deck values (16 v 9: stand −0.541, hit −0.508; 11 v 6 double +0.667; 12 v 4 stand −0.211); costs never negative.
- *Integration (real hands over sockets):* UTH 2-4 offsuit raised 4× wins on a trips flop → Wrong Call Win, profit = main-game net; A-K raised 4× loses → Right Call Loss with zero EV lost. A trips hand that checks the flop and folds the river with Trips+ up: total net positive, main game −$20 → Wrong Call **Loss**, two mistakes in one hand counted once, history shows both mistakes, the board and the cards. Blackjack: standing 16 v 9 that wins → Wrong Call Win whose EV cost equals the calculator's (fixed at decision time), a natural → ungraded; across games the buckets reconcile with 4 rounds; the Wrong Call Wins filter returns exactly the two qualifying hands with the dealer's final cards and the reason text. Three Card Poker: folding Q-6-4 → wrong call. Session view; **no way to write**: POST/PUT/PATCH to the statistics endpoint return 404 and change nothing; unauthenticated → 401.
- *Browser:* the stats page shows the four-box panel and "12 completed rounds" after the §30 flow. By eye on desktop and phone: panel, per-game table (scrolls sideways on a phone), filter chips, hand cards with mistakes, EV and verdict.

**§30 Integration flow — integration (3, six players, PostgreSQL) + browser (1).**
- *Integration:* avatar save, animated border (250) and one Emerald $25 chip (70) bought with Style Credits only (balance 300 + 50 − 250 − 70); six players sit; her look carries the border and chip; **25 Hold'em rounds under the default shift, dealer hands over exactly after the 25th**; host switches to Three Card Poker (one hand) then Blackjack (one round): same seat for every player, same identity, border still worn, and every stack equals its ledger after each game; her statistics show 25 + 1 + 1 hands under one identity.
- *Browser (desktop host + iPhone guest):* lobby → Character Creator (Afro, Save +50) → Boutique → Animated Borders → Emerald Pulse (Buy for 250, Wear it) → Custom Poker Chips → Emerald Elite → $25 only (Buy for 70, Use for $25 only) → 30 credits; same hair in creator, lobby and both devices' seats; border visible to the other player; host shortens the shift to 10 rounds in Host controls; ten Hold'em hands, then the dealer badge changes on both screens; switch to Three Card Poker (one hand, balances unchanged by the switch) and Blackjack (one round, same hair); both screens agree on balances; Statistics shows the Decision Quality panel. No page errors. (The browser test uses a 10-round shift to keep its run time near 3 minutes; the 25-round default is covered at socket level above.)

**Fixes found while testing:** new tables skipped dealer and shoe set-up (centralized); Blackjack controls were hidden behind *Sit out next hand*; bonus panel and jackpot showed in Blackjack; phone seat overlap in Blackjack; Blackjack main-game net now excludes insurance (insurance is reported as a side result); chip buttons lost their value classes in the chip redesign (restored); unknown `/api/*` routes and methods now answer JSON 404 instead of an HTML page. **A real Blackjack display bug found by the new six-player browser test:** when a player's hand reached four cards (or the dealer's), every browser at the table stopped updating, because the page tried to draw the extra card into a fixed poker card slot; the server kept playing correctly. Fixed in `table.ts` (Blackjack hands are drawn only by the Blackjack views); the browser test now hits until bust or 21 on one seat to cover it. The mini bet spots now show a chip picture, so the side-bet browser test reads the amount label instead of the whole spot text.

**Not verified (§25–31):** animation smoothness and frame rate on real low-end phones; the border Subtle/Static/Hide levels, off-screen pausing and reduced motion are not asserted by an automated test (by code and eye only); dealer voice cues by ear; Blackjack on a real iPhone/Safari; Blackjack EV for split hands ignores resplits (documented in the README); six-deck composition effects on EV (infinite-deck model); load beyond six players per table. Rotation after 50/100 rounds is the same code path as 10/25 and was not run. No real-money flow exists or was tested.

## 1h. Avatars, Style Credits and the Casino Boutique (scope addendum §24)

Built and tested in the addendum's order: Release 1 (Character Creator and portraits), then Release 2 (Style Credits, Boutique, inventory, history), then Release 3 (outfits, collections, chip skins, card backs, frames, victory effects, achievements, public profile).

**Unit (13).** Catalog: unique ids, valid slots, whole-credit prices; the addendum's nine example items at its example prices; every collection has 4+ items and an earn-only reward; free basics exist in every slot. Rewards contain no wager/win/loss/jackpot criteria. Appearance parsing accepts only enumerated values (markup, fractional and out-of-range indices are rejected). Equip checks: ownership, wrong slot, unknown item, collar and jacket compatibility, and dropping a tie when switching to a tee. Renderer: one self-contained `<svg>` with no scripts, event handlers, links, `foreignObject` or images over 40 random looks; hostile input is ignored rather than echoed; six random players get six different portraits; every catalog item previews. Service: price/reward/availability overrides; reward checks read only counts and pay once.

**Integration (11, PostgreSQL + memory store).** New guests get a distinct saved look and 300 credits once. Portraits appear on seats; a saved look reaches the other player live; the first save pays +50 once. Rejected: script in appearance, SVG markup, unowned item, incompatible bow tie, a client claiming ownership, buying a free or earned item, unknown item, missing key. Purchases: two simultaneous requests with the same key → one `ok`, one `duplicate`, charged once; a new key for an owned item → `owned`, not charged; two different items at once with credits for one → exactly one succeeds; no negative balance anywhere in history. Another player (even same display name) can't wear your item. Credits never touch chips: stack = ledger sum before and after 5,000 credits and six purchases; finishing Classic Vegas unlocks its frame. A $100 winner and a $5 folder earn exactly the same (first hand + game night = 200) and both get the `style:earned` notice. Looks stay on seats after switching to Three Card Poker and through a TCP hand; only the host can set effects. Reaction sets enforced. Public profile/looks contain no balances, stacks or tokens. **Interruption:** after a purchase the server is shut down and a new server starts on the same database; retrying the same key returns `duplicate`; balance, owned items and look are unchanged.

**Browser (Playwright, 1 iPhone + 5 desktop).** On a phone: 300 credits shown; Character Creator → Mohawk → *Unsaved changes* → Save → 350; Boutique → Hats → Try on (Mirror) → Buy (confirmation shows 200 left) → Wear it → Owned badge, 200 credits, history line. Six players join: six portraits on every screen, all different; everyone sees Ava's fedora; on the phone no portrait overlaps another seat's plate or cards. A Hold'em hand with different bets → both a $25 and a $5 player see *First hand +100*. Host switches to Three Card Poker: same portraits on the same seats. No page errors.

**By eye.** Phone 393×659 and desktop with six dressed players: frames, hats and the forearm-and-watch stay inside each portrait circle; personal card backs (Art Deco, Saloon) and chip skins at seats; chat portraits; Character Creator and Boutique on phone and desktop; lobby portraits.

**Test harness fix.** Browser tests now close every browser context after each test. Before, six-player tests left their 6 browsers open, and with portraits on every seat the later six-player tests could run slow enough for a result screen to clear mid-check. With the fix the whole browser suite runs in about 3 minutes and passed twice in a row.

**Not verified:** a real iPhone/Safari; screen readers on the creator tiles; victory animations captured mid-flight (they run 1–2.5 s and were checked in code and by triggering, not in a screenshot); load beyond six players. No real-money flow exists or was tested.

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

Screenshots from these runs (desktop and iPhone, settled hand) are in `docs/screenshots.jpg` (one contact sheet).

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
* **Spotify table music** was tested only against mocked Spotify services (see 1l).
* **Not implemented:** registered accounts and a friends list (guest identities only, as the brief allowed); a cross-table hand-history browser (replays are reached from a table's History panel, last 15 hands, and from the Tonight tab); horizontal scaling across multiple server instances.
