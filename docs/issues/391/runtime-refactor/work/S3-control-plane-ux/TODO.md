> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# TODO-S3 — Control-plane UX: agent inspect, cross-surface sessions, central approvals

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

**This is a DELTA plan, not greenfield.** The workspace control plane already exists in large part (session list/search/browser, multi-project rail, an event inspector, an approvals inbox, panel/source registries, model pickers, readiness badges). S3 **extends** those surfaces to consume the P7 public contracts. Do not rebuild any of them. Read "What exists today" first and treat every bead as an edit against that inventory.

## Context (read first)

### What exists today (verified paths — the surfaces S3 extends)

Session list / search / browser:
- `packages/agent/src/front/chat/session/SessionList.tsx` — grouped-by-day session list; props over `SessionSummary[]` (`onSwitch`/`onCreate`/`onDelete`/`onLoadMore`). The reusable list primitive.
- `packages/agent/src/front/chat/session/piSessionSearch.ts` — **front-side** fuzzy/recent filter over already-loaded `PiSessionSearchItem`s (`searchPiSessions`, `matchPiSessionSearch`, `parsePiSessionSearchQuery`). No server call, no origin/surface awareness.
- `packages/agent/src/front/chat/session/usePiSessions.ts` — session load/switch/create/delete state hook feeding the panels.
- `packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx` — the rich workspace browser: pinned section, open-as-tab, per-session "working" status (via `boring:chat-session-status` window events), attention badges. The primary control-plane session surface.
- `packages/agent/src/shared/session.ts` — `SessionSummary { id, title, createdAt, updatedAt, turnCount }`. **No `origin`/`surface`/`agentId` field today** — this is the shape BBS3-002 extends.

