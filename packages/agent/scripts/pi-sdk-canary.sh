#!/usr/bin/env bash
# Verify the exact coordinated @earendil-works/pi-* family against npm.
# Usage: pnpm run pi-sdk:canary [--test]
set -euo pipefail

PREFIX="[pi-canary]"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/../.." && pwd)"
PACKAGES=(coding-agent agent-core ai client protocol telemetry tui)

log() { echo "$PREFIX $*" >&2; }

PINNED="$(node -e '
  const pkg = require(process.argv[1]);
  const value = pkg.pnpm.overrides["@mariozechner/pi-coding-agent"];
  const match = /@(\d+\.\d+\.\d+)$/.exec(value);
  if (!match) process.exit(1);
  process.stdout.write(match[1]);
' "$ROOT_DIR/package.json")"

latest=""
for name in "${PACKAGES[@]}"; do
  version="$(npm info "@earendil-works/pi-$name" version 2>/dev/null || true)"
  if [[ -z "$version" ]]; then
    log "ERR: could not fetch @earendil-works/pi-$name from npm"
    exit 2
  fi
  log "@earendil-works/pi-$name latest: $version"
  if [[ -n "$latest" && "$version" != "$latest" ]]; then
    log "ERR: latest published Pi family is not coordinated ($latest vs $version)"
    exit 2
  fi
  latest="$version"
done

log "coordinated pin: $PINNED"
if [[ "$PINNED" != "$latest" ]]; then
  log "NEW COORDINATED VERSION AVAILABLE: $PINNED -> $latest"
  log "Upgrade every root override and direct dependency exactly; never install one family member alone."
  exit 1
fi

log "OK — exact coordinated family is on npm latest"
if [[ "${1:-}" == "--test" ]]; then
  log "Running published-package contract and agent conformance suite"
  pnpm --dir "$AGENT_DIR" run test
fi
