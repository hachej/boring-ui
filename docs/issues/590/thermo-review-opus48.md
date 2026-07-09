# Thermonuclear Adversarial Review — Issue #590 `boring-automation` plugin

Plan reviewed: `docs/issues/590/plan.md`
Reviewer stance: extremely strict. Blockers first.

## Verdict

**NOT READY as a whole plan. Slice 1 is conditionally ready-to-start** (file store + shell + CRUD routes) once the two Slice-1-scoped fixes below are applied. Slices 3, 4, and 5 are **not ready**: they rest on unconfirmed server seams that the plan itself lists as open questions but does not gate hard enough. The plan is honest about its residual risk ("adversarial review timed out") — this review closes several of those gaps with concrete findings.

The good news: most of the seams the plan is nervous about **do exist**, but not in the shape the plan assumes. That changes the design, so they must be confirmed before the dependent slices are coded, not during.

---

## Blocking findings

### B1. No background-service / lifecycle seam for the scheduler (Slice 3)
`WorkspaceServerPlugin` (`packages/workspace/src/server/plugins/defineServerPlugin.ts`) exposes only: `routes: FastifyPluginAsync`, `agentTools`, `piPackages`, `extensionPaths`, `systemPrompt`, `skills`, `workspaceBridgeHandlers`, `provisioning`, `assets`, `preservedUiStateKeys`. There is **no `onStart`/`onReady`/`dispose` hook** and no supported long-running service lifecycle. A cron loop (`scheduler.ts`) therefore has nowhere clean to live except a `setInterval` smuggled into the `routes` async registration, with no disposal path (leaks timers across reload/test, no graceful shutdown). This is a genuine missing host seam, not an implementation detail.
- **Fix:** Before Slice 3, decide the scheduler host model. Either (a) add a first-class lifecycle hook to `WorkspaceServerPlugin` (a core/workspace change — contradicts the plan's "additive, plugin-contained, no core changes" claim and must be called out), or (b) drive ticks from an external trigger (host cron → `Run now` route) so the plugin owns no timer. Option (b) fits hosted/serverless far better and should probably be the MVP. The plan must pick one; today it silently assumes an in-process timer exists.

### B2. Session-launch seam is assumed, not verified — and it is server-plugin-hostile (Slice 3)
The plan commits `server/sessionLauncher.ts` and lists "launch a session with a specific model" as an *open* question, yet marks the shell slice ready and only defers to Slice 3. The real seam:
- Session creation + prompt submission is `PiChatSessionService` in `packages/agent/src/server/pi-chat/harnessPiChatService.ts`, driven through routes in `packages/agent/src/server/http/routes/piChat.ts` (`POST /api/v1/agent/pi-chat/:sessionId/prompt`).
- Sessions are created lazily via `getOrCreateRuntimeBinding` per workspace/session inside the agent runtime; there is **no clean public "create headless session" API** exposed to a plugin's Fastify routes. Plugin `routes` are boot-composed and receive a raw Fastify instance — they do **not** receive the `PiChatSessionService`, the runtime binding, or a workspace-scoped context object.
- **Model override does exist**: `PromptPayload.model` is honored (`harnessPiChatService.ts:208` `model: adapter.currentModel?.() ?? payload.model`; `:574`). So the *model* question is largely answered — but only through the prompt path, which still needs a session + runtime binding first.
- **Fix:** De-risk this seam in a spike *before* Slice 3, and do not create `sessionLauncher.ts` in Slice 1. The plugin needs a supported way to (1) mint a sessionId, (2) obtain/create the runtime binding, (3) submit a prompt with `{ model }`, headless (no browser). If that requires a new exported service or a `workspaceBridgeHandlers` contribution, that is a core/agent change and breaks the "plugin-contained" framing — call it out and scope it.

### B3. Hosted execution model assumption is unverified (affects the entire hosted half)
The plan asserts a "hosted mode: plugin-owned DB tables" and "before hosted release" without confirming how hosted actually runs. Two hard constraints from the repo:
- `PLUGIN_SYSTEM.md §1.1`: plugin tool `execute()` runs in the host Node process and **"plugin loading is local-mode-only (skipped under `vercel-sandbox`)."** `createWorkspaceAgentServer.ts:781` branches on `resolvedMode === "vercel-sandbox"`. If hosted == vercel-sandbox, a background in-process scheduler and even plugin server composition may not run as assumed.
- `AGENTS.md` rule 8: session transcripts are **host app user data stored on a durable volume via `BORING_AGENT_SESSION_ROOT` (file-backed), not in a DB**, in both modes. The plan's "runs reference `sessionId`, don't duplicate transcripts" is correct and consistent with this — but the plan should explicitly state that hosted transcripts remain file/volume-backed and only *automation metadata* is in Postgres, to avoid a future author "helpfully" moving transcripts into the DB.
- **Fix:** Confirm the concrete hosted topology (persistent Node service vs serverless/vercel-sandbox, single vs multi-instance) before committing Slice 4. This determines whether B1's timer model and B4's locking are even viable. This is the single biggest hidden assumption in the plan.

### B4. Hosted Postgres store has zero prior art in this repo — Slice 4 is under-specified and oversized
`grep` across `plugins/**` shows **no existing Postgres/Drizzle/migration usage** (`boring-governance/metering.ts` is the closest and is not a DB). There is no established plugin-owned DB connection, migration runner, or schema-ownership convention. The plan leaves "which hosted migration mechanism" as an open question while Slice 4 bundles: schema + `PostgresAutomationStore` + hosted composition wiring + advisory-lock duplicate-run protection + shared conformance tests. That is 4–5 review-worthy concerns in one slice with **no precedent to copy**.
- **Fix:** Split Slice 4 into (4a) DB connection + schema + migration ownership decision + `PostgresAutomationStore` passing the shared conformance suite; (4b) hosted composition wiring; (4c) duplicate-run locking (advisory lock/lease). Resolve the migration-mechanism open question as a prerequisite, not inside the slice. Given no prior art, expect this to spawn a core/hosted-infra decision.

### B5. Workspace scoping of the file store is contradictory
`Automation.workspaceId` and every store method takes `workspaceId`, but the file store path is `.pi/automation/` (already workspace-relative and single-tenant in CLI). In hosted/multi-tenant, the file store is not used at all (Postgres is). So `workspaceId` in the file path/JSON is dead weight in CLI and the file store can never be correctly multi-tenant. Meanwhile plugin `routes` are boot-time and the plan never specifies **how a route resolves the current `workspaceId`** — agent routes use a `getWorkspaceId` request hook (`registerAgentRoutes.ts`), but plugin routes are separate and this wiring is unspecified.
- **Fix:** Specify workspace resolution for plugin routes explicitly (request hook / decorator). Decide whether `workspaceId` is a store-level concern (Postgres) or a routing-level concern (file store is implicitly single-workspace). Don't carry `workspaceId` in the file layout unless there is a real multi-workspace-per-tree case.

---

## Non-blocking findings

### N1. Inbox chat-popover reuse seam exists — cite it, don't leave it open
The plan lists "exact UI seam for opening the same chat/session popover" as open. It exists: `WorkspaceShellCapabilities.openDetachedChat(sessionId)` and `openChatPane(sessionId)` in `packages/workspace/src/app/front/useWorkspaceShellCapabilitiesController.ts` / `WorkspaceShellCapabilitiesHost.tsx`. `openArtifact(..., { sessionId })` also routes a chat pane. Confirm these are reachable from a plugin front (ask-user's Inbox uses `shell.openInboxArtifact`); if `openDetachedChat` isn't yet on the plugin-facing shell API, exposing it is a small workspace change. Update the plan to name this seam.

### N2. "Inbox visual language" is not a shared package — reuse ≠ free
The Inbox row/section components (`InboxRow.tsx`, `InboxSection.tsx`, `InboxDetailPanel.tsx`) live **inside `plugins/ask-user/src/front/inbox/`**, not in `packages/ui`. "Use the same visual language as Inbox, one block = one session/run" therefore means either duplicating those components in `boring-automation` (drift risk) or extracting them to a shared UI location (cross-plugin coupling / scope creep). The plan's "avoid duplicated transcript rendering" doesn't address run-row rendering. Decide and state it.

### N3. Token accounting seam exists — reference it
Usage/metering is real: `packages/agent/src/server/pi-chat/metering.ts`, `plugins/boring-governance/src/server/metering.ts`, and `model`/usage fields in `packages/agent/src/shared/events.ts` / `config-schema.ts`. "Best-effort later" is a fine call, but the plan should point at the metering seam so token totals aren't reinvented, and should note whether per-session usage is queryable after the fact or must be captured during the run.

### N4. Run status lifecycle vs. crash recovery
`AutomationRun.status` includes `queued`/`running` but the plan has no story for runs left `running` after a crash/redeploy (very likely in serverless). Add a reconciliation/timeout rule (e.g., stale-`running` → `failed`) to the scheduler/store slice, or runs will wedge.

### N5. Cron correctness details unspecified
Timezone + cron are stored, but there's no statement on catch-up/missed-tick semantics (was the box down? run once, skip, or backfill?), overlap policy (skip if previous run still `running`?), or DST handling. These are exactly where cron schedulers rot. At minimum specify: no backfill, skip-if-overlapping, and which cron library + timezone lib. "Avoid testing cron library internals" is fine, but the *policy* must be tested.

### N6. Snapshot scope
`promptSnapshot`/`modelSnapshot` are good, but timezone and cron are not snapshotted. If history should be "truthful after edits," a run arguably should also record the schedule/timezone it fired under. Minor, but decide deliberately.

### N7. `Run now` visibility open question is a Slice-3 blocker in disguise
Whether `Run now` is user-visible or test-only changes the front slice and the routes' auth surface. The scheduler slice's testability depends on it existing regardless. Resolve to: `Run now` route always exists (needed for deterministic tests); UI exposure is a separate toggle.

### N8. Conformance-test claim vs. reality
The plan promises "shared conformance tests for both stores" but the Postgres store lands two slices later. Ensure the conformance suite is authored in Slice 1 against `AutomationStore` and the file store, so the Postgres store in Slice 4 is validated against an already-frozen contract (prior art: `plugins/ask-user/src/server/__tests__/testAskUserStore.ts` uses a shared store test pattern).

---

## Recommended plan edits

1. **Add a "Seam confirmation" pre-slice** (spike, no ship) resolving B1/B2/B3 with cited code before Slice 3: scheduler host model, headless session-launch API, hosted topology. Convert the current "Open Questions" into explicit gates with owners.
2. **Remove `server/sessionLauncher.ts` from the Slice 1 file tree.** Slice 1 must be storage + CRUD + conformance tests only, with zero dependence on session/runtime internals.
3. **State the core/workspace changes honestly.** The plan claims "additive, plugin-contained, no core changes," but B1 (lifecycle hook) and likely B2 (exported session-launch seam) require workspace/agent changes. Update the "Wide Refactor Strategy"/"Decisions" sections accordingly, or redesign to a host-cron-trigger model that keeps it plugin-contained.
4. **Split Slice 4** into 4a store+schema+migration-decision, 4b hosted wiring, 4c locking. Make "migration mechanism" a prerequisite decision, not an in-slice open question.
5. **Author the shared store conformance suite in Slice 1** against the file store; reuse it verbatim for Postgres (cite `testAskUserStore.ts` pattern).
6. **Name the confirmed seams** in the plan body: `openDetachedChat`/`openChatPane` (N1), `PromptPayload.model` for model override (B2), metering (N3), `getWorkspaceId` request-scoping pattern (B5).
7. **Add run-lifecycle robustness** to the scheduler slice: stale-`running` reconciliation (N4), overlap/backfill/DST policy with tests (N5).
8. **Resolve `workspaceId` scoping** (B5): drop it from the file layout or justify multi-workspace-per-tree; specify plugin-route workspace resolution.
9. **Decide Inbox-row reuse** (N2): duplicate vs. extract-to-shared, with the scope cost stated up front.
10. **Keep token totals out of Slice 5's polish bucket if the usage seam is confirmed** (N3) — otherwise honor the plan's own "split token work into a separate plan" escape hatch. Slice 5 currently mixes token aggregation, formatting, filters/sorting, and popover integration — split polish from token accounting.

---

## Slice-sizing assessment

- **Slice 1 (shell+file store+routes):** appropriately sized. Ready to start after edits #2 and #8. Add conformance suite (#5).
- **Slice 2 (front UI):** OK, but blocked on N1/N2 decisions to avoid rework.
- **Slice 3 (scheduler+session launch):** **too risky as written**; gated by B1/B2 spike. The plan's own "exceeds if seam missing" note is correct — the seam is effectively missing.
- **Slice 4 (hosted Postgres):** **oversized**; split per B4/#4. Highest overall risk (no prior art + B3).
- **Slice 5 (token+polish):** mixed concerns; split token accounting from UI polish (#10).

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Delivered a review-only adversarial assessment of docs/issues/590/plan.md; no source files edited. Findings scoped strictly to the requested plan review dimensions."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Findings cite concrete repo evidence: defineServerPlugin.ts (no lifecycle hook), harnessPiChatService.ts:208/:574 + piChat.ts (model override / session seam), PLUGIN_SYSTEM.md §1.1 + createWorkspaceAgentServer.ts:781 (vercel-sandbox), AGENTS.md rule 8 (file-backed sessions), useWorkspaceShellCapabilitiesController.ts (openDetachedChat/openChatPane), metering.ts (usage seam), absence of Postgres/migration prior art in plugins/**."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/47920035/docs/issues/590/thermo-review-opus48.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grep/find across plugins, packages/agent, packages/workspace for store/session/scheduler/shell seams",
      "result": "passed",
      "summary": "Identified missing lifecycle hook, session-launch seam shape, model-override support, chat-popover capability, and lack of Postgres prior art"
    }
  ],
  "validationOutput": [
    "defineServerPlugin.ts exposes routes/agentTools/provisioning but no onStart/dispose lifecycle hook",
    "harnessPiChatService.ts:208 honors payload.model -> model override supported via prompt path",
    "plugin routes do not receive PiChatSessionService/runtime binding -> headless session launch seam unconfirmed",
    "PLUGIN_SYSTEM.md §1.1: plugin loading skipped under vercel-sandbox; createWorkspaceAgentServer.ts:781 branches on vercel-sandbox",
    "no Postgres/migration prior art found under plugins/**",
    "WorkspaceShellCapabilities.openDetachedChat/openChatPane is the chat-popover reuse seam"
  ],
  "residualRisks": [
    "Hosted topology (persistent vs serverless) not confirmed by me from runtime; conclusions on scheduler/locking depend on it",
    "Whether openDetachedChat is currently exposed on the plugin-facing front API not fully traced",
    "Exact plugin-route workspace resolution wiring not fully traced"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added one review artifact file; no code changes.",
  "reviewFindings": [
    "blocker: plan.md Slice 3 - no WorkspaceServerPlugin lifecycle/background-service seam for scheduler (defineServerPlugin.ts)",
    "blocker: plan.md Slice 3 - headless session-launch seam unconfirmed; sessionLauncher.ts should not be in Slice 1 (harnessPiChatService.ts/piChat.ts)",
    "blocker: plan.md hosted - execution topology (vercel-sandbox vs persistent) unverified; drives scheduler/locking viability (PLUGIN_SYSTEM.md §1.1)",
    "blocker: plan.md Slice 4 - no Postgres/migration prior art; slice oversized and migration mechanism unresolved",
    "blocker: plan.md - workspaceId scoping contradictory and plugin-route workspace resolution unspecified",
    "non-blocking: chat-popover seam exists (openDetachedChat/openChatPane) - cite it",
    "non-blocking: Inbox row components live in ask-user plugin, not shared - reuse requires duplication or extraction",
    "non-blocking: token/metering seam exists; run crash-recovery, cron overlap/backfill/DST policy, and Slice 5 concern-mixing need edits"
  ],
  "manualNotes": "Slice 1 is startable after removing sessionLauncher.ts from its scope and authoring the shared store conformance suite. Slices 3/4/5 need a seam-confirmation spike first. The plan's 'additive, no core changes' claim is likely false given the missing lifecycle and session-launch seams; that framing should be corrected before dependent slices."
}
```
