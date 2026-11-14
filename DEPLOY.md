# Deploying

The app is one Node service (HTTP + WebSockets on the same port) plus one PostgreSQL database. It applies database migrations itself on startup and voids/refunds any hand interrupted by a restart.

**Run exactly one instance.** Live table state lives in the process; a second replica would split players across two copies of the same table.

Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (production) | Postgres connection string. Append `?sslmode=require` if your provider requires TLS from outside its network. |
| `PORT` | set by most hosts | Listening port (default 3000). |
| `TRUST_PROXY` | `1` behind a TLS proxy | Uses `X-Forwarded-For` for per-IP rate limits. |
| `SPOTIFY_CLIENT_ID` | optional | Client ID of your Spotify developer app — turns on **Table music** (listen along with the host). Public value, not a secret. Leave empty to hide the feature. See *Table music (Spotify)* below. |
| `ALLOWED_ORIGINS` | optional | Comma-separated origins allowed to open sockets from a different domain. Leave empty when the client is served by this same app (the normal setup). |

Health check: `GET /api/health`.

## Render (Blueprint)

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, select the repo. `render.yaml` creates the web service and a Postgres database and wires `DATABASE_URL`.
3. Check the plan selections Render proposes, then apply. Build: `npm ci && npm run build`; start: `npm start`.
4. Open the `*.onrender.com` URL. HTTPS and WSS are automatic.

Free web services on Render sleep when idle; the first visit after a sleep takes a few seconds and any hand in progress at that moment is voided and refunded. Use a paid instance for game nights.

## Railway

1. **New project → Deploy from GitHub repo.** `railway.json` tells Railway to build the Dockerfile with one replica.
2. **Add → Database → PostgreSQL**, then in the app service's Variables add `DATABASE_URL = ${{Postgres.DATABASE_URL}}` and `TRUST_PROXY = 1`.
3. **Settings → Networking → Generate domain.** HTTPS/WSS are automatic.

## Any Docker host (Fly.io, a VPS, …)

```bash
docker build -t uth-online .
docker run -d -p 3000:3000 \
  -e DATABASE_URL=postgres://user:pass@host:5432/uth \
  -e TRUST_PROXY=1 \
  --restart unless-stopped uth-online
```

Or locally with the bundled database: `docker compose --profile app up --build` → http://localhost:3000.

## Custom domain and HTTPS / WSS

