#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
APP_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
# src/server/main.ts pins the config to <appRoot>/boring.app.toml, so the
# google_oauth feature flag the signup spec exercises has to be written there.
# (loadConfig reads features.google_oauth from TOML only — there is no env
# fallback the way there is for github_oauth, and no config-path env var.)
# The app's own TOML is a tracked file, so back it up and restore it on exit.
CONFIG_PATH="$APP_DIR/boring.app.toml"
CONFIG_BACKUP=$(mktemp)
CONFIG_EXISTED=0
# Boot from a directory that is not the app root: production hosts do exactly
# this, and it is what caught the plugin-package resolution bug where
# defaultPluginPackages were resolved against process.cwd() only.
RUN_DIR=$(mktemp -d)

if [ -f "$CONFIG_PATH" ]; then
  CONFIG_EXISTED=1
  cp "$CONFIG_PATH" "$CONFIG_BACKUP"
fi

cleanup() {
  if [ "$CONFIG_EXISTED" -eq 1 ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_PATH"
  else
    rm -f "$CONFIG_PATH"
  fi
  rm -f "$CONFIG_BACKUP"
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

printf '\n[features]\ngoogle_oauth = true\n' >> "$CONFIG_PATH"

cd "$APP_DIR"
pnpm --filter @hachej/boring-core exec tsup --no-dts
pnpm --filter @hachej/boring-core exec sh -c "cp src/front/theme.css dist/front/theme.css"
pnpm migrate
pnpm build
cd "$RUN_DIR"
exec env NODE_ENV=production node "$APP_DIR/dist/server/main.js"
