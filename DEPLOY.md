# Deploying

The app is one Node service (HTTP + WebSockets on the same port) plus one PostgreSQL database. It applies database migrations itself on startup and voids/refunds any hand interrupted by a restart.

**Run exactly one instance.** Live table state lives in the process; a second replica would split players across two copies of the same table.

Environment variables:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (production) | Postgres connection string. Append `?sslmode=require` if your provider requires TLS from outside its network. |
| `PORT` | set by most hosts | Listening port (default 3000). |
| `TRUST_PROXY` | `1` behind a TLS proxy | Uses `X-Forwarded-For` for per-IP rate limits. |
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

## Operations

* **Backups:** the database holds identities, stacks, hand history and the ledger. Use your provider's scheduled backups.
* **Restarts / deploys:** safe at any time. Hands in progress are voided on the next boot and all their stakes refunded exactly once (see `voidActiveHands` in `src/server/pgStore.ts`). Players' browsers reconnect automatically and rejoin their table.
* **Audit:** every chip movement is a row in `ledger`; `SUM(amount)` per player and table equals the stack balance.
