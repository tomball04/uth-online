// Gives the e2e server a clean schema before it starts (it runs migrations on boot).
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await c.end();