Multi-project left bar (#377/#363 — landed):
- `packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx` + `AppLeftPaneProjects.tsx` + `AppLeftPaneSessionRow.tsx` — cross-workspace/project nav in the app-left rail: projects grouped with their sessions, pinned projects (global `boring-workspace:pinned-projects` localStorage), per-session attention badges. `AppLeftPaneProject` / `AppLeftPaneProjectSession` are the row view-models.

Event inspector (already an inspector — the model for the agent inspect panel):
- `packages/agent/src/front/DebugDrawer.tsx` — read-only inspector with `session | prompt | messages` tabs and copy buttons; inspects session state, system prompt, and the `UIMessage[]`. The agent inspect panel (BBS3-001) is the same read-only-inspector shape, pointed at `/info` instead of the live message array.

Approvals surface (today's approval-ish UI — the base for the central inbox):
- `plugins/ask-user/src/front/index.tsx` — `definePlugin` registration; a `QuestionForm` pane (`ASK_USER_PANEL_ID = "ask-user.questions"`, placement `"center"`) **and** an **`InboxOverlay`** (`plugins/ask-user/src/front/inbox/{InboxOverlay,InboxDetailPanel,InboxFilterBar,InboxRow,InboxSection}.tsx`) — a pending-questions inbox **across sessions** with filter/detail. Mounted through `definePlugin({ appLeftActions: [...] })` when `appLeftInbox` is enabled; the overlay component receives `BoringFrontAppLeftOverlayProps`.
- `plugins/ask-user/src/front/runtime.ts` + `providerHooks.ts` — pending-question store; wires questions into `WorkspaceAttentionProvider` blockers.
- `plugins/ask-user/src/server/*` — `askUserRuntime.ts`, `questionsBridge.ts`, `createAskUserTool.ts`, `askUserStore.ts`, `askUserStatePublisher.ts` — the current (pre-T1) question channel and its own pending store/publisher.
- `packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx` — `WorkspaceAttentionBlocker` → session badges (`needs-input`, etc.); the cross-surface "needs attention" signal already consumed by `SessionBrowser` + `AppLeftPane`.

Panel / source / catalog registration points (the REAL registries — register new UI here, do not invent a new host):
- Plugin authoring API `@hachej/boring-workspace/plugin`: `definePlugin({ id, label?, panels, workspaceSources, commands, catalogs, appLeftActions, surfaceResolvers, providers, bindings, toolRenderers, setup })` (`packages/workspace/src/shared/plugins/frontFactory.ts`).
- `api.registerPanel({ id, label, component, placement: "workspace-page" })` → `packages/workspace/src/front/registry/PanelRegistry.ts` (dockview tabs/pages). Note: `left-tab`/`workspace-source` placements are **removed** — left-rail entries go through `registerWorkspaceSource`.
- `api.registerWorkspaceSource(...)` → `packages/workspace/src/front/registry/WorkspaceSourceRegistry.ts` — the left-rail sources rendered by `packages/workspace/src/front/chrome/workbench-left/WorkbenchLeftPane.tsx` (via `useWorkspaceLeftPaneActions.tsx`).
- `api.registerCatalog(...)` → `packages/workspace/src/shared/plugins/CatalogRegistry.ts`; `api.registerPanelCommand(...)` → `packages/workspace/src/shared/plugins/CommandRegistry.ts` (command palette). App-left overlay chrome: `packages/workspace/src/shared/plugins/appLeftOverlayChrome.ts`.

Model picker / readiness badges (reuse for the inspect panel's live status):
- `packages/agent/src/front/chatPanelComposerControls.tsx` — `ModelSelectTrigger`, `ModelPickerMenu`, `AvailableModel`/`ModelSelection` (the model picker), plus composer readiness/action controls.
- Readiness source: `packages/agent/src/server/runtime/readyStatus.ts` (`ReadyStatusTracker.getReadiness()`), surfaced **per agent inside the `GET /api/v1/agents/:agentId/info` payload** (BBP7-005) — P7 adds no agent-scoped `/ready-status` route. The existing non-agent-scoped `GET /api/v1/ready-status` SSE route (`packages/agent/src/server/http/routes/readyStatus.ts`) remains for a live workspace-level stream, but per-agent readiness is read from `/info`.

Transcript viewing / attach-by-sessionId (reuse verbatim — do not rebuild a viewer):
- `packages/agent/src/front/chat/PiChatPanel.tsx` + `piChatPanelHooks.ts` + `packages/agent/src/front/chat/pi/remotePiSession.ts` (`RemotePiSession`, keyed by `sessionId`, streams `/api/v1/agent/pi-chat/...`) + `usePiSessions.ts`. This stack renders any session's transcript by `sessionId`; T2 rewires its transport to DS `startIndex` replay. Cross-surface transcript viewing = mount this stack with the target `sessionId`.

### The plan this delivers

- `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "The steering surface" — the workspace is the **control plane**; steering = the workspace consuming the same **public contracts, with more of them** (the `/info` endpoint), never private core hooks. Also § "The headless façade: `createAgent()`" (the core public API is `agent.start()` receipt + `agent.stream()` replay/tail + `resolveInput`) and § "Human-in-the-loop" (one approval channel; any surface holding the `sessionId` answers via `resolveInput`).
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` § "North star" — eve-class UX steered from the workspace: author → configure → deploy → converse anywhere → inspect/observe. A1 already owns directory authoring and CLI local dev; S3 adds read-only control-plane inspection, not a second authoring path.
- `docs/issues/391/runtime-refactor/INDEX.md` § Phase 7 v2 ("agent inspection endpoint … consumed by workspace panels"), § Phase T1 (durable indexed event stream + on-stream approvals + `resolveInput`), § Phase T2 (front transport refit to `sessionId`-only public contract).
- `docs/issues/391/runtime-refactor/work/P7-multi-agent-inspection/TODO.md` — **BBP7-005 ships `GET /api/v1/agents`** (scrubbed list from P7's host registry of stateless P6-R entries) **and `GET /api/v1/agents/:agentId/info`** (`{ agentId, model, tools, readiness, channels, environments }`; public, private-hook-free, no secret leak; modeled on `models.ts`). **These are the entire agent steering endpoints S3 consumes.** BBP7-002 defines the `/api/v1/agents/:agentId/...` path prefix and P7-owned registry addressing; BBP7-004 ships the scoped session-search API S3's session filter calls.
- BINDING policy: `docs/issues/391/runtime-refactor/INDEX.md` "Simplicity & no-compat policy" — no shims, no abstraction without two real consumers, `TODO(remove:<bead-id>)` regime, migrate every importer in the same PR. Work-package links use canonical `work/<pkg>/TODO.md` paths from [`../../INDEX.md`](../../INDEX.md).

### Depends on

- **T2** ([`../T2-transport/TODO.md`](../T2-transport/TODO.md)): the `sessionId`-only public transport (`RemotePiSession`/`usePiSessions`/`PiChatPanel` refit) + DS `startIndex` replay. Cross-surface transcript viewing (BBS3-002) attaches the refit stack by `sessionId`.
- **P7** ([`../P7-multi-agent-inspection/TODO.md`](../P7-multi-agent-inspection/TODO.md)): `GET /api/v1/agents` + `GET /api/v1/agents/:agentId/info` (BBP7-005), the `/api/v1/agents/:agentId` addressing + P7 host registry (BBP7-002), and the scoped session-search route `GET /api/v1/agents/:agentId/sessions/search` (BBP7-004). **If the agent list, `/info`, and the agent-scoped routes are not present, STOP and report** — S3 consumes them, it does not build them.
- **T1** ([`../T1-durable-events/TODO.md`](../T1-durable-events/TODO.md), via T2/P7): the durable pending-input-request store + `resolveInput` path + the named **`agent.sessions.pendingInputs(ctx, { sessionId? })`** read API (HTTP mirror `GET /api/v1/agents/:agentId/pending-inputs` / `GET …/agents/:agentId/sessions/:sessionId/input`, redacted; locked route family, `:agentId` canonical `default` until P7) that the central inbox (BBS3-003) reads. **T1 (not S3) owns the server-side ask-user migration** — the bridge/store deletion and folding `ask_user` onto the single on-stream channel (BBT1-005). BBS3-003 only consumes the resulting pending-request API from the front; if that API is absent, S3 stops and reports rather than building a server channel.

## Goal / exit criteria

The workspace is the eve-class control plane over public contracts only:

1. A **Fleet page** exists (new), registered through the existing workspace-page registration (`registerPanel({ placement: "workspace-page" })` + `registerWorkspaceSource`), listing **every declared agent** from `GET /api/v1/agents` and enriching each row with model/tools/readiness/environments from `GET /api/v1/agents/:agentId/info`, read-only, with a **per-agent drill-down** (that agent's sessions, pending approvals, and environments — composing the BBS3-002 session list + BBS3-003 inbox filtered by `agentId`). No private core hook, no secret shown. A fleet-page **widget** extension point is deferred to the farm epic.
2. Sessions born on **other surfaces** (Slack, embed) appear in the **existing** `SessionBrowser`/`SessionList` with an **origin-surface badge** and a **filter**, once the session store is shared; viewing any such transcript reuses the existing `PiChatPanel`/`RemotePiSession` stack attached by `sessionId`.
3. A **central approval inbox** generalizes the existing ask-user `InboxOverlay`: pending input-requests **across sessions and surfaces** on the single T1 `resolveInput` path, answerable inline; the ask-user-specific pending channel is folded into it (no second inbox).
4. No new UI framework, no new registry/host; every new surface registers through `definePlugin`/`registerPanel`/`registerWorkspaceSource`. Agent-as-directory authoring is **not** built (out of scope — see Do NOT).

## Non-negotiables

- **Extend, do not rebuild.** Reuse `SessionList`/`SessionBrowser`/`piSessionSearch`, `DebugDrawer`'s inspector shape, the ask-user `InboxOverlay`, `PiChatPanel`/`RemotePiSession`, the model picker, and the readiness/attention providers. A bead that reintroduces a parallel session list, transcript viewer, or approval channel is rejected.
- **Public contracts only.** S3 consumes `agent.start`/`agent.stream`/`resolveInput` (in-process) and the HTTP surfaces `GET /api/v1/agents`, `GET /api/v1/agents/:agentId/info`, `GET /api/v1/agents/:agentId/sessions/search`, the **T2 public event transport** (`GET /api/v1/agents/:agentId/sessions/:sessionId/events/stream` + the `ChatTransport` contract from `TODO-T2` — NOT the legacy `…/pi-chat/:sessionId/*` routes, which are deleted at the T2 cutover), and `resolveInput`/`POST /api/v1/agents/:agentId/sessions/:sessionId/input`. **No import of core internals, no private hook** (`08`/`00` steering rule; the endpoints are the entire private-hook-free surface).
- **Register through the existing system.** New panels via `api.registerPanel({ placement: "workspace-page" })` (`PanelRegistry`); new left-rail entries via `api.registerWorkspaceSource` (`WorkspaceSourceRegistry`); overlays via `definePlugin({ appLeftActions: [...] })` and the app-left-overlay chrome. Do not add a new registry or a competing plugin host.
- **One approval channel** (`00` invariant 13; `08` HITL). The central inbox routes onto T1 `resolveInput` — it does not add a second approval mechanism. ask-user's own pending store/publisher is migrated onto T1 **by T1** (BBT1-005), not by S3 and never paralleled; S3 only consumes the resulting front-facing pending-request API and never keeps or re-creates a second server-side approval channel.
- **Two handles** (`08`/T2): the UI addresses sessions by `sessionId` and agents by `agentId`/`workspaceId` only — never platform addressing (Slack thread `ts`, workbook id). The origin-surface badge is display metadata carried on the session record, not an addressing key.
- **No secret/key material** rendered anywhere — `/info` is already scrubbed (BBP7-005); the panel must not re-derive or request secrets.
- No US-hosted service introduced as a default (`00` invariant 15). S3 is pure front + view-model wiring; it adds none.

## Do NOT

- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do NOT build a second authoring/configuration UI. A1 owns the v1
  `agent.json` + `instructions.md` compiler and CLI. S3 is
  **observe/inspect/approve only**; editing definitions or deployments is out
  of scope.
- S4 owns onboarding/readiness status for definitions, demo URLs, provisioning, and missing policy refs; S3 remains observe/inspect/approve only.
- Do NOT rebuild the session list/search/browser, the transcript viewer, the debug/event inspector, or the approvals UI — extend the existing components named above.
- Do NOT build the `/info` endpoint, the agent-scoped routes, the session-search API, or the T1 approval store — those are P7/T1/T2. If missing, STOP and report.
- Do NOT introduce a new UI framework, state library, or a second registry/host.
- Do NOT let any new surface accept platform addressing or reach into core internals.

## Beads

### BBS3-001 — Fleet page: agent list + per-agent drill-down (NEW; consumes `GET /api/v1/agents` + `GET /api/v1/agents/:agentId/info`) · size M
- **Title**: A dedicated read-only **Fleet page** — one workspace page listing **every declared agent** with a per-agent drill-down (model/tools/readiness/environments, plus that agent's sessions and pending approvals).
- **Status**: the **genuinely new** control-plane surface — the "fleet view" pillar of the farm control plane (`00` North star). It is a **page**, not just a panel: everything else in S3 is a delta on an existing component; the Fleet page is new — but it registers through the **existing workspace-page registration** (`registerPanel({ placement: "workspace-page" })`) and reuses the existing inspector/readiness/session idioms rather than inventing a host.
- **Deliverable shape**: a **fleet list → agent drill-down** page. The list row per agent shows model, tool summary, plugin summary, readiness badge, and environment count (all from `/info`). Selecting an agent opens the drill-down: its **model/tools/plugins/readiness/environments** (read-only inspector sections), its **sessions** (the existing session list, pre-filtered to that `agentId`), and its **pending approvals** (the central inbox, pre-filtered to that `agentId`). The drill-down composes the BBS3-002 session list + BBS3-003 inbox **filtered by `agentId`** — it does not re-implement them. **Amendment (2026-07-08):** plugin UI panels are shown/activated only for agents whose resolved plugin set includes that plugin.
- **Files create**: a small front plugin (e.g. `packages/workspace/src/plugins/fleetPlugin/front/` or a new `plugins/fleet/` — match the repo's plugin-placement convention; verify against how `filesystemPlugin` and `ask-user` are located and pick the lighter one). Contains: a `FleetPage` (fleet list of declared agents → per-agent drill-down with model/tools/readiness/environments + sessions + pending-approvals sub-views, modeled on `DebugDrawer`'s tabbed read-only inspector), an agent-list client, and an `/info` client.
- **Files touch**: register via `definePlugin({ panels: [{ id: "fleet", label: "Fleet", component, placement: "workspace-page" }], workspaceSources: [...] })` for the workspace page + left-rail entry (`packages/workspace/src/shared/plugins/frontFactory.ts` API → `PanelRegistry`/`WorkspaceSourceRegistry`). Reuse the model-label helpers from `chatModelLabels`/`chatPanelComposerControls.tsx` for provider/model display; reuse the readiness snapshot shape from `runtime/readyStatus.ts`; reuse the BBS3-002/003 session-list + inbox components for the drill-down (filtered by `agentId`).
- **Notes**: Fetch `GET /api/v1/agents` first for the declared-agent ids/default/labels, then fetch `GET /api/v1/agents/:agentId/info` per listed id for model/tools/plugins/readiness/environments. Read-only — **no** edit/configure controls (authoring is out of scope). Never render a secret/handle field; assert both payloads are already scrubbed (BBP7-005). Per-agent readiness comes from the `/info` payload itself (there is no agent-scoped `/ready-status` route); if a live workspace-level readiness stream is wanted, subscribe to the existing non-agent-scoped `GET /api/v1/ready-status` rather than polling `/info`. **Deferred (farm epic — do NOT build here):** a **fleet-page WIDGET extension point** — a plugin-contributed surface that renders custom per-agent or fleet-wide widgets (a named farm-epic plugin surface, `08` Farm-MCP/farm-widgets direction). The Fleet page ships fixed sections in this epic; the widget slot is a follow-up.
- **Tests**: `FleetPage.test.tsx` — the list renders every declared agent from mocked `GET /api/v1/agents`, enriches each row with model/tools/readiness/environment-count from mocked `/info`, and selecting an agent shows its drill-down (model/tools/readiness/environments + `agentId`-filtered sessions + `agentId`-filtered pending approvals); a reviewer agent shows readonly env + no bash tool; a pure concierge shows no environments; asserts no key/secret field is rendered; the page registers under the existing `PanelRegistry`/`WorkspaceSourceRegistry` as a `workspace-page` (not a new host).
- **Acceptance**: [`../../INDEX.md`](../../INDEX.md) Phase S3/P7 contract — the agent list + inspection endpoints are consumed by workspace panels; the Fleet **page** lists every agent with per-agent drill-down (sessions, pending approvals, environments), is public-contract-only, and registers through the existing workspace-page system; the fleet-widget extension point is noted as a deferred farm-epic surface.

### BBS3-002 — Cross-surface session observation in the EXISTING SessionBrowser (rewire, not rebuild) · size M
- **Title**: Sessions born on other surfaces appear in the existing session list with an origin-surface badge + filter; transcripts open in the existing chat stack.
- **Files touch**:
  - `packages/agent/src/shared/session.ts` — add `originSurface?: "workspace" | "slack" | "embed" | "cli" | string` (and, if not already threaded, `agentId?`) to `SessionSummary`, mirroring the `originSurface` field on `AgentSendInput` (**type defined in P1/BBP1-002**; session-create provenance semantics specified by `TODO-T2` BBT2-001). The session store populates it at `create()` from the creating surface. The workspace adapter writes `'workspace'`; future relocated surfaces may write values such as `'slack'` (Slack via flue channels) or `'embed'` (pi-for-excel #551). **S3 only consumes it.** Keep it optional so existing JSONL sessions load unchanged (default `"workspace"`).
  - `packages/agent/src/front/chat/session/SessionList.tsx` + `packages/workspace/src/front/chrome/session-list/SessionBrowser.tsx` — render an **origin-surface badge** per row (reuse the existing badge/`WorkspaceAttentionSessionBadge` rendering idiom; do not add a new badge system).
  - `packages/agent/src/front/chat/session/piSessionSearch.ts` — extend `PiSessionSearchItem` + `parsePiSessionSearchQuery` with an `origin:` filter token over the new field (client-side filter of the already-loaded list; the server-side scoped search remains BBP7-004).
  - `packages/agent/src/front/chat/session/usePiSessions.ts` — carry `originSurface` through the session view-model.
- **Notes**: Transcript viewing for a Slack-born (or any) session is the **existing** `PiChatPanel`/`RemotePiSession` stack mounted with that `sessionId` over the T2 public stream — **no new viewer**. The only additions are: the `SessionSummary` field, the badge render, and the filter token. Cross-surface visibility itself is a consequence of the **shared session store** (T1/T2) — S3 does not move sessions, it labels and filters what the shared store already lists. Do not enumerate other workspaces to find sessions; page by `(workspaceId, agentId)` exactly as BBP7-004.
- **Tests**: `SessionList`/`SessionBrowser` test — a session with `originSurface: "slack"` renders the Slack badge; `origin:slack` filters the list; a session without the field defaults to workspace and still renders; clicking a foreign-origin row opens the existing chat panel by `sessionId` (viewer stack unchanged — assert no new viewer component).
- **Acceptance**: `08` "the workspace attaches to a Slack-born session by `sessionId` like any other"; badge + filter added, transcript stack reused.

### BBS3-003 — Central approval inbox: generalize the ask-user InboxOverlay onto T1 `resolveInput` · size M
- **Title**: One cross-session/cross-surface inbox of pending input-requests, answered inline via the single T1 `resolveInput` path.
- **Files touch**:
  - `plugins/ask-user/src/front/inbox/{InboxOverlay,InboxDetailPanel,InboxFilterBar,InboxRow,InboxSection}.tsx` — generalize the item model from ask-user questions to any **pending input-request** on the T1 stream (approval requests + ask-user questions are the same `data-approval-request`/`input.requested` event per `08`). Keep the overlay/detail/filter UI; broaden `inboxItemModel.ts` to the union.
  - `plugins/ask-user/src/front/runtime.ts` + `providerHooks.ts` — source pending requests from T1's named **`agent.sessions.pendingInputs(ctx: SessionCtx, { sessionId? })`** read API (explicitly ctx-scoped per `TODO-T1`/BBT1-004; the HTTP adapter resolves `x-boring-workspace-id → SessionCtx`) — HTTP `GET /api/v1/agents/:agentId/pending-inputs` for the cross-session inbox, `GET …/agents/:agentId/sessions/:sessionId/input` when scoped; locked route family, `:agentId` canonical `default` until P7 — instead of the ask-user-only `askUserStore`. Answering an item calls `agent.resolveInput(sessionId, requestId, response)` (in-process) / `POST …/agents/:agentId/sessions/:sessionId/input` (HTTP). **STOP and report if `agent.sessions.pendingInputs` / `GET …/pending-inputs` is absent** — S3 is a front-only generalization and must not stand up a server-side pending channel to fill the gap.
  - **No ask-user server files.** T1 (BBT1-005) already owns the server-side ask-user migration: it deletes `questionsBridge.ts` / the ask-user-only pending store/publisher and folds `ask_user` onto the single on-stream request + T1 pending-request store. S3 does **not** re-touch `askUserRuntime`/`questionsBridge`/`askUserStore`/`askUserStatePublisher`, does not re-do that migration, and does not create or keep any second server-side approval channel.
  - `packages/workspace/src/front/attention/WorkspaceAttentionProvider.tsx` — keep the existing blocker→badge wiring; the inbox now feeds it from the generalized pending set (no new attention system).
- **Notes**: This is **reuse the surface, swap the source** — the InboxOverlay stays; its backing store moves to T1. State **reused**: overlay/detail/filter/row components, attention-blocker wiring, the app-left-overlay mount. State **added**: the generalized pending-request item type and the `resolveInput` answer call. One approval channel only (`00` invariant 13) — do not keep the ask-user store as a parallel source past the T1 cutover.
- **Tests**: inbox test — pending requests from two sessions on two origin surfaces appear in one inbox; answering an item calls `resolveInput` with the right `(sessionId, requestId)`; an ask-user question and a tool approval render in the same list, both sourced from the single T1 pending-request API (assert the front reads only that API — no second front source and no S3-added server channel; T1 owns deleting the ask-user-only publisher).
- **Acceptance**: `08` "answer approvals centrally (same `resolveInput` path as every surface)"; existing inbox reused, backing store on T1, single channel.

### BBS3-004 — Control-plane observation integration test (S3 exit) · size S
- **Title**: One workspace observing/approving sessions from two surfaces and inspecting two agents, through public contracts only.
- **Files create**: `packages/workspace/src/front/__tests__/controlPlaneObservation.test.tsx` (or the closest existing workspace integration harness) — mount the control-plane shell against mocked `/info`, session-search, pi-chat stream, and pending-request endpoints; drive: (a) the agent inspector lists two agents with distinct model/tools/readiness; (b) `SessionBrowser` shows a workspace-origin and a slack-origin session, filters by origin, and opens each transcript by `sessionId`; (c) the inbox answers a pending request from the slack-origin session via `resolveInput`.
- **Notes**: Assert **only public contracts** are called (no core-internal import); assert no secret field crosses any boundary. Reuse existing workspace test utilities (`front/testing/*`).
- **Tests**: the file is the test.
- **Acceptance**: the workspace steers/observes/approves across surfaces and agents using the public contracts alone — the `08` steering-surface story, executable.

## Verification — exact commands verified against package.json scripts

```bash
# workspace (control-plane panels, session browser, attention) — scripts confirmed in packages/workspace/package.json
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants

# agent front (SessionList / piSessionSearch / PiChatPanel / SessionSummary) — packages/agent/package.json
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test

# ask-user plugin (central inbox generalization) — plugins/ask-user/package.json (@hachej/boring-ask-user)
pnpm --filter @hachej/boring-ask-user run typecheck
pnpm --filter @hachej/boring-ask-user run test

# repo-wide boundary + plugin invariants (root package.json)
pnpm lint:workspace-plugin-invariants   # pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
pnpm audit:imports                       # tsx scripts/audit-imports.ts — no core-internal / platform-addressing leak
pnpm typecheck                           # build:packages then per-pkg typecheck

# workspace playground e2e harness — apps/workspace-playground/package.json
pnpm --filter workspace-playground run test:e2e

# Manual proof (workspace playground): declare two agents, open the agent inspector, confirm /info renders
# read-only with no secrets; create a session, mark it slack-origin, confirm the badge + origin filter; raise a
# pending request and answer it from the inbox. Rebuild dist first (see run-workspace-playground recipe).
```

## Review gates

- The **Fleet page** consumes only `GET /api/v1/agents` plus `GET /api/v1/agents/:agentId/info`, lists every declared agent with a per-agent drill-down (sessions, pending approvals, environments), is read-only (no authoring), renders no secret/handle, and registers as a `workspace-page` through the existing `PanelRegistry`/`WorkspaceSourceRegistry` (not a new host); the fleet-widget extension point is deferred (farm epic), not built.
- Cross-surface sessions surface in the **existing** `SessionBrowser`/`SessionList` via an origin badge + filter; transcript viewing reuses `PiChatPanel`/`RemotePiSession` by `sessionId` (assert no new viewer).
- `SessionSummary.originSurface` is additive/optional; existing JSONL sessions load unchanged (default workspace).
- Central inbox is the **generalized ask-user `InboxOverlay`** on the single T1 `resolveInput` path; the ask-user-only pending channel is deleted, not paralleled; any temporary `TODO(remove:*)` marker names its deletion-owner bead and is gone before that owner phase closes.
- Preserve the current ask-user UI placement unless a bead explicitly changes it: `QuestionForm` remains placement `"center"`, and the inbox remains an `appLeftActions` overlay; do not create a second workspace-page inbox.
- Public contracts only — no core-internal import, no private hook, no platform addressing in any UI signature (`pnpm audit:imports` green).
- Agent-as-directory authoring is **not** present (deferred post-P7); the inspect panel exposes no create/configure controls.
- No new UI framework or registry; new surfaces register via `definePlugin`.
- Any transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later owner is allowed only when explicitly named per [`../../INDEX.md`](../../INDEX.md), and no marker outlives its named owner's phase.
