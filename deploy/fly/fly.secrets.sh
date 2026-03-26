#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${1:-boring-ui}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUI_APP_TOML="${BUI_APP_TOML:-${REPO_ROOT}/boring.app.toml}"
FLY_BIN="${FLYCTL_BIN:-}"

if [[ -z "${FLY_BIN}" ]]; then
  if command -v flyctl >/dev/null 2>&1; then
    FLY_BIN="$(command -v flyctl)"
  elif command -v fly >/dev/null 2>&1; then
    FLY_BIN="$(command -v fly)"
  elif [[ -x "${HOME}/.fly/bin/flyctl" ]]; then
    FLY_BIN="${HOME}/.fly/bin/flyctl"
  elif [[ -x "${HOME}/.fly/bin/fly" ]]; then
    FLY_BIN="${HOME}/.fly/bin/fly"
  else
    echo "flyctl (or fly) is required on PATH or at ~/.fly/bin/{fly,flyctl}" >&2
    exit 1
  fi
fi

case "${FLY_BIN}" in
  "~/"*)
    FLY_BIN="${HOME}/${FLY_BIN:2}"
    ;;
  "\$HOME/"*)
    FLY_BIN="${HOME}/${FLY_BIN:6}"
    ;;
esac

if [[ ! -x "${FLY_BIN}" ]]; then
  if command -v "${FLY_BIN}" >/dev/null 2>&1; then
    FLY_BIN="$(command -v "${FLY_BIN}")"
  else
    echo "FLYCTL_BIN points to a non-executable or unknown path: ${FLY_BIN}" >&2
    exit 1
  fi
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

secret_value() {
  local env_name="$1"
  local vault_path="$2"
  local field="$3"
  local env_value="${!env_name:-}"
  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
    return 0
  fi
  require_cmd vault
  vault_field "$vault_path" "$field"
}

vault_field() {
  local path="$1"
  local field="$2"
  vault kv get -field="$field" "$path"
}

app_toml_value_or_env() {
  local env_name="$1"
  local dotted_key="$2"
  local env_value="${!env_name:-}"
  if [[ -n "$env_value" ]]; then
    printf '%s' "$env_value"
    return 0
  fi
  app_toml_value "$dotted_key"
}

app_toml_value() {
  local dotted_key="$1"
  python3 - "$BUI_APP_TOML" "$dotted_key" <<'PY'
from __future__ import annotations

import sys
import tomllib
from pathlib import Path

toml_path = Path(sys.argv[1])
key_path = sys.argv[2].split(".")

data = tomllib.loads(toml_path.read_text(encoding="utf-8"))
value = data
for key in key_path:
    value = value[key]
print(value)
PY
}

require_cmd python3

retry_fly_secrets_set() {
  local attempts="${1:-5}"
  shift
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if "$FLY_BIN" secrets set "$@"; then
      return 0
    fi
    if [[ "$attempt" -ge "$attempts" ]]; then
      return 1
    fi
    sleep 15
  done
}

declare -a pairs=()

pairs+=("DATABASE_URL=$(secret_value "DATABASE_URL" "secret/agent/app/boring-ui/prod" "database_url")")
pairs+=("BORING_UI_SESSION_SECRET=$(secret_value "BORING_UI_SESSION_SECRET" "secret/agent/app/boring-ui/prod" "session_secret")")
pairs+=("BORING_SETTINGS_KEY=$(secret_value "BORING_SETTINGS_KEY" "secret/agent/app/boring-ui/prod" "settings_key")")
pairs+=("ANTHROPIC_API_KEY=$(secret_value "ANTHROPIC_API_KEY" "secret/agent/anthropic" "api_key")")
pairs+=("RESEND_API_KEY=$(secret_value "RESEND_API_KEY" "secret/agent/services/resend" "api_key")")
pairs+=("NEON_AUTH_BASE_URL=$(app_toml_value_or_env "NEON_AUTH_BASE_URL" "deploy.neon.auth_url")")
pairs+=("NEON_AUTH_JWKS_URL=$(app_toml_value_or_env "NEON_AUTH_JWKS_URL" "deploy.neon.jwks_url")")
pairs+=("GITHUB_APP_ID=$(secret_value "GITHUB_APP_ID" "secret/agent/services/boring-ui-app" "app_id")")
pairs+=("GITHUB_APP_CLIENT_ID=$(secret_value "GITHUB_APP_CLIENT_ID" "secret/agent/services/boring-ui-app" "client_id")")
pairs+=("GITHUB_APP_CLIENT_SECRET=$(secret_value "GITHUB_APP_CLIENT_SECRET" "secret/agent/services/boring-ui-app" "client_secret")")
pairs+=("GITHUB_APP_PRIVATE_KEY=$(secret_value "GITHUB_APP_PRIVATE_KEY" "secret/agent/services/boring-ui-app" "pem")")
pairs+=("GITHUB_APP_SLUG=$(secret_value "GITHUB_APP_SLUG" "secret/agent/services/boring-ui-app" "slug")")

retry_fly_secrets_set 5 --app "$APP_NAME" "${pairs[@]}"
