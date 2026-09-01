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

restore_config() {
  [ -f "$CONFIG_BACKUP" ] || return 0
  if [ "$CONFIG_EXISTED" -eq 1 ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_PATH"
  else
    rm -f "$CONFIG_PATH"
  fi
  rm -f "$CONFIG_BACKUP"
}

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  restore_config
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT INT TERM

# Appending a second [features] table would be invalid TOML and the server
# would refuse to boot, so refuse instead of corrupting a tracked file. This
# also catches a leftover block from a run that was killed before it could put
# the file back.
if [ -f "$CONFIG_PATH" ] && grep -q '^\[features\]' "$CONFIG_PATH"; then
  echo "google-auth-webserver: $CONFIG_PATH already defines [features]." >&2
  echo "  If this is leftover from an interrupted e2e run, restore the file" >&2
  echo "  (git checkout -- apps/full-app/boring.app.toml) and retry." >&2
  echo "  If the app genuinely needs a [features] table now, merge" >&2
  echo "  google_oauth = true into it here instead of appending." >&2
  exit 1
fi

cd "$APP_DIR"
pnpm --filter @hachej/boring-core exec tsup --no-dts
pnpm --filter @hachej/boring-core exec sh -c "cp src/front/theme.css dist/front/theme.css"
pnpm migrate
pnpm build
# Swap the config in only now that the (multi-minute) build is done, so the
# tracked file is modified for seconds rather than for the whole run.
printf '\n[features]\ngoogle_oauth = true\n' >> "$CONFIG_PATH"

cd "$RUN_DIR"
# Run the server as a child rather than exec'ing it, so the traps above still
# fire when Playwright tears the webServer down and the tracked TOML always
# goes back.
env NODE_ENV=production node "$APP_DIR/dist/server/main.js" &
SERVER_PID=$!

# loadConfig reads the TOML once during boot, so put the tracked file back the
# moment the server answers. That keeps the checkout clean even if this script
# is later killed with a signal it cannot trap.
(
  for _ in $(seq 1 300); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT:-3900}/api/v1/config"; then break; fi
    sleep 1
  done
  restore_config
) &

wait "$SERVER_PID"
