#!/usr/bin/env bash
# Start PocketBase in dev mode.
#
#   ./scripts/dev.sh                 # http://127.0.0.1:8090
#   ./scripts/dev.sh 8091            # custom port
#   PB_DIR=./pb_data PB_ENCRYPTION_KEY=... ./scripts/dev.sh
#
# Dev mode turns on SQL/request logging and live JS-hook reload (pb_hooks/*.pb.js).
#
# It also guarantees a superuser exists before serving (idempotent upsert from
# .env), so the "Create your first superuser" install screen never comes back on
# restart — see scripts/lib/ensure-superuser.sh for why that screen appears.
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="$(pwd)/base"

# Load .env if present (never committed) as DEFAULTS — a preset env var wins.
source "$BASE/../scripts/lib/env.sh"
_load_env_defaults .env

PORT="${1:-8090}"
# Precedence: positional port > PB_HTTP (shell env or .env) > 8090.
# .env from .env.example pins PB_HTTP, which used to silently win over the
# advertised `./scripts/dev.sh 8091` argument (set -u: ${1:-} not $1).
if [[ -n "${1:-}" ]]; then
  HTTP="127.0.0.1:${1}"
else
  HTTP="${PB_HTTP:-127.0.0.1:${PORT}}"
fi
DIR="${PB_DIR:-$BASE/pb_data}"

if [[ ! -x "$BASE/pocketbase" ]]; then
  echo "→ pocketbase binary missing, installing…"
  ./scripts/install-pocketbase.sh
fi

source "$(pwd)/scripts/lib/ensure-superuser.sh"
ensure_superuser "$DIR"

echo "→ PocketBase $(./base/pocketbase --version) on http://${HTTP}  (dir: ${DIR})"
echo "  admin UI : http://${HTTP}/_/"
echo "  api docs : http://${HTTP}/docs/"
echo

# Pin the migrations/hooks dirs relative to cwd. Without --migrationsDir,
# PocketBase resolves it relative to the PARENT of --dir, so a custom PB_DIR
# outside the repo would silently skip pb_migrations/ (no posts/comments) and
# pb_hooks/ (no custom routes -> /api/* and /openapi.json fall back to index.html).
ARGS=(--dev --http="${HTTP}" --dir="${DIR}" --migrationsDir="${BASE}/pb_migrations" --hooksDir="${BASE}/pb_hooks")
[[ -n "${PB_ENCRYPTION_KEY:-}" ]] && ARGS+=(--encryptionEnv=PB_ENCRYPTION_KEY)

exec ./base/pocketbase serve "${ARGS[@]}"
