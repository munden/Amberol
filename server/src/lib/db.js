import pg from 'pg';
import 'dotenv/config';

// Catalog numbers, years and counts all come back as JS numbers rather than
// strings; the values here are far inside the safe integer range.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export const connectionString =
  process.env.DATABASE_URL ||
  'postgres://amberola:amberola@127.0.0.1:5432/amberola';

export const pool = new pg.Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}

/**
 * Turns a database-level failure into something a person can act on.
 *
 * These are the states a new installation actually lands in, and each has a
 * different fix. Reporting them all as "something went wrong" sends people
 * looking for a bug in the application when the answer is one command.
 *
 * Returns null for anything that is not a setup problem, so ordinary query
 * errors keep their normal handling.
 */
export function describeDatabaseFault(err) {
  if (!err) return null;

  switch (err.code) {
    case '42P01': // undefined_table
      return {
        state: 'no_schema',
        message:
          'The database exists but has no tables yet. Run "npm run migrate" ' +
          'to create them, then "npm run seed" to load the master catalog.',
      };
    case '3D000': // invalid_catalog_name
      return {
        state: 'no_database',
        message:
          'That database does not exist. Run "npm run setup" to create it, ' +
          'or correct DATABASE_URL in server/.env.',
      };
    case '28P01': // invalid_password
    case '28000': // invalid_authorization_specification
      return {
        state: 'bad_credentials',
        message:
          'PostgreSQL refused those credentials. Check the user and password ' +
          'in DATABASE_URL in server/.env.',
      };
    case 'ECONNREFUSED':
      return {
        state: 'not_running',
        message:
          'Nothing is listening for PostgreSQL on that host and port. ' +
          (process.platform === 'win32'
            ? 'Start the service from an Administrator PowerShell: ' +
              'Start-Service -Name "postgresql*"  (list them first with ' +
              'Get-Service -Name "postgresql*").'
            : process.platform === 'darwin'
              ? 'Start it with "brew services start postgresql@16", or open Postgres.app.'
              : 'Start it with "sudo service postgresql start".'),
      };
    case 'ENOTFOUND':
      return {
        state: 'bad_host',
        message: 'That database host could not be resolved. Check DATABASE_URL in server/.env.',
      };
    default:
      return null;
  }
}
