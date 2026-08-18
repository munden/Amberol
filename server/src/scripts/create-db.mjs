#!/usr/bin/env node
/**
 * Creates the register's role and database using the PostgreSQL driver the
 * server already depends on, rather than the psql command line.
 *
 * The Windows installer frequently leaves psql off PATH, which used to stop
 * setup dead even though the server itself was running and reachable. Nothing
 * here needs a command-line client.
 *
 *   node src/scripts/create-db.mjs
 *
 * Reads the target from DATABASE_URL. The superuser password comes from
 * PGPASSWORD when set, otherwise it is asked for.
 */
import readline from 'node:readline';
import pg from 'pg';
import 'dotenv/config';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://amberola:amberola@127.0.0.1:5432/amberola';

const target = new URL(DATABASE_URL);
const DB_USER = decodeURIComponent(target.username) || 'amberola';
const DB_PASS = decodeURIComponent(target.password) || 'amberola';
const DB_NAME = target.pathname.replace(/^\//, '') || 'amberola';
const DB_HOST = target.hostname || '127.0.0.1';
const DB_PORT = Number(target.port || 5432);

const SUPERUSER = process.env.PGSUPERUSER || 'postgres';

/** Asks for a password without echoing it. */
function askPassword(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(
        'No terminal to ask for a password on. Set PGSUPERUSER and PGPASSWORD, ' +
        'or create the role and database by hand.',
      ));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // readline writes each keystroke back to the terminal; swallow them while
    // the password is being typed so it does not appear on screen.
    rl._writeToOutput = function (chunk) {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

/** True when the application's own connection string already works. */
async function canConnect() {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    try { await client.end(); } catch { /* already closed */ }
    return false;
  }
}

async function main() {
  if (await canConnect()) {
    console.log(`    "${DB_NAME}" is already reachable as "${DB_USER}"`);
    return;
  }

  let password = process.env.PGPASSWORD;
  if (!password) {
    console.log(`    Connecting as the "${SUPERUSER}" superuser to create them.`);
    console.log('    This is the password you chose when installing PostgreSQL.');
    password = await askPassword(`    Password for ${SUPERUSER}: `);
  }

  const admin = new pg.Client({
    host: DB_HOST,
    port: DB_PORT,
    user: SUPERUSER,
    password,
    database: 'postgres',
    connectionTimeoutMillis: 8000,
  });

  try {
    await admin.connect();
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(
        `Nothing is listening on ${DB_HOST}:${DB_PORT}. Start the PostgreSQL service and try again.`,
      );
    }
    if (err.code === '28P01' || err.code === '28000') {
      throw new Error(`PostgreSQL refused the password for "${SUPERUSER}".`);
    }
    throw err;
  }

  // Identifiers cannot be parameterised, so they are quoted; the password can
  // be, and is, because it is the value most likely to contain punctuation.
  const ident = (name) => '"' + String(name).replace(/"/g, '""') + '"';

  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [DB_USER]);
    if (rows.length) {
      // The role exists but the application could not log in, so its password
      // does not match DATABASE_URL. Bring it into line rather than leaving
      // the two disagreeing.
      await admin.query(
        `ALTER ROLE ${ident(DB_USER)} WITH LOGIN SUPERUSER PASSWORD ${admin.escapeLiteral(DB_PASS)}`,
      );
      console.log(`    role "${DB_USER}" already existed — password reset to match server/.env`);
    } else {
      await admin.query(
        `CREATE ROLE ${ident(DB_USER)} WITH LOGIN SUPERUSER PASSWORD ${admin.escapeLiteral(DB_PASS)}`,
      );
      console.log(`    role "${DB_USER}" created`);
    }

    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (db.rows.length) {
      console.log(`    database "${DB_NAME}" already existed`);
    } else {
      await admin.query(`CREATE DATABASE ${ident(DB_NAME)} OWNER ${ident(DB_USER)}`);
      console.log(`    database "${DB_NAME}" created`);
    }
  } finally {
    await admin.end();
  }

  if (!(await canConnect())) {
    throw new Error(
      'The role and database are there, but connecting with DATABASE_URL still fails. ' +
      'Check server/.env, and whether pg_hba.conf allows password logins from this host.',
    );
  }
  console.log('    verified');
}

main().catch((err) => {
  console.error('\n    ' + err.message);
  process.exit(1);
});
