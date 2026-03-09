#!/usr/bin/env bash
set -euo pipefail
#
# Create a GitHub App via the manifest flow.
#
# Usage:
#   ./scripts/github-app-create.sh \
#     --name "Boring UI" \
#     --homepage "https://github.com/boringdata/boring-ui" \
#     --callback "https://your-domain.com/api/v1/auth/github/callback" \
#     --vault-path "secret/agent/github-app-boring-ui"
#
# What it does:
#   1. Generates an HTML page that auto-POSTs the manifest to GitHub
#   2. Serves it on a local port for you to open in a browser
#   3. Waits for you to paste the code from the redirect URL
#   4. Exchanges the code for credentials via GitHub API
#   5. Stores credentials in Vault
#
# Requirements: gh (authenticated), vault, python3
#

# ── Defaults ──────────────────────────────────────────────────────────
APP_NAME=""
HOMEPAGE=""
CALLBACK_URL=""
VAULT_PATH=""
SERVE_PORT=8080
PERMISSIONS='{"contents":"write","metadata":"read"}'
ORG=""  # empty = personal account

# ── Parse args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)        APP_NAME="$2";     shift 2 ;;
    --homepage)    HOMEPAGE="$2";     shift 2 ;;
    --callback)    CALLBACK_URL="$2"; shift 2 ;;
    --vault-path)  VAULT_PATH="$2";   shift 2 ;;
    --port)        SERVE_PORT="$2";   shift 2 ;;
    --permissions) PERMISSIONS="$2";  shift 2 ;;
    --org)         ORG="$2";          shift 2 ;;
    -h|--help)
      sed -n '2,/^$/s/^# //p' "$0"
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────
missing=""
[[ -z "$APP_NAME" ]]     && missing="$missing --name"
[[ -z "$HOMEPAGE" ]]     && missing="$missing --homepage"
[[ -z "$CALLBACK_URL" ]] && missing="$missing --callback"
[[ -z "$VAULT_PATH" ]]   && missing="$missing --vault-path"

if [[ -n "$missing" ]]; then
  echo "Missing required args:$missing" >&2
  echo "Run with --help for usage." >&2
  exit 1
fi

# Check tools
for cmd in gh python3; do
  command -v "$cmd" &>/dev/null || { echo "Required: $cmd" >&2; exit 1; }
done

gh auth status &>/dev/null || { echo "Not logged in to gh. Run: gh auth login" >&2; exit 1; }

# ── Step 1: Generate HTML ────────────────────────────────────────────
FORM_ACTION="https://github.com/settings/apps/new"
[[ -n "$ORG" ]] && FORM_ACTION="https://github.com/organizations/${ORG}/settings/apps/new"

HTML_FILE=$(mktemp /tmp/github-app-create-XXXX.html)

python3 -c "
import json

manifest = {
    'name': $(python3 -c "import json; print(json.dumps('$APP_NAME'))"),
    'url': $(python3 -c "import json; print(json.dumps('$HOMEPAGE'))"),
    'description': 'Git sync integration for ' + $(python3 -c "import json; print(json.dumps('$APP_NAME'))"),
    'redirect_url': $(python3 -c "import json; print(json.dumps('$CALLBACK_URL'))"),
    'callback_urls': [$(python3 -c "import json; print(json.dumps('$CALLBACK_URL'))")],
    'public': False,
    'default_permissions': $PERMISSIONS,
    'default_events': [],
}

# Intentionally omit hook_attributes — GitHub requires hook_attributes.url
# whenever the object is present, even with active=false

