---
github: https://github.com/hachej/boring-ui/issues/1060
issue: 1060
state: ready-for-agent
updated: 2026-08-04
track: owner
---

# gh-1060 addressed multi-Agent UI and remaining Wave 1 guarantees

## Problem

Post-#1038 AgentHost owns an addressed fleet, and PRs #1044/#1045 add canonical session correctness and addressed task/Human Intention links. The production UI still hardcodes the `default` Agent, while several valid Wave 1 operational guarantees remain absent. Merging PR #1027 would restore deleted compatibility architecture and is forbidden.

## Solution

Use PR #1027 only as an audited behavior reference. Build four reviewable stacked slices from PR #1045, preserving direct Host routes and exact addressed identity throughout.

## Decisions

1. `CreatedAgentHost` remains the only fleet/runtime/session authority.
2. Fleet discovery uses `GET /api/v1/agents`; labels never grant routing authority.
3. Every pane, session row, task link, activity marker, and action carries `{agentTypeId, sessionId}`.
4. Row click replaces the active pane; explicit Split is additive.
5. The workspace mounts one session controller per discovered Agent so asynchronous CRUD is fenced by owner and scope.
6. The UI does not restore browser-local draft/native-first adoption. `session.create` is immediately durable and ledger-owned.
7. Addressed deletion tombstones hide a deleted session across stale list responses until authoritative absence; failed deletion restores a retryable row without switching unrelated panes.
8. Runtime semantic identity excludes physical placement/generation. Physical identity remains a cache/binding discriminator.
9. Runtime migration authorizes only an exact deterministic predecessor in a verified workspace/storage scope, prepares the target before CAS, preserves transcript bytes, and serializes writers. Identity `33293674ddb7f24bcc036f4b5bedbf2457ac3a639e2969353ccb0175d385d7fe` remains unauthorized.
10. Dev login is loopback/development-only and must create or sign in a verified local user without relying on mail delivery.
11. Release publication binds RC/full-CI proof to the exact SHA and updates tags atomically, including safe same-target replacement.

## Flag / Abstraction

- Needed?: no compatibility flag; multi-Agent discovery is opt-in when no explicit `agentTypeId` is supplied.
- Path: explicit `agentTypeId` preserves single-Agent embedders; fleet mode is the production full-app/workspace path.
- Rollback: each slice is independently revertible; no stored transcript/session format is removed.

## Test Seams

- Highest public seam: Workspace Playground browser against direct `/api/v1/agents/*` routes with an Alpha/Beta scripted fleet.
- Existing prior art: Wave 1 `twoAgentFleet`, addressed selection/session tests, current Workspace pane tests, AgentHost collision/isolation tests, PR #1044 persistence proofs.
- Avoid testing: React hook internals, client-provided authority, legacy routes, or browser-local draft adoption.

## Acceptance

### Multi-Agent UI

- Full app no longer requires a hardcoded default Agent to expose fleet chats.
- Authorized Agents are discoverable with stable labels and loading/error/empty states.
- Chats can be filtered/grouped by Agent and created for a selected Agent.
- Pinned chats remain globally visible but retain addressed ownership.
- Same `sessionId` under Alpha/Beta remains distinct in list, panes, deletion, reload, tasks, and activity.
- Stale create/delete/refresh completions cannot mutate another Agent's view.
- Deletion tombstones defeat stale list races and recover explicitly on failure.
- Alpha/Beta E2E proves capability/model/transcript isolation, row replacement, and explicit split.

### Runtime identity

- Equivalent physical placement changes remain writable.
- Semantic runtime changes remain fail-closed.
- Exact predecessor migration is scoped, byte-preserving, serialized, and target-before-CAS.
- Malformed headers, stale locks, target preparation failure, CAS/write failure, and wrong scope fail closed.
- No historical guessed identity is authorized.

### Onboarding

- `/dev-login` yields a verified authenticated session on first use and repeat use.
- No email render/send is required for dev login.
- Deterministic loopback smoke provisions Postgres, migrates, logs in, creates/reopens a workspace, and cleans up.

### Release

- RC and full CI must succeed for the exact publication SHA.
- Atomic tag update never deletes a pre-existing tag on a failed publish.
- Same-target replacement is covered.

## Proof

- Exact commands per slice: focused Vitest suites, package typechecks, AgentHost matrix/composition proofs.
- Browser: Alpha/Beta Workspace Playground E2E plus full-app dev-login smoke.
- Release: local script tests and workflow invariant checks.
- Final stack: full changed tests, E2E, UI Review, reference image/remote-worker smoke, and `git diff --check`.

## Slices

### Slice 1: multi-Agent UI and addressed lifecycle races

**Delivers:** fleet discovery; per-Agent session controllers; Agent groups/filter/new-chat actions; addressed pane routing; deletion tombstones; stale owner fencing; two-Agent playground/E2E.

**Blocked by:** PR #1045.

**Proof:** Agent/Workspace focused unit tests, Alpha/Beta browser E2E, typechecks, composition matrix.

**Review budget:** exceeds one small PR but remains one vertical user-facing slice; port only behavior-bearing Wave paths recorded in a source ledger.

### Slice 2: semantic/physical runtime identity and exact migration

**Delivers:** v2 semantic identity, physical binding separation, exact authorized migration, transcript/lock/CAS safety.

**Blocked by:** Slice 1 for stack order only.

**Proof:** runtime identity suite including byte fixtures and restart tests; Host/session tests; invariants.

**Review budget:** separate high-risk migration PR.

### Slice 3: verified dev login and deterministic smoke

**Delivers:** verified one-click dev login, mail-render correction, hermetic full-app smoke.

**Blocked by:** Slice 2 for stack order only.

**Proof:** full-app tests and smoke against loopback Postgres.

**Review budget:** separate auth/onboarding PR.

### Slice 4: exact-SHA RC and atomic release tags

**Delivers:** restored release-candidate workflow, exact-SHA gate, atomic tag script and regression tests.

**Blocked by:** Slice 3 for stack order only; must land before the next release.

**Proof:** workflow invariants and deterministic script tests.

**Review budget:** separate release-control PR.

## Out of Scope

- Legacy `/api/v1/agent/*` compatibility.
- `registerAgentRoutes`, `createAgentApp`, or dual lifecycle authority.
- Browser-local draft/native-first adoption.
- Guessed runtime migration.
- Direct merge of PR #1027.

## Open Questions

None blocking. Owner explicitly requested all four slices after PR #1045; implementation proceeds as a reviewed stack.
