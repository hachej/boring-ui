#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
artifact_dir="docs/issues/owner-runtime-identity-prefix/browser-proof/.artifacts"
rm -rf "$artifact_dir"
mkdir -p "$artifact_dir"
pnpm --filter @hachej/boring-workspace... --workspace-concurrency=4 run build
exec pnpm exec playwright test --config docs/issues/owner-runtime-identity-prefix/browser-proof/playwright.config.ts
