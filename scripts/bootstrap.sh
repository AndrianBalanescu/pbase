#!/usr/bin/env bash
# One-shot bootstrap for a fresh checkout → running, seeded app.
#
#   ./scripts/bootstrap.sh
#
# Idempotent: safe to re-run. It will:
#   1. install the pinned PocketBase binary if missing
#   2. create ./pb_data (SQLite DB) via a no-op migrate
#   3. apply migrations
#   4. create the dev superuser (email must contain a dot — see .env.example)
#   5. print next steps
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="$(pwd)/base"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "→ created .env from template"
  else
    echo "→ no .env/.env.example found; using built-in defaults" >&2
  fi
fi

# Load .env as DEFAULTS: an already-set environment variable wins (so CI/systemd/Docker
# can inject secrets without a checked-out .env silently overriding them). Plain KEY=VALUE
# parsing — enough for this template's format, and it never executes the file.
source "$BASE/../scripts/lib/env.sh"
_load_env_defaults .env

if [[ ! -x "$BASE/pocketbase" ]]; then
  ./scripts/install-pocketbase.sh
fi

DIR="${PB_DIR:-$BASE/pb_data}"

echo "→ Applying migrations"
# Pin --migrationsDir: otherwise PocketBase resolves it relative to the PARENT of
# --dir and a PB_DIR outside the repo silently applies nothing.
./base/pocketbase --automigrate=false migrate up --dir="$DIR" --migrationsDir="$BASE/pb_migrations"

source "$(pwd)/scripts/lib/ensure-superuser.sh"
ensure_superuser "$DIR"

EMAIL="${PB_SUPERUSER_EMAIL:-admin@local.local}"
HTTP="${PB_HTTP:-127.0.0.1:8090}"

cat <<EOF

✓ Bootstrap complete.

  Start dev server : ./scripts/dev.sh
  Admin UI         : http://${HTTP}/_/   (${EMAIL})
  API docs (Scalar): http://${HTTP}/docs/
  Agent guide      : AGENTS.md   ·   llms.txt
EOF
