#!/usr/bin/env bash
set -euo pipefail

mode="${1:-gemini}"
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-host-storage.XXXXXX")"
record_path="$scratch_dir/host-records.jsonl"
default_root="$HOME/.pi/agent/sessions"
trap 'rm -rf -- "$scratch_dir"' EXIT

snapshot() {
  if [[ -d "$default_root" ]]; then
    find "$default_root" -type f -printf '%P|%s|%T@\n' | sort | sha256sum | cut -d' ' -f1
  else
    printf 'ABSENT'
  fi
}

before="$(snapshot)"
first="$(node src/turn-worker.js "$record_path" 1 "$mode")"
after_first="$(snapshot)"
second="$(node src/turn-worker.js "$record_path" 2 "$mode")"
after_second="$(snapshot)"

FIRST="$first" SECOND="$second" BEFORE="$before" AFTER_FIRST="$after_first" AFTER_SECOND="$after_second" \
  node --input-type=module <<'NODE'
const first = JSON.parse(process.env.FIRST);
const second = JSON.parse(process.env.SECOND);
if (first.pid === second.pid) throw new Error("workers did not cross a process boundary");
if (first.text.trim() !== "STORED ORCHID-7319") throw new Error(`turn 1 failed: ${process.env.FIRST}`);
if (second.text.trim() !== "ORCHID-7319") throw new Error(`turn 2 continuity failed: ${process.env.SECOND}`);
if (process.env.BEFORE !== process.env.AFTER_FIRST || process.env.BEFORE !== process.env.AFTER_SECOND) {
  throw new Error("pi default session directory changed");
}
console.log(JSON.stringify({
  first,
  second,
  processBoundaryProved: true,
  defaultSessionRoot: `${process.env.HOME}/.pi/agent/sessions`,
  defaultSessionSnapshotBefore: process.env.BEFORE,
  defaultSessionSnapshotAfterFirst: process.env.AFTER_FIRST,
  defaultSessionSnapshotAfterSecond: process.env.AFTER_SECOND,
  defaultSessionTreeUnchanged: true,
}, null, 2));
NODE

printf 'host_record_stream:\n'
sed -E 's/("message":\{"role":"(user|assistant)","content":)\[[^]]*\]/\1["<content elided in listing>"]/g' "$record_path"
