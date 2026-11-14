import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { cosmeticsConfigFromEnv } from './cosmetics.js';
import { MemoryStore } from './memoryStore.js';
import { PgStore } from './pgStore.js';
import type { Store } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
// Works both from src/server (tsx) and dist/server/server (compiled).
const root = [join(here, '..', '..'), join(here, '..', '..', '..')].find((p) => existsSync(join(p, 'migrations')))!;

async function main() {
  const url = process.env.DATABASE_URL;
  let store: Store;
  if (url) {
    store = new PgStore(url, join(root, 'migrations'));
    console.log('[db] PostgreSQL');
  } else {
    store = new MemoryStore();
    console.warn('[db] DATABASE_URL not set — using the in-memory store. Data will be lost on restart.');
  }
  const server = await createApp({
    store,
    staticDir: join(root, 'dist', 'client'),
    trustProxy: process.env.TRUST_PROXY === '1',
    spotifyClientId: (process.env.SPOTIFY_CLIENT_ID ?? '').trim(),
    cosmetics: cosmeticsConfigFromEnv(),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT ?? 3000);
  server.http.listen(port, () => console.log(`[uth] listening on http://localhost:${port}`));

  const shutdown = async () => {
    console.log('[uth] shutting down');
    await server.close().catch(() => {});
    await store.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
