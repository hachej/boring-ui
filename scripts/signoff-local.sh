#!/usr/bin/env bash
set -euo pipefail

if ! gh extension list | grep -q '^gh-signoff\b'; then
  echo "gh-signoff is not installed. Run: gh extension install basecamp/gh-signoff" >&2
  exit 1
fi

has_script() {
  node -e "const pkg=require('./package.json'); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)" "$1"
}

pnpm lint

if has_script typecheck:changed; then
  pnpm typecheck:changed
else
  pnpm typecheck
fi

if has_script test:changed; then
  pnpm test:changed
else
  pnpm test
fi

gh signoff local
