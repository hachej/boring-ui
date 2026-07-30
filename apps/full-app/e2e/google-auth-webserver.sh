#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
CONFIG_DIR=$(mktemp -d)
CONFIG_PATH="$CONFIG_DIR/boring.app.toml"

cleanup() {
  rm -rf "$CONFIG_DIR"
}
trap cleanup EXIT

printf '[features]\ngoogle_oauth = true\n' > "$CONFIG_PATH"

cd "$APP_DIR"
pnpm --filter @hachej/boring-core exec tsup --no-dts
pnpm --filter @hachej/boring-core exec sh -c "cp src/front/theme.css dist/front/theme.css"
pnpm migrate
pnpm build
cd "$CONFIG_DIR"
exec env NODE_ENV=production node "$APP_DIR/dist/server/main.js"
