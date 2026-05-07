#!/usr/bin/env bash
set -euo pipefail

APP_DIR="apps/boring-macro-v2-full"
APP_NAME="boring-macro"
EXPECTED_HOST="https://boring-macro.fly.dev"

if ! ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "deploy-fly: must run inside the boring-ui-v2 git repo" >&2
  exit 1
fi
cd "$ROOT"

if [[ ! -f "$APP_DIR/fly.toml" || ! -f "$APP_DIR/Dockerfile" ]]; then
  echo "deploy-fly: missing $APP_DIR/fly.toml or Dockerfile" >&2
  exit 1
fi

FLY_BIN="${FLY_BIN:-}"
if [[ -z "$FLY_BIN" ]]; then
  if command -v flyctl >/dev/null 2>&1; then
    FLY_BIN="flyctl"
  elif command -v fly >/dev/null 2>&1; then
    FLY_BIN="fly"
  else
    echo "deploy-fly: flyctl not found. Install from https://fly.io/docs/flyctl/install/ or set FLY_BIN." >&2
    exit 1
  fi
fi

if [[ -z "${FLY_API_TOKEN:-}" ]]; then
  echo "deploy-fly: FLY_API_TOKEN is not set. Example:" >&2
  echo "  export FLY_API_TOKEN=\$(vault kv get -field=token secret/agent/flyio)" >&2
  exit 1
fi

echo "==> preflight: app package is @boring/macro-full and Fly app is $APP_NAME"
node -e 'const p=require("./apps/boring-macro-v2-full/package.json"); if (p.name !== "@boring/macro-full") throw new Error(`wrong package ${p.name}`);'
grep -q 'app = "boring-macro"' "$APP_DIR/fly.toml"
grep -q 'dockerfile = "Dockerfile"' "$APP_DIR/fly.toml"

echo "==> preflight: install lockfile must be current"
pnpm install --frozen-lockfile

echo "==> preflight: typecheck macro-full"
pnpm --filter @boring/macro-full run typecheck

echo "==> deploy: monorepo root context + explicit Dockerfile"
"$FLY_BIN" deploy . \
  --app "$APP_NAME" \
  --config "$APP_DIR/fly.toml" \
  --dockerfile Dockerfile \
  --remote-only

echo "==> smoke: $EXPECTED_HOST/health"
curl -fsS "$EXPECTED_HOST/health" >/dev/null

echo "==> smoke: workspace shell contains boring.macro assets"
html="$(curl -fsS "$EXPECTED_HOST/workspace/723e9daa-c55b-4d7b-9d9e-77b11fa929de")"
if [[ "$html" != *"boring.macro"* ]]; then
  echo "deploy-fly: workspace shell did not contain boring.macro title" >&2
  exit 1
fi

echo "deploy-fly: shipped $APP_NAME from $APP_DIR"
