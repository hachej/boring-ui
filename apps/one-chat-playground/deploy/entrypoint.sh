#!/bin/sh
set -eu

apps_root=${ONE_CHAT_APPS_ROOT:-/data/one-chat/apps}
legacy_workspace_root=${ONE_CHAT_WORKSPACE_ROOT:-/data/one-chat/workspaces/app}
template_root=${ONE_CHAT_TEMPLATE_ROOT:-/app/apps/one-chat-playground/template-app}
session_root=${BORING_AGENT_SESSION_ROOT:-/data/one-chat/sessions}
app_base=${ONE_CHAT_APP_BASE:-/app/{slug}/}
public_app_url=${ONE_CHAT_PUBLIC_APP_URL:-}

mkdir -p "$apps_root" "$legacy_workspace_root" "$session_root"
export ONE_CHAT_APPS_ROOT="$apps_root" ONE_CHAT_WORKSPACE_ROOT="$legacy_workspace_root"

# The deployment contract names the full browser URL explicitly. It should use
# a {slug} placeholder, for example https://host.example/app/{slug}/.
if [ -n "$public_app_url" ]; then
  ONE_CHAT_APP_URL=${ONE_CHAT_APP_URL:-$public_app_url}
  export ONE_CHAT_APP_URL
fi

case "$app_base" in
  /*'{slug}'*/) ;;
  *) echo "ONE_CHAT_APP_BASE must start and end with / and include {slug}" >&2; exit 1 ;;
esac
export ONE_CHAT_APP_BASE="$app_base"

# Preserve the legacy named-volume layout. On first multi-app boot the registry
# copies this app into ONE_CHAT_APPS_ROOT/default; later boots use apps.json.
if [ -z "$(find "$legacy_workspace_root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "[one-chat] seeding legacy default app from the image template"
  cp -a "$template_root"/. "$legacy_workspace_root"/
fi

# Caddy strips /app before proxying here. The bridge resolves the slug through
# apps.json and restores the per-app Vite base path.
exec node /app/apps/one-chat-playground/deploy/app-path-proxy.mjs "$@"
