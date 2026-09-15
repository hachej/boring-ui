#!/bin/sh
set -eu

workspace_root=${ONE_CHAT_WORKSPACE_ROOT:-/data/one-chat/workspaces/app}
template_root=${ONE_CHAT_TEMPLATE_ROOT:-/app/apps/one-chat-playground/template-app}
session_root=${BORING_AGENT_SESSION_ROOT:-/data/one-chat/sessions}
app_base=${ONE_CHAT_APP_BASE:-/app/}
public_app_url=${ONE_CHAT_PUBLIC_APP_URL:-}

mkdir -p "$workspace_root" "$session_root"

# The deployment contract names the full browser URL explicitly. Keep the
# shorter legacy name populated while the owner reviews the source-level env.
if [ -n "$public_app_url" ]; then
  ONE_CHAT_APP_URL=${ONE_CHAT_APP_URL:-$public_app_url}
  export ONE_CHAT_APP_URL
fi

# A named volume starts empty. Seed the editable app exactly once, including its
# installed dependencies and hidden Pi resources; later starts preserve edits.
if [ -z "$(find "$workspace_root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "[one-chat] seeding $workspace_root from the image template"
  cp -a "$template_root"/. "$workspace_root"/
fi

# The host starts the editable app with `pnpm exec vite`, so inject Vite's base
# through a narrow pnpm wrapper rather than modifying the user's vite.config.ts.
# A /app/ base makes generated assets and HMR stay below the public path.
if [ -n "$app_base" ]; then
  case "$app_base" in
    /*/) ;;
    *) echo "ONE_CHAT_APP_BASE must start and end with /" >&2; exit 1 ;;
  esac

  real_pnpm=$(command -v pnpm)
  wrapper_dir=${HOME:-/tmp}/.one-chat-bin
  mkdir -p "$wrapper_dir"
  cat > "$wrapper_dir/pnpm" <<EOF
#!/bin/sh
if [ "\${1:-}" = "exec" ] && [ "\${2:-}" = "vite" ]; then
  exec "$real_pnpm" "\$@" --base "\${ONE_CHAT_APP_BASE}"
fi
exec "$real_pnpm" "\$@"
EOF
  chmod 0755 "$wrapper_dir/pnpm"
  PATH="$wrapper_dir:$PATH"
  export PATH ONE_CHAT_APP_BASE="$app_base"
fi

# Caddy strips /app before proxying to port 5321. The bridge restores Vite's
# configured base on the internal request to SAMPLE_APP_PORT (5322 by default).
exec node /app/apps/one-chat-playground/deploy/app-path-proxy.mjs "$@"
