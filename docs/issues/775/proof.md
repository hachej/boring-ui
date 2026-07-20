# #775 proof of work — lean native Pi sessions

## Delivered seam

- Direct/local hosts must explicitly opt in with
  `trustedDirectLocalNativeSessions`. Without that trust flag, the native-first
  route is absent and bare Pi transcripts are not exposed.
- A browser-created chat is explicitly `ephemeral` and remains browser-only
  before Send. Its first prompt uses one idempotency key, creates Pi's native
  timestamped JSONL transcript, and adopts that native ID.
- First-send receipts survive response reconciliation, view disposal, rapid
  follow-ups, and deletion during deferred adoption without creating or
  orphaning another transcript.
- Native rename appends Pi `session_info`, requires an assistant reply, and
  preserves message-time ordering.
- The compact session row keeps Pin/Open controls and provides Copy ID,
  assistant-gated Rename, and Delete through the ellipsis menu.

## Automated verification

Integrated and revalidated on current `origin/main` (`7669483c1`).

```text
@hachej/boring-agent
  build: passed
  typecheck: passed
  test: 172 files passed, 3 skipped
        1,738 tests passed, 6 skipped

@hachej/boring-workspace
  build: passed
  typecheck: passed
  test: 130 files passed, 3 skipped
        1,736 tests passed, 10 skipped

scripts/check-invariants.sh packages/agent: passed
git diff --check origin/main...HEAD: passed
```

An initial parallel full-suite run hit test timeouts under host load. Sequential
full-package reruns passed with the counts above.

## Structured independent review

The exact branch Auto Review helper was rerun after current-main integration
and the final reset/unmount transaction lifecycle fixes:

```text
output: /tmp/775-pr811-autoreview-final7.txt
json:   /tmp/775-pr811-autoreview-final7.json
result: clean — no accepted/actionable findings
confidence: 0.91
```

## Native Pi interoperability proof

A real direct-mode workspace playground server created and completed one native
session from the native-first-prompt endpoint.

```text
Native ID:
  019f7fe5-88e1-7edf-a8ea-cb0a0b085d16

Native JSONL:
  ~/.pi/agent/sessions/--home-ubuntu-projects-boring-ui-v2-775-lean-apps-workspace-playground-workspace--/
  2026-07-20T14-19-37-055Z_019f7fe5-88e1-7edf-a8ea-cb0a0b085d16.jsonl

Initial title:
  lean-775-proof-24896: Reply exactly READY

Assistant reply:
  READY

Renamed title:
  Lean 775 native proof renamed
```

Verified:

- The Boring list ID, `nativeSessionId`, JSONL filename ID, and JSONL header ID
  are identical.
- Exactly one JSONL exists for that native ID.
- The transcript contains native user and assistant message records followed by
  native `session_info`; it contains no `pi_session_file` wrapper.
- After rename, `updatedAt` remained the latest valid message timestamp:
  `2026-07-20T14:19:44.071Z`.
- Standalone Pi export succeeded both before and after rename:
  - `/tmp/775-lean-native-session.html` — 269,790 bytes
  - `/tmp/775-lean-native-session-renamed.html` — 269,978 bytes

The proof server log is `/tmp/775-lean-server.log`; redacted receipt/list/rename
artifacts are under `/tmp/775-lean-*.json`.

## Review size

```text
52 files, +4,607 / -201
production/docs: 35 files, +1,917 / -192
tests:           17 files, +2,690 / -9
```

This is substantially smaller than PR #811's superseded implementation while
retaining the native identity, first-send, rename, ordering, and compact-menu
acceptance surface. Legacy wrapper migration, credential rotation, generic
attachment recovery, hosted durability, task bindings, and broad activity
frameworks are not included.
