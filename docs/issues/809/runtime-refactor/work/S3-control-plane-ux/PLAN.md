> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# S3-control-plane-ux — Plan

Status: post-v1; not a #391 v1 exit gate.

> Phase: Phase S3 — Control-plane UX (also needs Phase 7) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../../../391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md) — "The steering surface": the workspace is the control plane, steering = consuming the same public contracts (the `/info` endpoint) with more of them, never private core hooks; one approval channel.

## Design context
S3 is a **delta** plan, not greenfield — the workspace control plane (session list/search/browser, multi-project rail, event inspector, ask-user approvals inbox, panel/source registries, model pickers, readiness badges) already exists; S3 extends those surfaces to consume the P7 public contracts. It adds one genuinely new Fleet page (every declared agent from `GET /api/v1/agents`, then per-agent details from `GET /api/v1/agents/:agentId/info`, with a per-agent drill-down composing the session list + inbox filtered by `agentId`), an origin-surface badge + filter on the existing `SessionBrowser`/`SessionList` (so Slack/embed-born sessions appear once the store is shared; transcripts reuse `PiChatPanel`/`RemotePiSession` by `sessionId`), and a central approval inbox generalizing the ask-user `InboxOverlay` onto the single T1 `resolveInput` path. Everything registers through the existing `definePlugin`/`registerPanel`/`registerWorkspaceSource`/`appLeftActions` system — no new host, no new registry, public contracts only, no secrets rendered. Agent-as-directory authoring stays out of scope (observe/inspect/approve only).

Verified current repo reality: ask-user currently registers `QuestionForm` as panel `ask-user.questions` with placement `"center"`, and mounts its pending inbox through `definePlugin({ appLeftActions: [...] })` when `appLeftInbox` is enabled. The plugin authoring config supports `panels`, `workspaceSources`, `commands`, `catalogs`, `appLeftActions`, `surfaceResolvers`, `providers`, `bindings`, `toolRenderers`, and `setup`. `registerCatalog` / `registerPanelCommand` registries live in `packages/workspace/src/shared/plugins/{CatalogRegistry,CommandRegistry}.ts`; panel and workspace-source registries live under `packages/workspace/src/front/registry/`.

Design note: the artifact shelf is farm-epic scope; it folds the `data-artifact` stream, chooses viewers from 08's kind catalog, and leaves the editable-artifact loop out of S3.

> Note: the migration-phase source (now absorbed into [`INDEX.md`](../../../../391/runtime-refactor/INDEX.md)) carried no dedicated Phase S3 Deliverables/Exit block — only the track-overview line "Phase S3 (control-plane UX; also needs Phase 7)". The Deliverables and Exit criteria below are drawn verbatim from the S3 [TODO.md](TODO.md) Goal / exit-criteria section.

## Deliverables
- A **Fleet page** (new), registered through the existing workspace-page registration, listing every declared agent from `GET /api/v1/agents` and enriching rows from `GET /api/v1/agents/:agentId/info` (model/tools/readiness/environments) read-only, with a per-agent drill-down (that agent's sessions, pending approvals, environments). Fleet-widget extension point deferred to the farm epic.
- Sessions born on other surfaces (Slack, embed) appear in the existing `SessionBrowser`/`SessionList` with an origin-surface badge + filter once the session store is shared; transcript viewing reuses the existing `PiChatPanel`/`RemotePiSession` stack by `sessionId`.
- A central approval inbox generalizing the existing ask-user `InboxOverlay`: pending input-requests across sessions and surfaces on the single T1 `resolveInput` path, answerable inline; the ask-user-specific pending channel folded in (no second inbox).
- No new UI framework, no new registry/host; every new surface registers through `definePlugin`/`registerPanel`/`registerWorkspaceSource`/`appLeftActions` as appropriate. Agent-as-directory authoring not built.

## Exit criteria
The workspace is the eve-class control plane over public contracts only: the Fleet page lists every agent with per-agent drill-down; cross-surface sessions surface with badge + filter and reuse the existing transcript stack; the central inbox answers pending requests across sessions/surfaces via the single T1 `resolveInput` channel; all new surfaces register through the existing plugin system (`panels`/`workspaceSources`/`appLeftActions` as appropriate) with no core-internal import and no secret leak.
