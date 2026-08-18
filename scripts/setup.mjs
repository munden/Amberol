#!/usr/bin/env node
/**
 * Cross-platform setup: installs dependencies, creates the database, applies
 * the migrations and loads the master catalog.
 *
 * Runs on Windows, macOS and Linux. It shells out only to `npm` and `node`,
 * never to a shell script and never to `psql` — the role and database are
 * created through the server's own PostgreSQL driver, because the Windows
 * installer routinely leaves psql off PATH.
 *
 *   npm run setup
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

/**
 * Creates the role and database.
 *
 * This runs through the server's own PostgreSQL driver rather than the psql
 * command line, because the Windows installer routinely leaves psql off PATH
 * — which used to stop setup dead even when the server was running perfectly
 * well. The terminal stays attached so it can prompt for the superuser
 * password.
 */
function createDatabase() {
  const result = run('node', ['src/scripts/create-db.mjs'], {
    cwd: path.join(root, 'server'),
    env: { DATABASE_URL },
  });

  if (result.ok) return true;

  console.log(
    '\n    Could not create the database automatically.\n\n' +
      '    Open pgAdmin (installed alongside PostgreSQL) or a psql prompt as the\n' +
      '    postgres superuser, and run:\n\n' +
      `      CREATE ROLE ${DB_USER} LOGIN SUPERUSER PASSWORD '${DB_PASS}';\n` +
      `      CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\n\n` +
      '    Then run `npm run setup` again.',
  );
  return false;
}

// --------------------------------------------------------------------- main

console.log('Setting up the Amberola Cylinder Register');

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

step('Creating the role and database');
const ready = createDatabase();

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
  console.log('See the note above.');
  console.log('-'.repeat(64));
  process.exit(1);
}
