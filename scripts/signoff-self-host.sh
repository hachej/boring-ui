#!/usr/bin/env bash
set -euo pipefail

if ! gh extension list | grep -q '^gh-signoff\b'; then
  echo "gh-signoff is not installed. Run: gh extension install basecamp/gh-signoff" >&2
  exit 1
fi

bash scripts/check-action-pins.sh .github/workflows

if [[ ! -f scripts/self-host/verify-deploy-manifest.test.mjs ]]; then
  echo "scripts/self-host/verify-deploy-manifest.test.mjs is missing; self-host signoff is only available on branches that include self-host deployment tooling." >&2
  exit 1
fi
node --test scripts/self-host/verify-deploy-manifest.test.mjs

gh signoff self-host
