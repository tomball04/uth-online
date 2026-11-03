import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgStore } from './pgStore.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const store = new PgStore(url, join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations'));
await store.init();
console.log('Migrations applied.');
await store.close();
