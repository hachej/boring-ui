#!/usr/bin/env bash
# Proves the app still works: types, safe schema SQL, and a booting server.
set -uo pipefail
cd "$(dirname "$0")"

fail() { echo "FAIL: $*" >&2; exit 1; }
step() { echo; echo "--- $* ---"; }

PM="pnpm"
command -v pnpm >/dev/null 2>&1 || PM="npm"

[ -d node_modules ] || fail "dependencies are not installed — run '$PM install'"

step "typecheck"
$PM run typecheck || fail "typecheck"

step "schema is additive"
SQL_DIR="$(mktemp -d)"
./node_modules/.bin/drizzle-kit generate --dialect sqlite --schema ./src/db/schema.ts \
  --name verify --out "$SQL_DIR" >/dev/null \
  || fail "db:generate-sql"
SQL="$(cat "$SQL_DIR"/*.sql 2>/dev/null || true)"
[ -n "$SQL" ] || fail "generated no SQL to inspect"
if printf '%s' "$SQL" | grep -inE '(^|[^_[:alnum:]])(DROP[[:space:]]+(TABLE|COLUMN|INDEX)|RENAME[[:space:]]+(TO|COLUMN)|ALTER[[:space:]]+TABLE[^;]*DROP)'; then
  fail "destructive schema statement — schema changes must be additive only"
fi
echo "ok: no DROP / RENAME in the generated schema SQL"

step "database"
$PM run db:push >/dev/null || fail "db:push"
echo "ok: schema applied to ${DATABASE_URL:-./data/app.sqlite}"

step "boot"
PORT="${VERIFY_PORT:-0}"
if [ "$PORT" = "0" ]; then
  PORT="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
fi
LOG="$(mktemp)"
PORT="$PORT" HOST=127.0.0.1 $PM run dev >"$LOG" 2>&1 &
DEV_PID=$!
cleanup() {
  if [ -n "${DEV_PID:-}" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
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

echo
echo "VERIFY OK"
