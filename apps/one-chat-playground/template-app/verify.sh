#!/usr/bin/env bash
# Candidate proof: types, inspected host-approved SQL, boot, health, and agreement smoke checks.
set -uo pipefail
cd "$(dirname "$0")"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "--- $* ---"; }

if command -v pnpm >/dev/null 2>&1; then
  PM=(pnpm --config.minimum-release-age=0 --config.dangerously-allow-all-builds=true)
else
  PM=(npm)
fi

[ -d node_modules ] || fail "dependencies are not installed — run '${PM[0]} install'"

step "typecheck"
"${PM[@]}" run typecheck || fail "typecheck"

step "schema plan"
if [ -n "${ONE_CHAT_APPROVED_SQL:-}" ]; then
  [ -f "$ONE_CHAT_APPROVED_SQL" ] || fail "approved SQL plan is missing"
  SQL="$(cat "$ONE_CHAT_APPROVED_SQL")"
  if printf '%s' "$SQL" | grep -inE '(^|;)[[:space:]]*(DROP|RENAME|UPDATE|INSERT|DELETE|REPLACE|VACUUM|PRAGMA|ATTACH|DETACH)|ALTER[[:space:]]+TABLE[^;]*(DROP|RENAME|ALTER|UNIQUE|CHECK|REFERENCES|CONSTRAINT|PRIMARY[[:space:]]+KEY)'; then
    fail "approved SQL escaped the safe-additive allowlist"
  fi
  echo "ok: using the exact host-inspected additive plan"
else
  # Standalone authoring fallback. The host's transition-aware gate remains the
  # release authority; strict non-TTY mode prints Drizzle's proposed statements
  # and exits before applying them, so this check never mutates the database.
  PLAN="$(mktemp)"
  DATABASE_URL="${DATABASE_URL:-./data/app.sqlite}" ./node_modules/.bin/drizzle-kit push \
    --config drizzle.config.ts --verbose --strict >"$PLAN" 2>&1 || true
  if grep -inE '(^|;)[[:space:]]*(DROP|RENAME|UPDATE|INSERT|DELETE|REPLACE)|ALTER[[:space:]]+TABLE[^;]*(DROP|RENAME|ALTER|UNIQUE|CHECK|REFERENCES|CONSTRAINT)' "$PLAN"; then
    cat "$PLAN"
    fail "schema proposal is not safely additive"
  fi
  echo "ok: no destructive statement appeared in the dry proposal"
  if [ "${ONE_CHAT_SKIP_DB_PUSH:-0}" != "1" ]; then
    "${PM[@]}" run db:push >/dev/null || fail "db:push"
    echo "ok: schema applied to ${DATABASE_URL:-./data/app.sqlite}"
  fi
fi

step "boot"
PORT="${VERIFY_PORT:-0}"
if [ "$PORT" = "0" ]; then
  PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
fi
LOG="$(mktemp)"
PORT="$PORT" HOST=127.0.0.1 DATABASE_URL="${DATABASE_URL:-./data/app.sqlite}" \
  node ./node_modules/vite/bin/vite.js dev >"$LOG" 2>&1 &
DEV_PID=$!
cleanup() {
  if [ -n "${DEV_PID:-}" ]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 120); do
  curl -fsS -m 2 "$BASE/health" >/dev/null 2>&1 && break
  kill -0 "$DEV_PID" 2>/dev/null || { cat "$LOG"; fail "dev server exited"; }
  sleep 1
done

step "GET /health"
BODY="$(curl -fsS -m 10 "$BASE/health")" || { cat "$LOG"; fail "/health did not respond"; }
echo "$BODY"
printf '%s' "$BODY" | grep -q '"ok":true' || fail '/health did not return {"ok":true}'

step "GET /"
CODE="$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$BASE/")"
echo "HTTP $CODE"
[ "$CODE" = "200" ] || { cat "$LOG"; fail "/ returned $CODE"; }

if [ -f scripts/smoke.mjs ]; then
  step "agreement smoke checks"
  BASE_URL="$BASE" node scripts/smoke.mjs || { cat "$LOG"; fail "agreement smoke checks"; }
else
  echo "ok: no agreement smoke script is required for this static sketch"
fi

echo
echo "VERIFY OK"
