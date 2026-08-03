---
github: https://github.com/hachej/boring-ui/issues/796
issue: 796
state: ready-for-review
updated: 2026-08-03
track: owner
---

# Addressed semantic port of PRs #923 and #925

## Problem

PRs #923 and #925 implement Human Intention artifacts and task ↔ native-session links on the pre-cutover session architecture. PR #1044 now owns the #775 session-correctness layer on top of PR #1038's addressed-only AgentHost. The old stack cannot be merged because it includes deleted default-Agent routes and unbounded Workspace/session access.

## Solution

Create one new PR stacked on PR #1044 that preserves the product behavior while replacing every session identity with `{ agentTypeId, sessionId }`, every trusted Workspace use with a callback-scoped Host lease, and every transcript inspection with an allowlisted redacted run projection.

## Decisions

- PR #1044 is the base and remains authoritative for session creation, boot resume, transcript identity, and deletion.
- Human artifacts are typed, bounded structured records and open independently from chat.
- Inbox chat openers retain the Agent owner.
- Task links durably persist `agentTypeId` and `sessionId`; session IDs are never disclosed until exact authorization succeeds.
- Starting a task chat performs canonical server creation, durable task binding, then UI publication. A failed link triggers best-effort deletion of the newly-created empty session.
- Task HTTP routes and tools use `runWithWorkspaceAgent`; no Workspace escapes its Host lease.
- Handover summaries expose only terminal run identity and explicitly allowlisted structured details.
- `createAgentApp`, `registerAgentRoutes`, `/api/v1/agent/*`, legacy route mounts, and default-Agent inference remain absent.

## Flag / Abstraction

- Needed?: Not separately flagged; this is a stacked restoration of already-reviewed features.
- Path: Workspace artifact/shell capabilities plus the Tasks and Ask User plugins.
- Rollback: Revert this stacked PR without changing PR #1044 session behavior.

## Test Seams

- Highest public seam: plugin HTTP routes and Workspace shell capability APIs.
- Existing prior art: PR #923 commit `c7157f1e7`; PR #925 commits `b40a78395` and `9b1b9e52d`.
- Avoid testing: private React state or raw transcript contents beyond the redacted projection contract.

## Acceptance

- Human Intention records show multiple artifacts, related tasks, exact chat ownership, and independent artifact/chat actions.
- Task cards create one canonical addressed session, bind it before opening, and roll back a failed bind.
- Task links survive restart and retain the Agent owner.
- Unauthorized/missing sessions are indistinguishable and exact IDs are redacted.
- Task routes/tools never retain Workspace outside a Host lease.
- Successful handovers are reconstructed only from allowlisted structured terminal-run details.
- No forbidden compatibility architecture returns.

## Proof

- Ask User: 114 passed, 1 skipped; Tasks: 65 passed.
- Agent, Workspace, Core, Ask User, and Tasks typechecks passed.
- AgentHost cutover matrix: 19 rows, 39 final routes, 23 deleted routes, zero forbidden compatibility references.
- All seven AgentHost composition roots passed.
- Focused Ask User browser proofs passed individually, including exact-session reload/cancel and explicit Questions opening.
- Workspace playground production dependency builds passed; the full shared-state browser batch had three order-dependent failures, while 22 scenarios passed and the affected Ask User scenarios passed in isolation.

## Slices

### Slice 1: Human Intention artifacts
**Delivers:** PR #923 behavior on addressed shell capabilities.
**Blocked by:** PR #1044.
**Proof:** Ask User and Workspace tests/typechecks.

### Slice 2: Addressed task-session authority
**Delivers:** durable owner-aware links, authorization, redacted handovers, and lease-scoped routes/tools.
**Blocked by:** Slice 1.
**Proof:** Tasks, Agent, Core, and Workspace tests/typechecks.

### Slice 3: Composition and browser proof
**Delivers:** full-stack lifecycle proof and PR handoff.
**Blocked by:** Slices 1–2.
**Proof:** composition gates and Playwright scenario.

## Out of Scope

- Restoring old compatibility routes.
- Inferring task links from titles, prompts, branches, or generated IDs.
- Multi-Agent task routing beyond the explicitly host-selected Tasks plugin Agent.

## Open Questions

- None currently blocking implementation.
