# #775 proof of work — lean native Pi sessions

## Delivered seam

- Direct/local runtime modes are single-user host contexts and enable native
  Pi sessions by default. Remote/custom runtime modes keep the native-first
  route absent so the app host's bare Pi transcripts are never used as tenant data.
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

Integrated and revalidated on current `origin/main` (`86d38893a`).

```text
@hachej/boring-agent
  build: passed
  typecheck: passed
  test: 172 files passed, 3 skipped
        1,737 tests passed, 6 skipped

@hachej/boring-workspace
  build: passed
  typecheck: passed
  test: 130 files passed, 3 skipped
        1,738 tests passed, 10 skipped

scripts/check-invariants.sh packages/agent: passed
git diff --check origin/main...HEAD: passed
```

An initial parallel full-suite run hit test timeouts under host load. Sequential
full-package reruns passed with the counts above.

## Structured independent review

The exact branch Auto Review helper was rerun after the final native-adoption
view-identity fixes:

```text
output: /tmp/775-final-autoreview-f125.txt
json:   /tmp/775-final-autoreview-f125.json
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
57 files, +4,496 / -271
production/docs: 39 files, +1,968 / -255
tests:           18 files, +2,528 / -16
```

This is substantially smaller than PR #811's superseded implementation while
retaining the native identity, first-send, rename, ordering, and compact-menu
acceptance surface. Legacy wrapper migration, credential rotation, generic
attachment recovery, hosted durability, task bindings, and broad activity
frameworks are not included.

---

# #775 proof of work — host-owned native Pi session capability

Validated on 2026-07-25 from branch `integrate/775-pr811-final`, starting at
`8d1beacbf`.

## Delivered seam

- `createAgentApp` and `registerAgentRoutes` now fail closed: omitted or false
  `nativeSessionStartEnabled` disables native first-send in every runtime mode.
- Trusted first-party host compositions explicitly opt in. Generic workspace
  and core composition helpers only pass through an explicit true value.
- Runtime mode no longer decides whether native session start is available.
  The workspace playground therefore advertises the capability in
  remote-worker mode.
- The full app reuses its workspace namespace and adds a stable hash of a
  verified HTTP or trusted-dispatcher user identity. Missing identity returns
  `401 unauthorized`; there is no `anonymous` namespace fallback.
- Full-app isolation coverage writes one native transcript under user A and
  proves user B cannot list it or load its known native ID.

## Required proof commands

```text
pnpm --filter @hachej/boring-agent test
  blocked by the managed execution environment
  137 files passed, 3 skipped, 36 failed
  1,514 tests passed, 6 skipped, 223 failed
  Representative blockers:
    - loopback listen denied with EPERM
    - child-process spawning denied with EPERM
    - the default home session directory was unavailable
    - the installed React runtime and renderer patch versions differed

pnpm --filter @hachej/boring-agent typecheck
  blocked by pre-existing unchanged source
  TS2321 at src/bin/boring-agent.ts:90 while comparing the Vite plugin array
  The only issue change in this file is the host opt-in at the createAgentApp
  call; declaration generation in the package build passed.

pnpm --filter @hachej/boring-agent build
  passed
  ESM build, declaration build, CSS build, and build-artifacts assertion passed

pnpm --filter full-app test
  passed
  5 files, 46 tests

pnpm lint:invariants
  passed
  agent, boring-bash, boring-sandbox, and workspace plugin invariants passed
```

## Focused automated evidence

```text
Agent default/explicit capability and first-party host wiring:
  3 files, 102 tests passed; type errors: none

boring-mcp verified-user namespace binding:
  1 file, 11 tests passed

Workspace capability pass-through:
  1 file, 31 tests passed

Core capability pass-through:
  1 file, 6 tests passed

Full-app suite, including cross-user native-session isolation:
  5 files, 46 tests passed

git diff --check:
  passed
```

## Independent review

- Tier 1 fresh-eyes review: clean.
- Tier 2 maintainability review initially found an unsafe opt-in in generic core
  run/dev helpers and a weak source-wiring test. The generic opt-ins were
  removed, and the test now resolves from `import.meta.url`, anchors the
  workspace-playground composition, and asserts generic core helpers remain
  opted out.
- Tier 2 re-review after those corrections: clean.

## Manual proof status

The five manual scenarios were not run in this managed sandbox. It cannot bind
the required loopback servers and does not provide a deployed multi-user
full-app host, remote worker, or standalone Pi process. The automated isolation
test covers the same-directory cross-user list/load boundary; native
remote-worker adoption and standalone `pi /resume` remain deployment proof
items.

## Commit status

No commit could be created in this environment. Git staging failed because the
worktree metadata under the parent checkout is read-only:

```text
fatal: Unable to create .../index.lock: Read-only file system
```

The implementation and reports remain commit-ready in the working tree. The
pre-existing modification to `docs/issues/775/plan.md` was preserved and was
not included in the attempted staging scope.
