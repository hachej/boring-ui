#!/usr/bin/env bash
set -euo pipefail

if ! gh extension list | grep -q '^gh-signoff\b'; then
  echo "gh-signoff is not installed. Run: gh extension install basecamp/gh-signoff" >&2
  exit 1
fi

pnpm ci

gh signoff local full
