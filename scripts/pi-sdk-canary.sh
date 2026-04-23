#!/usr/bin/env bash
# pi-sdk-canary.sh — checks if a newer @mariozechner/pi-coding-agent
# exists and optionally runs the test suite against it.
#
# Usage:
#   ./scripts/pi-sdk-canary.sh           # check-only (exit 0 if up-to-date, 1 if new version)
#   ./scripts/pi-sdk-canary.sh --test    # install latest + run agent tests
#
# Upgrade protocol (manual):
#   1. Run: ./scripts/pi-sdk-canary.sh --test
#   2. If tests pass: update packages/agent/package.json AND root overrides
#   3. Open a dedicated PR with before/after test output
#   4. If tests fail: do NOT upgrade — open an issue instead
#
# This script does NOT auto-PR or auto-merge. It is a diagnostic tool.
set -euo pipefail

PREFIX="[pi-canary]"
PKG="@mariozechner/pi-coding-agent"
AGENT_DIR="packages/agent"

log() { echo "$PREFIX $*" >&2; }

PINNED="$(grep -oP "\"$PKG\"\\s*:\\s*\"\\K[^\"]+" "$AGENT_DIR/package.json" || true)"
if [[ -z "$PINNED" ]]; then
  log "ERR: $PKG not found in $AGENT_DIR/package.json"
  exit 2
fi

LATEST="$(npm info "$PKG" version 2>/dev/null || true)"
if [[ -z "$LATEST" ]]; then
  log "ERR: could not fetch latest version from npm"
  exit 2
fi

log "pinned:  $PINNED"
log "latest:  $LATEST"

if [[ "$PINNED" == "$LATEST" ]]; then
  log "OK — already on latest"
  exit 0
fi

log "NEW VERSION AVAILABLE: $PINNED → $LATEST"

if [[ "${1:-}" != "--test" ]]; then
  log "Run with --test to install and run test suite against $LATEST"
  exit 1
fi

log "Installing $PKG@$LATEST (temporary — not committed)"
pnpm --dir "$AGENT_DIR" add "$PKG@$LATEST" --save-exact 2>&1 | tail -3

log "Running agent test suite against $LATEST..."
if pnpm --dir "$AGENT_DIR" run test 2>&1; then
  log "PASS — all tests pass on $LATEST"
  log ""
  log "To upgrade permanently:"
  log "  1. Update $AGENT_DIR/package.json: \"$PKG\": \"$LATEST\""
  log "  2. Update root package.json pnpm.overrides: \"$PKG\": \"$LATEST\""
  log "  3. pnpm install"
  log "  4. Open a dedicated PR"
else
  log "FAIL — tests failed on $LATEST"
  log "Do NOT upgrade. Open an issue to track the incompatibility."
  log "Restoring pinned version..."
  pnpm --dir "$AGENT_DIR" add "$PKG@$PINNED" --save-exact 2>&1 | tail -3
  exit 1
fi
