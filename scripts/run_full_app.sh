#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible positional config support:
#   scripts/run_full_app.sh app.full.toml --deploy-mode edge --edge-proxy-url http://127.0.0.1:8080
if [[ $# -gt 0 && "${1:-}" != -* ]]; then
  CONFIG="$1"
  shift
  set -- --config "$CONFIG" "$@"
fi

python3 scripts/run_full_app.py "$@"
