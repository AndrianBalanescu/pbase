#!/usr/bin/env bash
# Install the pinned PocketBase binary for this repo.
# Version is read from base/pocketbase.version (single source of truth).
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(tr -d '[:space:]' < base/pocketbase.version)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="amd64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

ASSET="pocketbase_${VERSION}_${OS}_${ARCH}.zip"
URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/${ASSET}"

echo "→ Installing PocketBase v${VERSION} (${OS}/${ARCH})"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$URL" -o "$TMP/pb.zip"
unzip -oq "$TMP/pb.zip" -d "$TMP"
mkdir -p base && mv "$TMP/pocketbase" base/pocketbase
chmod +x base/pocketbase

echo "✓ Installed: $(base/pocketbase --version)"
