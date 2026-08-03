---
github: https://github.com/hachej/boring-ui/issues/775
issue: 775
state: ready-for-review
updated: 2026-08-03
track: owner
---

# gh-775 Post-AgentHost session correctness port

## Problem

PR #968 proves a broad set of session correctness invariants, but it was built across legacy and addressed Agent transports. PR #1038 deliberately removes the legacy transport and makes `CreatedAgentHost` the sole production authority. The branches share base `1f1cb8264` but overlap in 69 files, including 29 content-conflict files and 11 modify/delete conflicts against files #1038 intentionally removes.

PR #1038 does not yet contain all of #968's behavior. Its addressed summary mapper still hardcodes `turnCount: 0`, workspace creation still permits a void/unknown result, turn-less boot resume is absent, new sessions use the old transcript shape, and several source/command/delete race fences are absent.

## Solution

Use PR #1038 as the architectural base and semantic-port only #968 invariants that remain valid in the addressed-only Host architecture. Keep PR #968 unchanged as the audited reference. Do not merge or cherry-pick its dual-wire history.

The follow-up is stacked on PR #1038 until #1038 merges, then retargets to `main`.

## Decisions

- `CreatedAgentHost`, addressed routes, mandatory `agentTypeId`, Host-issued authorization, Environment leases, durable ledger, strong admission, runtime pins, and direct composition remain authoritative.
- Do not restore `/api/v1/agent/*`, `createAgentApp`, `registerAgentRoutes`, `agentHostLegacyRoute*`, `legacyPiChatCompatibility`, optional/default Agent fallback, legacy principal repair, or compatibility-only live scope bridging.
- One canonical session is created durably before use and represented by the proper contract at each layer.
- New sessions are Pi-native from birth and first prompt opens the exact existing transcript.
- Ordinary history suppresses turn-less sessions; boot may resume only the exact tab-owned candidate after agent/workspace/storage/runtime verification.
- Explicit New, Quick, and split always mint.
- Workspace creation must return a canonical row; inference from list timing is forbidden.
- Catalog and execution must use the same addressed session and pinned binding.
- Deletion retires the live incarnation before awaiting a cold open.
- `includeEmpty` remains server-internal. Exact authority lookup is not a public enumeration feature.
- Native transcript access follows one post-cutover policy shared by inventory and live harness: unpinned native transcripts are reachable only from trusted path-derived local roots or through an explicit runtime-scope capability; hosted/namespaced stores require exact persisted pins. `authSubjectId` is attribution, not session ownership or live-cache identity, preserving #1038's workspace-shared collaboration model.
- Keep #1038's matrix-approved command wire exactly: catalog is `GET /api/v1/agents/:agentTypeId/commands?sessionId=...`; execution is `POST /api/v1/agents/:agentTypeId/commands/execute` with mandatory `requestId` and `sessionId`.
- The tab resume claim key includes API base, addressed route, agent, workspace, and storage scope. `resumeSessionId` participates in the create-effect digest: same-request/same-intent replays the ref, same request with different intent conflicts, and an invalid/foreign/runtime-mismatched candidate deterministically mints fresh.
- PRs #976 and #982 are already merged through Wave 1 into `main`, and are therefore ancestors of PR #1038. They are included by the base and must not be stacked or ported again.
- Every #968 production path and test family has an explicit disposition in [`port-ledger.md`](port-ledger.md); no slice closes with an unresolved ledger row.

## Flag / Abstraction

- Needed?: No feature flag. Dual session semantics would defeat the cutover.
- Path: additive correctness inside the canonical addressed Host and existing browser session interfaces.
- Rollback: drain/stop the post-follow-up writer before reverting. Revert preserves bytes and one-writer safety. Backward discovery of timestamp-native sessions by the immediate #1038 implementation must be proved before handoff; otherwise rollback is explicitly limited to restoring the prior application while retaining the follow-up reader until those sessions are exported/migrated. No automatic rewrite or wildcard migration is allowed.

## Test Seams

- Highest public seam: addressed `/api/v1/agents/:agentTypeId/sessions/*` through all #1038 composition roots.
- Existing prior art: PR #968 tests/browser proof and PR #1038 Gateway/composition/transcript matrices.
- Avoid testing: deleted legacy routes or implementation-private cache shape without a behavior assertion.

## Acceptance

### Identity and creation

