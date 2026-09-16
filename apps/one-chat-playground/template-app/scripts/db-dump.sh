#!/usr/bin/env bash
# Text backup of the whole database: schema + data, as SQL.
#   bash scripts/db-dump.sh [output-file]
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_URL:-./data/app.sqlite}"
OUT="${1:-./data/dump-$(date +%Y%m%d-%H%M%S).sql}"

if [ ! -f "$DB" ]; then
  echo "No database at $DB — run 'pnpm db:push' first." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" .dump > "$OUT"
else
  # No sqlite3 CLI: same dump through the driver the app already depends on.
  node scripts/db-dump.mjs "$DB" "$OUT"
fi

echo "Wrote $OUT"
