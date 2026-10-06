#!/usr/bin/env bash
# Source this to load ./.env as DEFAULTS only.
#
#   source "$(dirname "$0")/lib/env.sh"
#
# Semantics: an already-set environment variable WINS over the same key in .env.
# This lets CI / systemd / Docker inject secrets without a checked-out .env
# silently overriding them (plain `source .env` would clobber them).
#
# Parses plain KEY=VALUE lines (enough for this template) and never executes the
# file. Values keep everything after the first `=`, so `KEY=a=b` is preserved.

# _load_env_defaults [path]  (default: ./.env)
_load_env_defaults() {
  local file="${1:-.env}" line key val
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"                                # strip CR (CRLF files)
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue     # skip blanks & comments
    key="${line%%=*}"
    val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"                # trim leading space
    key="${key%"${key##*[![:space:]]}"}"                # trim trailing space
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    [[ -n "${!key:-}" ]] || export "$key=$val"          # do not override preset env
  done < "$file"
}
