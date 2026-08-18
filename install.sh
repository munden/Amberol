#!/usr/bin/env bash
#
# Installs the Amberola Cylinder Register on a fresh macOS or Linux machine.
#
# Installs Node.js and PostgreSQL if they are missing, starts the database,
# creates the role and database, loads the master catalog, and tells you how
# to start it. Every step checks before it acts, so running it twice is safe.
#
#   ./install.sh              # install, then stop
#   ./install.sh --start      # install, then run it
#
# On Windows use install.ps1 instead.

set -Eeuo pipefail

REPO_URL='https://github.com/munden/Amberol.git'
REPO_BRANCH='claude/amberola-cylinder-database-n4w5c4'
NODE_MIN_MAJOR=20
DB_NAME='amberola'
DB_USER='amberola'
DB_PASS="${AMBEROLA_DB_PASSWORD:-amberola}"
DB_PORT=5432
START_AFTER=0

for arg in "$@"; do
  case "$arg" in
    --start) START_AFTER=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step_number=0
step()  { step_number=$((step_number + 1)); printf '\n\033[36m==> [%d] %s\033[0m\n' "$step_number" "$1"; }
ok()    { printf '\033[32m    %s\033[0m\n' "$1"; }
info()  { printf '\033[90m    %s\033[0m\n' "$1"; }
warn()  { printf '\033[33m    %s\033[0m\n' "$1"; }

# Every failure goes through here, so none of them is a bare shell error.
die() {
  printf '\n\033[31m%s\033[0m\n' "----------------------------------------------------------------------"
  printf '\033[31mINSTALL STOPPED\033[0m\n\n'
  printf '\033[31m%s\033[0m\n' "$1"
  if [ $# -gt 1 ]; then printf '\n%s\n' "$2"; fi
  printf '\033[31m%s\033[0m\n' "----------------------------------------------------------------------"
  exit 1
}

trap 'die "Unexpected failure on line $LINENO." "Re-running is safe — every step checks before it acts."' ERR

have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM=mac ;;
  Linux)  PLATFORM=linux ;;
  *) die "Unsupported system: $OS" "This script handles macOS and Linux. On Windows use install.ps1." ;;
esac

# Package manager, and how to become root where that is needed.
if [ "$PLATFORM" = mac ]; then
  PKG=brew
elif have apt-get; then
  PKG=apt
elif have dnf; then
  PKG=dnf
elif have pacman; then
  PKG=pacman
else
  PKG=unknown
fi

SUDO=''
if [ "$(id -u)" -ne 0 ] && [ "$PLATFORM" = linux ]; then
  if have sudo; then SUDO='sudo'; else
    die "Installing packages needs root, and sudo is not available." "Run this script as root."
  fi
fi

install_packages() {
  case "$PKG" in
    brew)   brew install "$@" ;;
    apt)    $SUDO apt-get update -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf)    $SUDO dnf install -y "$@" ;;
    pacman) $SUDO pacman -Sy --noconfirm "$@" ;;
    *) return 1 ;;
  esac
}

# ------------------------------------------------------------------ the steps

step 'Checking the system'
ok "$OS, package manager: $PKG"
if [ "$PLATFORM" = mac ] && ! have brew; then
  die "Homebrew is not installed." \
      "Install it from https://brew.sh , then run this script again."
fi

step 'Git'
if have git; then
  ok 'already installed'
else
  info 'installing'
  install_packages git || die "Could not install git." "Install it yourself, then re-run."
  ok 'installed'
fi

step 'Node.js'
node_ok=0
if have node; then
  node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$node_major" -ge "$NODE_MIN_MAJOR" ] 2>/dev/null; then
    ok "already installed ($(node --version))"
    node_ok=1
  else
    warn "found $(node --version), but $NODE_MIN_MAJOR or newer is required"
  fi
fi
if [ "$node_ok" -eq 0 ]; then
  info 'installing Node.js'
  case "$PKG" in
    brew)   install_packages node ;;
    apt)    install_packages nodejs npm ;;
    dnf)    install_packages nodejs npm ;;
    pacman) install_packages nodejs npm ;;
    *) die "No known package manager to install Node.js with." "Install Node $NODE_MIN_MAJOR+ from https://nodejs.org/ and re-run." ;;
  esac
  have node || die "Node.js still is not available." "Install it from https://nodejs.org/ and re-run."
  node_major="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$node_major" -lt "$NODE_MIN_MAJOR" ]; then
    die "Your package manager installed Node $(node --version), older than $NODE_MIN_MAJOR." \
        "Install a current Node from https://nodejs.org/ or use nvm, then re-run."
  fi
  ok "installed ($(node --version))"
fi

step 'PostgreSQL'
if have psql || have pg_ctl || [ -d /usr/lib/postgresql ] || brew list postgresql@16 >/dev/null 2>&1; then
  ok 'already installed'