- Addressed summaries preserve `agentTypeId`, real `turnCount`, `nativeSessionId`, and `hasAssistantReply`.
- Workspace create returns the canonical row or stable `SESSION_CREATE_PROTOCOL_ERROR`.
- StrictMode, repeated readiness, double-click, Quick chat, split, auto-submit, and replacement creation settle exactly once.
- Source changes, ownership changes, and unmounts cannot publish stale rows or actions.

### Persistence and resume

- Create writes exactly one `<timestamp>_<canonical-id>.jsonl` before returning.
- First prompt, state, events, command, rename, restart, and delete use that exact file.
- Missing/unreadable storage fails with a stable error and creates no replacement transcript.
- Ordinary lists hide `turnCount === 0`; internal authority can still load it.
- Same tab + exact API base/route/agent/workspace/storage/runtime pin resumes the empty session.
- Same create request and resume intent replay the same ref; a changed resume intent under that request ID conflicts.
- Another tab/agent/workspace/storage/runtime cannot adopt it; invalid, foreign, missing, or mismatched candidates deterministically mint fresh.
- Explicit New/Quick/split never carry resume intent.

### Runtime and commands

- Concurrent state/events/prompt/command cold opens produce one Pi handle and one channel.
- Delete during cold open disposes the late handle and leaves storage deleted.
- Command registry cleanup removes only names it owns.
- Captured stale handlers perform no POST.
- Command catalog and execution use #1038's exact matrix-approved routes, resolve the same workspace-authoritative `SessionCtx` and pinned binding, and retain #1038 ledger/admission behavior.
- Metering rejection occurs before ledger/admission. Same request and digest replay; pending ownership returns in-progress; a different digest conflicts.

### Contraction

- No deleted compatibility symbol, export, file, or `/api/v1/agent/*` route reappears.
- All seven #1038 composition roots expose each canonical route exactly once.

## Proof

- `pnpm install --frozen-lockfile`
- `pnpm check:agenthost-cutover-matrix`
- `pnpm test:agenthost-compositions`
- Agent, Workspace, Core, CLI, plugin-cli, affected plugin tests and typechecks.
- Full-app and workspace-playground addressed E2E.
- Alignment, golden-path, Agent invariants, and source-contraction checks.
- Browser proof: create, first prompt, second session, switching, Quick chat, rename, restart, transcript content, no fork, delete, and one deliberately failing assertion.
- Transcript proof across explicit `sessionDir`, namespace/root, CLI default, Core volume inference, `legacyDefault`, and rollback-byte fixtures.

## Slices

### Slice 1 — Addressed summary and canonical browser creation

**Delivers:** summary metadata, strict create return, source attestation, creation coordinator, operation ownership fences, and targeted regression tests.

**Blocked by:** PR #1038 architectural base.

**Proof:** Agent/Workspace focused tests and typechecks; source contraction scan.

### Slice 2 — Pi-native persistence and exact boot resume

**Delivers:** native transcript creation/exact reopen, turn-less suppression, tab-owned resume input, Gateway/inventory verification, runtime-pin and ledger integration.

**Blocked by:** Slice 1.

**Proof:** persistence/storage matrices, resume authorization matrix, restart proof.

### Slice 3 — Live runtime, commands, cold history, rename, and deletion

**Delivers:** handle/channel identity, delete generations, command registry/pinned binding semantics, persisted history mapping, verified rename, stable errors.

**Blocked by:** Slice 2.

**Proof:** race/concurrency tests, command tests, rename/cold-load tests, full package checks.

### Slice 4 — Session controls, full-system proof, and review

**Delivers:** capability-aware actions, pagination-safe pruning, fatal state, mobile target, scripted/browser proof, complete #1038 gates, adversarial review fixes.

**Blocked by:** Slice 3.

**Proof:** full CI-equivalent gates, addressed E2E, browser artifact, standards/spec/thermonuclear review.

## Out of Scope

- Restoring any deleted compatibility route or composition API.
- Transcript migration or rewriting historical bytes.
- Remote AgentHost transport.
- New session product behavior beyond the #968 correctness contract.
- Unrelated PR content not already present in PR #1038's ancestry.

## Confirmed Stack

- PR #1038 is the stacked base.
- PRs #976 and #982 are already ancestors through merged Wave 1 / PR #1008 and require no additional stack layer.
- PR #968 remains an immutable reference and will be superseded by this addressed-only follow-up after proof.
