#!/usr/bin/env node
/**
 * Checks an installation and says what to do next.
 *
 *   npm run doctor
 *
 * Written for the moment when the register is running but nothing loads: it
 * walks the chain from configuration to seeded data and stops at the first
 * broken link, rather than reporting a wall of symptoms.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool, connectionString, describeDatabaseFault } from '../lib/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tick = (ok) => (ok ? '  ok  ' : ' FAIL ');

function say(ok, label, detail) {
  console.log(`[${tick(ok)}] ${label}${detail ? '\n         ' + detail : ''}`);
}

function finish(message) {
  console.log('\n' + '-'.repeat(66));
  console.log(message);
  console.log('-'.repeat(66));
}

console.log('Amberola Cylinder Register — checking this installation\n');

// 1. Configuration ---------------------------------------------------------
const envPath = path.join(root, 'server', '.env');
const haveEnv = existsSync(envPath);
say(haveEnv, 'server/.env', haveEnv ? undefined : 'Missing. Run "npm run setup".');
say(true, 'DATABASE_URL', connectionString.replace(/:[^:@/]*@/, ':***@'));

// 2. Connection ------------------------------------------------------------
let connected = false;
try {
  await pool.query('SELECT 1');
  connected = true;
  say(true, 'Connection to PostgreSQL');
} catch (err) {
  const fault = describeDatabaseFault(err);
  say(false, 'Connection to PostgreSQL', fault ? fault.message : err.message);
  finish(
    fault?.state === 'not_running'
      ? 'PostgreSQL is not running. Start the service and run this again.'
      : 'Fix the connection first — nothing else can be checked until it works.',
  );
  await closePool();
  process.exit(1);
}

// 3. Schema ----------------------------------------------------------------
let migrated = false;
try {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN
        ('catalog_records','collection_items','cleaning_events','catalog_search')`,
  );
  migrated = rows[0].n === 4;
  say(migrated, 'Schema', migrated ? undefined : 'Tables are missing. Run "npm run migrate".');
} catch (err) {
  say(false, 'Schema', err.message);
}

if (!migrated) {
  finish('Run:  npm run migrate     then:  npm run seed');
  await closePool();
  process.exit(1);
}

// 4. Data ------------------------------------------------------------------
const counts = {};
for (const [label, sql] of Object.entries({
  records: 'SELECT count(*)::int AS n FROM catalog_records',
  people: 'SELECT count(*)::int AS n FROM people',
  makers: 'SELECT count(*)::int AS n FROM makers',
  series: 'SELECT count(*)::int AS n FROM series',
  indexed: 'SELECT count(*)::int AS n FROM catalog_search',
  owned: 'SELECT count(*)::int AS n FROM collection_items',
  grades: 'SELECT count(*)::int AS n FROM condition_grades',
})) {
  const { rows } = await pool.query(sql);
  counts[label] = rows[0].n;
}

const seeded = counts.records > 0;
say(seeded, 'Master catalog',
  seeded
    ? `${counts.records} records · ${counts.people} people · ${counts.makers} makers · ${counts.series} series`
    : 'Empty. Run "npm run seed".');

say(counts.grades > 0, 'Grading scale, defects and cleaning methods',
  counts.grades > 0 ? `${counts.grades} grades` : 'Missing — re-run "npm run migrate".');

// The search index is trigger-maintained, so a mismatch means it was loaded
// in a way that bypassed them and needs rebuilding.
const indexOk = counts.indexed === counts.records;
say(indexOk, 'Search index',
  indexOk ? `${counts.indexed} records indexed`
          : `${counts.indexed} indexed of ${counts.records} — run "npm run reindex".`);

say(true, 'Your collection', `${counts.owned} cylinder(s) on the shelf`);

if (!seeded) {
  finish('Run:  npm run seed');
  await closePool();
  process.exit(1);
}

finish(
  !indexOk
    ? 'Run:  npm run reindex'
    : 'Everything checks out. Start it with "npm start", then open http://localhost:4310',
);

await closePool();
