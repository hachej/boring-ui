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
- Task links durably persist `agentTypeId` and `sessionId`; the Workspace-authorized task-link stream projects those canonical link descriptors without transcript content.
- The durable task-link store projects one Workspace-scoped SSE: connection/reconnection sends the authoritative task-to-session link snapshot, successful durable writes publish the complete changed task link set, and card counts derive from `links.length`.
- Starting a task chat publishes canonical creation immediately but persists the task link only after the exact session's first prompt is accepted. Failed placement rolls back through shell-owned deletion.
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
- Task cards create one canonical addressed session through the Workspace shell, publish it to Chats immediately, and keep the task link provisional until that exact addressed session's first prompt is accepted.
- Provisional binding intent survives tab reload, retries transient link failures, and rolls back through shell-owned deletion if detached placement fails.
- Task links survive restart and retain the Agent owner.
- Persisted task-session links and derived counts appear without expanding each task, update across connected clients after route/tool mutations, and reconcile from a fresh snapshot after reconnect.
- Expanding a task renders streamed link descriptors immediately with no list request or loading label; activity and Handover enrichment remain addressed and lazy.
- Task routes/tools never retain Workspace outside a Host lease.
- Successful handovers are reconstructed only from allowlisted structured terminal-run details.
- No forbidden compatibility architecture returns.

## Proof

- Ask User: 114 passed, 1 skipped; Tasks: 143 passed.
- Agent, Workspace, Core, Ask User, Tasks, CLI, and playground typechecks passed.
- AgentHost cutover matrix: 19 rows, 39 final routes, 23 deleted routes, zero forbidden compatibility references.
- All seven AgentHost composition roots passed.
- Focused Ask User browser proofs passed individually, including exact-session reload/cancel and explicit Questions opening.
- Combined GitHub + Beads browser proof passed with no `/sessions/list` request or `Refreshing…` state.
- Real HTTP/1.1 browser proof passed without request interception: the task count and expanded session row auto-hydrated while detached chat remained open, and the underlying composer draft survived its temporary remote-stream suspension.
- Stable review playground was verified in Chromium and Firefox with HMR disabled and zero application errors.

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
**Delivers:** full-stack lifecycle proof and PR handoff, including one authoritative task-link SSE with reconnect snapshot and event-driven link updates.
**Blocked by:** Slices 1–2.
**Proof:** store/route/frontend stream tests, composition gates, and Playwright create → link → hydrate → count/reload scenario.

## Out of Scope

- Restoring old compatibility routes.
- Inferring task links from titles, prompts, branches, or generated IDs.
- Multi-Agent task routing beyond the explicitly host-selected Tasks plugin Agent.

## Open Questions

- None currently blocking implementation.
