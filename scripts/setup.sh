#!/usr/bin/env bash
# One-shot setup: create the database, apply migrations, load the master
# catalog, and install both halves of the application.
set -euo pipefail

DB_NAME="${DB_NAME:-amberola}"
DB_USER="${DB_USER:-amberola}"
DB_PASS="${DB_PASS:-amberola}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "==> Checking for PostgreSQL"
command -v psql >/dev/null || { echo "psql not found. Install PostgreSQL 14 or newer."; exit 1; }

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "PostgreSQL is not accepting connections on $DB_HOST:$DB_PORT."
  echo "Start it first, e.g.  sudo service postgresql start"
  exit 1
fi

echo "==> Creating role and database if they are not already there"
# Run as the postgres superuser where we can; fall back to the current user.
run_admin() {
  if command -v sudo >/dev/null && id postgres >/dev/null 2>&1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null || true
  else
    psql -h "$DB_HOST" -p "$DB_PORT" -d postgres -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null || true
  fi
}
run_admin "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' SUPERUSER;"
run_admin "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

export DATABASE_URL="postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"
echo "==> Using $DATABASE_URL"

if [ ! -f server/.env ]; then
  printf 'DATABASE_URL=%s\nPORT=4310\nUPLOAD_DIR=./uploads\nMAX_UPLOAD_MB=25\n' "$DATABASE_URL" > server/.env
  echo "==> Wrote server/.env"
fi

echo "==> Installing dependencies"
(cd server && npm install --no-audit --no-fund)
(cd web && npm install --no-audit --no-fund)

echo "==> Applying migrations"
(cd server && npm run migrate)

echo "==> Loading the master catalog"
(cd server && npm run seed)

echo
echo "Done. Start the register with:"
echo "    npm start        (from the repository root)"