* **Render / Railway:** add the custom domain in the service settings and create the CNAME record they show you. Certificates are issued automatically; `wss://` works on the same domain with no extra configuration.
* **Your own server:** put a TLS-terminating reverse proxy in front. Example Caddy config (automatic Let's Encrypt certificates, WebSockets pass through):

  ```
  play.example.com {
    reverse_proxy localhost:3000
  }
  ```

  With nginx, make sure WebSocket upgrades are forwarded:

  ```nginx
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
  ```

  Then set `TRUST_PROXY=1`.

## Optional settings: Boutique prices and rewards

Set any of these as environment variables (JSON). Leave them out to use the built-in values.

* `COSMETIC_PRICES` — price overrides in Style Credits, e.g. `{"fedora-black":200,"frame-royal":2000}`.
* `STYLE_REWARDS` — reward overrides, e.g. `{"welcome":500,"session":75}`.
* `COSMETIC_UNAVAILABLE` — item ids to hide from the Boutique, e.g. `["tux-white"]`. Owners keep them.

Item and reward ids are listed in `src/shared/cosmetics.ts`.

## Table music (Spotify)

Each person listens on **their own** Spotify account; the server relays only the track and position (no audio, no tokens). To turn it on:

1. Sign in at <https://developer.spotify.com/dashboard> with a **Spotify Premium** account (Spotify requires Premium for the app owner since February 2026) and create an app. Tick **Web API** and **Web Playback SDK**.
2. Add a Redirect URI of exactly `https://<your-domain>/spotify-callback` (for example `https://uth-online.onrender.com/spotify-callback`). Spotify only accepts HTTPS, or `http://127.0.0.1:<port>/spotify-callback` for local testing — not `localhost`.
3. Under **User Management**, add the Spotify email of everyone who will listen. In Development Mode Spotify allows **up to 5 users per app**, and each of them needs Premium to play.
4. Copy the app's **Client ID** into `SPOTIFY_CLIENT_ID` (Render: *Environment*), and redeploy. No client secret is used — sign-in is PKCE in the browser, and tokens stay on each person's device.

More than 5 listeners needs Spotify's extended quota, which Spotify currently grants only to registered businesses. The content security policy already allows `sdk.scdn.co`, `api.spotify.com`, `accounts.spotify.com` and `i.scdn.co`; nothing else is opened.

## What the newer releases add to the database

Migrations run on start, in order, once each, and only add tables and columns:

* `009_cosmetics.sql` — avatars, Style Credits, owned items (§24; chips and borders reuse it — no new table).
* `010_dealers.sql` — `game_tables.dealer_id`, `dealer_rounds` (rotating dealers, §25).
* `011_blackjack.sql` — `'bj'` allowed in the game checks; `hand_players.bj_extra`, `bj_insurance`; `decisions.graded`, `decisions.ev_cost_cents` (§27, §31).
* `012_roast.sql` — `dealer_rivalries` (comedic dealer-vs-player records for §32 roasts; never read by dealing or settlement). `witnessed` = settled hands that dealer has dealt the player; it feeds the rivalry callback (25+). No schema change: in builds before the complete library it counted mistakes, so old rows start from that total.

* `013_progressive_service.sql` — §33–§39: per-meter `seed/game/variant/profile` on `progressive_meter` (the Five Card meter keeps its id and balance; other meters are created on first use at their seed); `progressive_hits.meter_id`, with uniqueness now per (hand, player, meter); a new `progressive_tx` history table (one row per settled progressive wager); `hand_players.prog_meter / prog_contrib / side_bets / side_stake / side_results`; `hands.rules_profile`. It also **rewrites `hand_rank` for settled Three Card Poker rows** into Three Card order (Straight Flush > Three of a Kind > Straight > Flush > Pair > High Card), which corrects history, best-hand stats and recaps. Older builds still run against it (new columns have defaults; the replaced unique constraint is a superset of the old one).

No new environment variables are required. The roast engine needs no external API (it works offline). Dealer attitude, dealer rotation, Blackjack surrender and table limits are host settings per table. Chip collections (`chips-*`, `chip-<collection>-<value>`) and borders (`border-*`) are ordinary Boutique items, so `COSMETIC_PRICES` and `COSMETIC_UNAVAILABLE` work for them too. Decision-quality statistics are computed on request from existing rows — nothing to backfill; hands recorded before migration 011 count as graded, and their EV comes from the stored ante-unit EV.

## Operations

* **Backups:** the database holds identities, stacks, hand history, nights and the ledger. Neon keeps a point-in-time restore window (its length depends on your plan); for a longer history run `pg_dump "$DATABASE_URL" > uth-$(date +%F).sql` now and then and keep the file. Restoring is `psql "$DATABASE_URL" < file.sql` into an empty database.
* **Monitoring:** `GET /api/health` returns `{ ok, tables }`; point Render's health check (or any uptime pinger) at it. Errors and restarts show in Render's **Logs** tab. A free Render service sleeps after ~15 minutes idle; the first visit wakes it in under a minute and nothing is lost.
* **Deploy safety:** migrations in `migrations/` run automatically on start, in order, once each. They only add tables and columns (new columns have defaults or allow empty values), so an older build can still run against the newer database if you need to roll back. This is by design; it is not covered by an automated test.
* **Moving devices:** a player's identity is a private restore code (Settings → Use another device). There are no passwords to reset; if someone loses their code and their browser data, they start a new guest.
* **Restarts / deploys:** safe at any time. Hands in progress are voided on the next boot and all their stakes refunded exactly once (see `voidActiveHands` in `src/server/pgStore.ts`). Players' browsers reconnect automatically and rejoin their table.
* **Audit:** every chip movement is a row in `ledger`; `SUM(amount)` per player and table equals the stack balance.