manifest_str = json.dumps(manifest)
# Escape for JS string literal (handle backslashes and quotes)
js_safe = manifest_str.replace('\\\\', '\\\\\\\\').replace(\"'\", \"\\\\'\")

html = '''<!DOCTYPE html>
<html><body>
<h2>Create GitHub App: ''' + $(python3 -c "import json; print(json.dumps('$APP_NAME'))").strip('\"') + '''</h2>
<p>Click the button to create the app on GitHub.</p>
<form id=\"f\" action=\"$FORM_ACTION\" method=\"post\">
  <input type=\"hidden\" name=\"manifest\" id=\"m\">
  <button type=\"submit\" style=\"font-size:18px;padding:12px 28px;cursor:pointer\">
    Create GitHub App
  </button>
</form>
<pre style=\"background:#f4f4f4;padding:12px;margin-top:20px;font-size:12px\">''' + json.dumps(manifest, indent=2) + '''</pre>
<script>
document.getElementById(\"m\").value = ''' + \"'\" + js_safe + \"'\" + ''';
</script>
</body></html>'''

with open('$HTML_FILE', 'w') as f:
    f.write(html)
"

echo ""
echo "=== GitHub App Manifest Creator ==="
echo ""
echo "App:      $APP_NAME"
echo "Homepage: $HOMEPAGE"
echo "Callback: $CALLBACK_URL"
echo "Vault:    $VAULT_PATH"
echo ""

# ── Step 2: Serve the HTML ────────────────────────────────────────────
# Kill anything on our port
kill "$(lsof -ti:"$SERVE_PORT" 2>/dev/null)" 2>/dev/null || true
sleep 0.5

HTML_DIR=$(dirname "$HTML_FILE")
HTML_NAME=$(basename "$HTML_FILE")

python3 -m http.server "$SERVE_PORT" --directory "$HTML_DIR" --bind 0.0.0.0 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null; rm -f '$HTML_FILE'" EXIT
sleep 1

# Detect public IP
PUBLIC_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo "Open in your browser:"
echo ""
echo "  http://${PUBLIC_IP}:${SERVE_PORT}/${HTML_NAME}"
echo ""
echo "  (or http://localhost:${SERVE_PORT}/${HTML_NAME} if on same machine)"
echo ""
echo "After clicking 'Create GitHub App' on GitHub, you'll be redirected."
echo "Copy the 'code' parameter from the URL bar."
echo ""

# ── Step 3: Get the code ─────────────────────────────────────────────
read -rp "Paste the code here: " MANIFEST_CODE

if [[ -z "$MANIFEST_CODE" ]]; then
  echo "No code provided. Aborting." >&2
  exit 1
fi

# Strip any URL prefix if they pasted the whole URL
MANIFEST_CODE=$(echo "$MANIFEST_CODE" | grep -oP '(?<=code=)[^&]+' || echo "$MANIFEST_CODE")

echo ""
echo "Exchanging code for credentials..."

# ── Step 4: Exchange code ─────────────────────────────────────────────
CREDS_FILE=$(mktemp /tmp/github-app-creds-XXXX.json)
trap "kill $SERVER_PID 2>/dev/null; rm -f '$HTML_FILE' '$CREDS_FILE'" EXIT

gh api --method POST "/app-manifests/${MANIFEST_CODE}/conversions" > "$CREDS_FILE"

python3 -c "
import json
c = json.load(open('$CREDS_FILE'))
print()
print('=== App Created Successfully ===')
print()
print(f'  App ID:        {c[\"id\"]}')
print(f'  Slug:          {c[\"slug\"]}')
print(f'  Client ID:     {c[\"client_id\"]}')
print(f'  Client Secret: {c[\"client_secret\"][:8]}...')
print(f'  PEM Key:       {len(c[\"pem\"])} bytes')
print(f'  Webhook Secret:{c.get(\"webhook_secret\", \"(none)\")}')
print()
"

# ── Step 5: Store in Vault ────────────────────────────────────────────
echo "Storing credentials in Vault at: $VAULT_PATH"

APP_ID=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['id'])")
SLUG=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['slug'])")
CLIENT_ID=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['client_id'])")
CLIENT_SECRET=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['client_secret'])")
PEM=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['pem'])")
WEBHOOK_SECRET=$(python3 -c "import json; print(json.load(open('$CREDS_FILE')).get('webhook_secret',''))")

if command -v vault &>/dev/null && vault token lookup &>/dev/null 2>&1; then
  vault kv put "$VAULT_PATH" \
    app_id="$APP_ID" \
    slug="$SLUG" \
    client_id="$CLIENT_ID" \
    client_secret="$CLIENT_SECRET" \
    private_key="$PEM" \
    webhook_secret="$WEBHOOK_SECRET"
  echo "Stored in Vault."
else
  echo "WARNING: Vault not available. Saving to /tmp/github-app-creds-KEEP.json instead."
  echo "Move these credentials to Vault manually."
  cp "$CREDS_FILE" /tmp/github-app-creds-KEEP.json
fi

# ── Step 6: Verify ───────────────────────────────────────────────────
echo ""
echo "=== Verification ==="

JWT=$(python3 -c "
import jwt, time
pem = '''$PEM'''
now = int(time.time())
print(jwt.encode({'iat': now - 60, 'exp': now + 600, 'iss': '$APP_ID'}, pem, algorithm='RS256'))
" 2>/dev/null || echo "")

if [[ -n "$JWT" ]]; then
  echo ""
  curl -sf -H "Authorization: Bearer $JWT" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/app | python3 -c "
import json,sys
app = json.load(sys.stdin)
print(f'  Verified: {app[\"name\"]} (id={app[\"id\"]}, slug={app[\"slug\"]})')
print(f'  Install:  https://github.com/apps/{app[\"slug\"]}/installations/new')
" 2>/dev/null || echo "  (verification skipped — PyJWT not installed)"
else
  echo "  Install PyJWT to verify: pip install PyJWT"
  echo "  Install app at: https://github.com/apps/${SLUG}/installations/new"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Install the app on your repos: https://github.com/apps/${SLUG}/installations/new"
echo "  2. Set env vars in your backend (see docs/runbook-github-app-manifest.md)"
echo ""
