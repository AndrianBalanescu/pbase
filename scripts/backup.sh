#!/usr/bin/env bash
# Snapshot the whole runtime state (SQLite DBs + uploads + settings) to a
# timestamped tar.gz under base/backups/.
#
#   ./scripts/backup.sh              # → base/backups/<dir>-YYYYmmdd-HHMMSS.tar.gz
#   ./scripts/backup.sh /tmp/pb.tgz  # custom destination
#   PB_DIR=/srv/app/data ./scripts/backup.sh   # back up a non-default data dir
#
# WHY THIS IS STAGED: a plain `tar pb_data` while the server is writing can copy
# data.db and data.db-wal at different instants and produce a torn (corrupt)
# snapshot — WAL keeps concurrent READERS consistent, it does not make a
# multi-file copy atomic. So each *.db is snapshotted through SQLite's online
# backup API (consistent point-in-time image), then everything is tarred
# together. Falls back to a raw copy if sqlite3 is unavailable.
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="$(pwd)/base"

# Honour PB_DIR like the other entrypoints (bootstrap/dev/serve) so a custom data
# dir is backed up, not silently the default one.
source "$BASE/../scripts/lib/env.sh"
_load_env_defaults .env
DIR="${PB_DIR:-$BASE/pb_data}"
NAME="$(basename "$DIR")"

if [[ ! -d "$DIR" ]]; then
  echo "No ${DIR}/ to back up — nothing to do." >&2
  exit 0
fi

DEST="${1:-base/backups/${NAME}-$(date +%Y%m%d-%H%M%S).tar.gz}"
mkdir -p "$(dirname "$DEST")"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME"

echo "→ Snapshotting ${DIR}/ → ${DEST}"

have_sqlite=0
command -v sqlite3 >/dev/null 2>&1 && have_sqlite=1

# Copy everything except the DB files and their WAL/SHM sidecars first.
# (--exclude is GNU tar; macOS bsdtar lacks it, so filter explicitly.)
( cd "$DIR" && find . -type f ! -name '*.db' ! -name '*.db-wal' ! -name '*.db-shm' -print0 ) |
  ( cd "$DIR" && while IFS= read -r -d '' f; do
      mkdir -p "$STAGE/$NAME/$(dirname "$f")"
      cp -p "$f" "$STAGE/$NAME/$f"
    done )

# Consistent image of each database.
for db in "$DIR"/*.db; do
  [[ -e "$db" ]] || continue
  base="$(basename "$db")"
  if [[ "$have_sqlite" == 1 ]]; then
    sqlite3 "$db" ".backup '$STAGE/$NAME/$base'"
  else
    echo "   ! sqlite3 not found — copying $base without WAL checkpoint" >&2
    cp -p "$db" "$STAGE/$NAME/$base"
  fi
done

tar -czf "$DEST" -C "$STAGE" "$NAME"
echo "✓ $(du -h "$DEST" | cut -f1)  ${DEST}"
echo
echo "Restore:  rm -rf ${DIR} && tar -xzf ${DEST} -C $(dirname "$DIR")"