else
  info 'installing — this takes a few minutes'
  case "$PKG" in
    brew)   install_packages postgresql@16 ;;
    apt)    install_packages postgresql postgresql-contrib ;;
    dnf)    install_packages postgresql-server postgresql-contrib ;;
    pacman) install_packages postgresql ;;
    *) die "No known package manager to install PostgreSQL with." \
           "Install PostgreSQL 14+ yourself, then run this script again." ;;
  esac
  ok 'installed'
fi

step 'Starting PostgreSQL'
case "$PLATFORM" in
  mac)
    brew services start postgresql@16 >/dev/null 2>&1 || brew services start postgresql >/dev/null 2>&1 || true
    ;;
  linux)
    if have systemctl; then
      $SUDO systemctl enable --now postgresql >/dev/null 2>&1 || $SUDO service postgresql start >/dev/null 2>&1 || true
    else
      $SUDO service postgresql start >/dev/null 2>&1 || true
    fi
    ;;
esac

# Running is not the same as accepting connections.
listening=0
for _ in $(seq 1 30); do
  if (exec 3<>/dev/tcp/127.0.0.1/$DB_PORT) 2>/dev/null; then listening=1; exec 3<&- 3>&-; break; fi
  sleep 2
done
[ "$listening" -eq 1 ] || die "Nothing is accepting connections on port $DB_PORT." \
                              "Start PostgreSQL yourself and run this script again."
ok "accepting connections on port $DB_PORT"

step 'Creating the role and database'
# The local superuser differs by platform: a Homebrew install makes the current
# user a superuser, distribution packages create a "postgres" account, and how
# you become that account depends on whether you are already root. SQL goes in
# on stdin so it survives every one of those wrappers without re-quoting.
run_super_sql() {
  if [ "$PLATFORM" = mac ]; then
    psql -v ON_ERROR_STOP=1 -d postgres "$@"
  elif [ "$(id -u)" -eq 0 ]; then
    su postgres -s /bin/sh -c "psql -v ON_ERROR_STOP=1 -d postgres $*"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres "$@"
  fi
}

if PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'select 1' >/dev/null 2>&1; then
  ok 'already present'
else
  # Create the role, or bring an existing one's password back into line with
  # what the application will connect with — the state a half-finished setup
  # leaves behind, and one CREATE alone would not repair.
  if ! printf '%s\n' "DO \$\$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
          ALTER ROLE $DB_USER WITH LOGIN SUPERUSER PASSWORD '$DB_PASS';
        ELSE
          CREATE ROLE $DB_USER WITH LOGIN SUPERUSER PASSWORD '$DB_PASS';
        END IF;
      END \$\$;" | run_super_sql >/dev/null 2>&1; then
    die "Could not create the role \"$DB_USER\"." \
        "Create it as the postgres superuser, then run this script again."
  fi

  if ! printf '%s\n' "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | run_super_sql -tA | grep -q 1; then
    printf '%s\n' "CREATE DATABASE $DB_NAME OWNER $DB_USER" | run_super_sql >/dev/null 2>&1 \
      || die "Could not create the database \"$DB_NAME\"." "Create it yourself, then re-run."
  fi
  ok 'created'
fi

step 'The register itself'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/server/src/index.js" ]; then
  REPO="$SCRIPT_DIR"
  ok "found at $REPO"
else
  REPO="$HOME/Amberol"
  if [ -f "$REPO/server/src/index.js" ]; then
    ok "found at $REPO"
  else
    [ -e "$REPO" ] && die "$REPO exists and is not a checkout of the register." "Move it aside and re-run."
    info "cloning into $REPO"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$REPO" \
      || die "Could not clone the repository." "Check your network and that you can reach GitHub."
    ok "cloned"
  fi
fi

step 'Installing and loading the catalog'
export DATABASE_URL="postgres://$DB_USER:$DB_PASS@127.0.0.1:$DB_PORT/$DB_NAME"
( cd "$REPO" && npm run setup ) \
  || die "Setting up the register failed." \
         "Read the output above. Running 'npm run doctor' in $REPO re-checks each part in turn."
ok 'installed, migrated and seeded'

step 'Checking it over'
( cd "$REPO" && npm run doctor ) \
  || die "The installation is not complete — see the check above." \
         "Fix what it names, then run 'npm run doctor' again in $REPO."

trap - ERR

printf '\n\033[32m%s\033[0m\n' "----------------------------------------------------------------------"
printf '\033[32mREADY\033[0m\n\n'
printf '  The register is installed at %s\n\n' "$REPO"
printf '  Start it any time with:\n'
printf '      cd %s\n' "$REPO"
printf '      npm start\n\n'
printf '  Then open http://localhost:4310\n\n'
printf '  If anything goes wrong later:  npm run doctor\n'
printf '\033[32m%s\033[0m\n' "----------------------------------------------------------------------"

if [ "$START_AFTER" -eq 1 ]; then
  step 'Starting the register'
  info 'Ctrl+C stops it.'
  cd "$REPO" && exec npm start
fi
