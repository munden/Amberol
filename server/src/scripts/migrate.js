#!/usr/bin/env node
// Applies db/migrations/*.sql in filename order, once each.
//   node src/scripts/migrate.js          apply anything outstanding
//   node src/scripts/migrate.js --reset  drop the schema first, then apply all
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool, connectionString } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../../db/migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const client = await pool.connect();

  try {
    console.log(`[migrate] ${connectionString.replace(/:[^:@/]*@/, ':***@')}`);

    if (reset) {
      console.log('[migrate] dropping schema public');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip    ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration is its own transaction, so a failure leaves the
      // database on the last good migration rather than half-way through one.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] applied ${file}`);
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }

    console.log(count ? `[migrate] ${count} migration(s) applied` : '[migrate] up to date');
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((err) => {
  console.error('[migrate] ' + err.message);
  process.exit(1);
});
