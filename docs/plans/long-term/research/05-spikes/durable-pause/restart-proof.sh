#!/usr/bin/env bash
set -euo pipefail

proof_dir="$(mktemp -d /tmp/durable-pause-proof.XXXXXX)"
db_path="$proof_dir/pause.sqlite"
request_path="$proof_dir/request.json"
result_path="$proof_dir/result.json"
stderr_path="$proof_dir/request.stderr"

node src/worker.mjs request "$db_path" >"$request_path" 2>"$stderr_path" &
requester_pid=$!

for _ in $(seq 1 500); do
  if [[ -s "$request_path" ]]; then break; fi
  if ! kill -0 "$requester_pid" 2>/dev/null; then
    wait "$requester_pid" || true
    sed -n '1,120p' "$stderr_path" >&2
    exit 1
  fi
  sleep 0.01
done

if [[ ! -s "$request_path" ]]; then
  echo "request worker did not publish its durable pause" >&2
  kill -9 "$requester_pid" 2>/dev/null || true
  exit 1
fi

kill -9 "$requester_pid"
wait "$requester_pid" 2>/dev/null || true
node src/worker.mjs answer-resume-file "$db_path" "$request_path" >"$result_path"

sed -n '1p' "$request_path"
sed -n '1p' "$result_path"
