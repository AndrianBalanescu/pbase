#!/usr/bin/env bash
# Idempotent "there is a real superuser" guarantee, shared by bootstrap.sh and dev.sh.
#
#   source scripts/lib/ensure-superuser.sh
#   ensure_superuser "$PB_DIR"
#
# WHY THIS EXISTS
# PocketBase `serve` prints the "Create your first superuser" installer prompt --
# and skips nothing else -- whenever the --dir database has no real superuser. In
# that state the server seeds a throwaway `__pbinstaller@example.com` account so
# the install screen has something to log in with. The prompt is therefore not a
# bug in PocketBase: it simply means "this data dir has never been bootstrapped".
#
# So every entrypoint that starts the server calls ensure_superuser first: one
# upsert makes the account exist, the installer screen is gone, and every restart
# is silent and repeatable. Credentials come from the environment (loaded from
# .env as defaults by the caller); both defaults match .env.example.
#
# `superuser upsert` is create-or-update, so it is safe to run every boot. Note it
# re-applies the .env password on each start, so the dev admin always matches .env
# (no lockout if you change it in the UI). It also runs with `--automigrate=false`:
# the CLI write must never fabricate a snapshot migration of the collections.
ensure_superuser() {
  local dir="${1:-${PB_DIR:-pb_data}}"
  local email="${PB_SUPERUSER_EMAIL:-admin@local.local}"
  local password="${PB_SUPERUSER_PASSWORD:-supersecretdev}"
  local pb="${PB_BIN:-./base/pocketbase}"

  if [[ "$password" == "supersecretdev" ]]; then
    echo "⚠️  DEFAULT dev superuser password (supersecretdev) — set PB_SUPERUSER_PASSWORD in .env for anything non-local." >&2
  fi

  if "$pb" --automigrate=false --dir="$dir" superuser upsert "$email" "$password" >/dev/null; then
    echo "→ superuser ${email} ready  (${dir})"
  else
    echo "✗ could not create superuser ${email} in ${dir}" >&2
    return 1
  fi
}
