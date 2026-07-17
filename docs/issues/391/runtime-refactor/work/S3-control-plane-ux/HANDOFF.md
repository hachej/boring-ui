> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# S3-control-plane-ux — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P7-multi-agent-inspection merged — [../P7-multi-agent-inspection/HANDOFF.md](../P7-multi-agent-inspection/HANDOFF.md)
- [ ] STOP+report if `GET /api/v1/agents`, `GET /api/v1/agents/:agentId/info`, and the agent-scoped routes are not present — S3 consumes them, it does not build them
- [ ] STOP+report if `agent.sessions.pendingInputs` / `GET …/pending-inputs` is absent — S3 is a front-only generalization and must not stand up a server-side pending channel

## Beads
- [ ] BBS3-001 — Fleet page: agent list + per-agent drill-down (NEW; consumes `GET /api/v1/agents` + `GET /api/v1/agents/:agentId/info`)
- [ ] BBS3-002 — Cross-surface session observation in the EXISTING SessionBrowser (rewire, not rebuild)
- [ ] BBS3-003 — Central approval inbox: generalize the ask-user InboxOverlay onto T1 `resolveInput`
- [ ] BBS3-004 — Control-plane observation integration test (S3 exit)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-ask-user run typecheck`
- [ ] `pnpm --filter @hachej/boring-ask-user run test`
- [ ] `pnpm lint:workspace-plugin-invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter workspace-playground run test:e2e`

## Review gates
- [ ] The **Fleet page** consumes only `GET /api/v1/agents` plus `GET /api/v1/agents/:agentId/info`, lists every declared agent with a per-agent drill-down (sessions, pending approvals, environments), is read-only (no authoring), renders no secret/handle, and registers as a `workspace-page` through the existing `PanelRegistry`/`WorkspaceSourceRegistry` (not a new host); the fleet-widget extension point is deferred (farm epic), not built.
- [ ] Cross-surface sessions surface in the **existing** `SessionBrowser`/`SessionList` via an origin badge + filter; transcript viewing reuses `PiChatPanel`/`RemotePiSession` by `sessionId` (assert no new viewer).
- [ ] `SessionSummary.originSurface` is additive/optional; existing JSONL sessions load unchanged (default workspace).
- [ ] Central inbox is the **generalized ask-user `InboxOverlay`** on the single T1 `resolveInput` path; the ask-user-only pending channel is deleted, not paralleled; any temporary `TODO(remove:*)` marker names its deletion-owner bead and is gone before that owner phase closes.
- [ ] Preserve the current ask-user UI placement unless a bead explicitly changes it: `QuestionForm` remains placement `"center"`, and the inbox remains an `appLeftActions` overlay; do not create a second workspace-page inbox.
- [ ] Public contracts only — no core-internal import, no private hook, no platform addressing in any UI signature (`pnpm audit:imports` green).
- [ ] Agent-as-directory authoring is **not** present (deferred post-P7); the inspect panel exposes no create/configure controls.
- [ ] No new UI framework or registry; new surfaces register via `definePlugin`.
- [ ] Any transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later owner is allowed only when explicitly named per [INDEX.md](../../INDEX.md), and no marker outlives its named owner's phase.

## Exit criteria
- [ ] A Fleet page lists every declared agent from `GET /api/v1/agents`, enriches rows with model/tools/readiness/environments from `/info`, stays read-only, and provides a per-agent drill-down (that agent's sessions, pending approvals, environments), registered through the existing workspace-page registration.
- [ ] Sessions born on other surfaces (Slack, embed) appear in the existing `SessionBrowser`/`SessionList` with an origin-surface badge + filter once the session store is shared; viewing any transcript reuses `PiChatPanel`/`RemotePiSession` by `sessionId`.
- [ ] A central approval inbox generalizes the existing ask-user `InboxOverlay`: pending input-requests across sessions and surfaces on the single T1 `resolveInput` path, answerable inline; the ask-user-specific pending channel folded in (no second inbox).
- [ ] No new UI framework, no new registry/host; every new surface registers through `definePlugin`/`registerPanel`/`registerWorkspaceSource`/`appLeftActions` as appropriate. Agent-as-directory authoring not built.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
