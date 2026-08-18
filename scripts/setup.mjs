#!/usr/bin/env node
/**
 * Cross-platform setup: installs dependencies, creates the database, applies
 * the migrations and loads the master catalog.
 *
 * Runs on Windows, macOS and Linux — it shells out only to `npm` and `psql`,
 * and never to a shell script.
 *
 *   npm run setup
 *
 * If the database cannot be created automatically (usually because the
 * PostgreSQL superuser needs a password), the script says exactly which two
 * SQL statements to run by hand and then carries on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const DB_NAME = process.env.DB_NAME || 'amberola';
const DB_USER = process.env.DB_USER || 'amberola';
const DB_PASS = process.env.DB_PASS || 'amberola';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '5432';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

// npm is a .cmd shim on Windows, which needs a shell to resolve.
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: options.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: isWindows,
    env: { ...process.env, ...options.env },
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    missing: result.error?.code === 'ENOENT',
  };
}

function step(message) {
  console.log(`\n==> ${message}`);
}

// ---------------------------------------------------------------- PostgreSQL

const PSQL_MISSING_HELP = isWindows
  ? 'psql is not on your PATH.\n\n' +
    '  If PostgreSQL is installed, add its bin folder to PATH — typically\n' +
    '      C:\\Program Files\\PostgreSQL\\17\\bin\n' +
    '  (adjust the version number), then open a NEW terminal so the change\n' +
    '  takes effect, and run `npm run setup` again.\n\n' +
    '  If it is not installed, get it from\n' +
    '      https://www.postgresql.org/download/windows/\n' +
    '  and note the superuser password you choose during installation.'
  : 'psql is not on your PATH.\n\n' +
    '  Install PostgreSQL 14 or newer and make sure psql is on your PATH,\n' +
    '  then run `npm run setup` again.';

/**
 * Detects psql. A missing executable does not always surface as ENOENT: on
 * Windows the call goes through a shell, which reports "not recognized" with a
 * non-zero status instead. So a non-zero status counts as missing too.
 */
function checkPsql() {
  const probe = run('psql', ['--version'], { quiet: true });
  if (probe.missing || !probe.ok) {
    console.log('    not found');
    return false;
  }
  console.log('    ' + probe.stdout.trim());
  return true;
}

/** True when the application's own connection string already works. */
function canConnect() {
  return run('psql', [DATABASE_URL, '-tAc', 'select 1'], { quiet: true }).ok;
}

/**
 * Creates the role and database, if they are not already there.
 *
 * The creating psql runs with the terminal attached rather than captured, so
 * that it can prompt for the superuser password — on Windows the standard
 * installer always sets one, and a captured prompt would simply hang.
 */
function createDatabase() {
  if (canConnect()) {
    console.log('    already present');
    return true;
  }

  console.log('    Connecting as the "postgres" superuser to create them.');
  console.log('    If you are asked for a password, it is the one you chose when');
  console.log('    you installed PostgreSQL.\n');

  const asSuperuser = (sql) =>
    run('psql', ['-U', 'postgres', '-h', DB_HOST, '-p', DB_PORT, '-d', 'postgres', '-c', sql]);

  // Any of these may fail because that piece already exists, which is fine;
  // the connection check below is what actually decides whether this worked.
  asSuperuser(`CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}' SUPERUSER;`);
  // Run unconditionally, because the interesting failure is a role that
  // already exists with a different password — CREATE would just report
  // "already exists" and leave the credentials still mismatched.
  asSuperuser(`ALTER ROLE ${DB_USER} WITH LOGIN SUPERUSER PASSWORD '${DB_PASS}';`);
  asSuperuser(`CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};`);

  if (canConnect()) {
    console.log('\n    created');
    return true;
  }

  console.log(
    '\n    Could not create the database automatically. Run these by hand:\n\n' +
      '      psql -U postgres\n' +
      `      CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}' SUPERUSER;\n` +
      `      CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\n` +
      '      \\q\n\n' +
      '    Then run `npm run setup` again.',
  );
  return false;
}

// --------------------------------------------------------------------- main

console.log('Setting up the Amberola Cylinder Register');

step('Checking for PostgreSQL');
const havePsql = checkPsql();

step('Writing server/.env');
const envPath = path.join(root, 'server', '.env');
if (existsSync(envPath)) {
  console.log('    already present, left alone');
} else {
  writeFileSync(
    envPath,
    `DATABASE_URL=${DATABASE_URL}\nPORT=4310\nUPLOAD_DIR=./uploads\nMAX_UPLOAD_MB=25\n`,
  );
  console.log('    written');
}

// Dependencies come first, so that even if the database part needs manual help
// the application itself is installed and buildable.
step('Installing server dependencies');
if (!run(npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, 'server') }).ok) {
  console.error('\nInstalling the server dependencies failed. Fix that, then re-run setup.');
  process.exit(1);
}

step('Installing web dependencies');
if (!run(npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: path.join(root, 'web') }).ok) {
  console.error('\nInstalling the web dependencies failed. Fix that, then re-run setup.');
  process.exit(1);
}

let ready = havePsql;
if (havePsql) {
  step('Creating the role and database');
  ready = createDatabase();
}

if (ready) {
  step('Applying migrations');
  const migrated = run(npmCmd, ['run', 'migrate'], {
    cwd: path.join(root, 'server'),
    env: { DATABASE_URL },
  });
  if (!migrated.ok) {
    console.error('\nThe migrations did not apply. Check the connection details in server/.env.');
    process.exit(1);
  }

  step('Loading the master catalog');
  const seeded = run(npmCmd, ['run', 'seed'], {
    cwd: path.join(root, 'server'),
    env: { DATABASE_URL },
  });
  if (!seeded.ok) {
    console.error('\nThe catalog did not load.');
    process.exit(1);
  }

  console.log('\nDone. Start the register with:\n\n    npm start\n\nThen open http://localhost:4310');
} else {
  // Repeated at the end because the install output above is long enough to
  // scroll the reason off the screen.
  console.log('\n' + '-'.repeat(64));
  console.log('Dependencies are installed, but the database is not ready.\n');
  console.log(havePsql ? 'See the note above.' : PSQL_MISSING_HELP);
  console.log('-'.repeat(64));
  process.exit(1);
}
