I have verified all the key seams against the repo. Here is the review.

---

# Plan Review — Issue #590 `boring-automation` (revised plan vs. thermo-review-opus48)

## Verdict

**Slice 1 is ready to start.** The revision resolves every Slice-1-scoped fix from the prior review and correctly converts the deferred-slice risks (B1–B4) into an explicit **Slice 0 seam-confirmation gate** rather than optimistic assumptions. Three small precision edits remain (workspace-resolution mechanism, `openChatPane` naming, conformance-suite prior-art citation), none of which block Slice 1. Later slices are appropriately gated, not ready-to-code — as intended.

## Findings addressed

All prior findings are substantively addressed; I re-verified each against source:

- **B1 (no lifecycle/timer seam)** — Confirmed still true: `WorkspaceServerPlugin` exposes no `onStart`/`dispose` (`packages/workspace/src/server/plugins/defineServerPlugin.ts:28-54`). Plan now owns this (Decision 3, Known Seams line 166) and forbids a route-registration timer (Slice 4 line 313, Out of Scope line 408). Trigger model deferred to Slice 0. ✔
- **B2 (session launch assumed; sessionLauncher in Slice 1)** — `sessionLauncher.ts` explicitly removed from Slice 1 (line 37). Model override verified real: `harnessPiChatService.ts:208` (`model: adapter.currentModel?.() ?? payload.model`), cited at line 168. Headless launch gated to Slice 0 → Slice 3. ✔
- **B3 (hosted topology unverified)** — vercel-sandbox branching confirmed pervasive (`packages/agent/src/server/runtime/…`). Plan adds hosted-topology Slice 0 gate (line 226) and pins transcripts to `BORING_AGENT_SESSION_ROOT`, not Postgres (Decision 6, lines 74-76). ✔
- **B4 (Postgres oversized, no prior art)** — Confirmed: no Postgres/Drizzle/migration usage in `plugins/**` (only `boring-governance/metering.ts`, not a DB). Slice 4 split into 5a/5b/5c with migration ownership as a prerequisite (lines 323-363). ✔
- **B5 (workspaceId scoping contradictory)** — Addressed at type level (lines 103, "route/security concern… single-workspace") + Known Seams line 171 + Slice 1 line 256. See remaining edit #1 for the missing concrete mechanism. ✔ (partial)
- **N2/N3/N4/N5/N6/N7/N8** — Inbox local-duplication decided (Decision 9); metering seam cited (line 170) + Slice 6 gate; stale-`running` reconciliation (line 293); cron no-backfill/overlap/DST policy (lines 308-312); cron+timezone snapshots added to `AutomationRun` (lines 136-137); `Run now` always-present for tests (line 290); conformance suite authored in Slice 1 (line 244). ✔
- **Edit #3 (state core changes honestly)** — "Wide Refactor Strategy" now lists the generic workspace/agent seams that may be required (lines 393-401), replacing the old "no core changes" framing. ✔

## Remaining blockers

**None block Slice 1.** The genuine technical unknowns (scheduler trigger, headless launch, hosted topology, DB migration ownership) are correctly fenced behind the Slice 0 gate and Open Questions (lines 413-422). No unaddressed blocker survives.

## Required edits before Slice 1

1. **Cite the concrete workspace-resolution mechanism, don't just require it.** Plugin routes are registered bare — `for (const { routes } of pluginCollection.routeContributions) await app.register(routes)` (`packages/workspace/src/app/server/createWorkspaceAgentServer.ts:960-961`) — with no context object/decorator passed in. The available path is `request.workspaceContext?.workspaceId` (decorated in `packages/agent/src/server/http/middleware.ts:83`) or the `x-boring-workspace-id` header, falling back to `DEFAULT_WORKSPACE_ID` (`registerAgentRoutes.ts:147`). Slice 1 should name this and confirm the `workspaceContext` `onRequest` hook is in scope for these root-registered plugin routes, so the author doesn't invent a resolver.
2. **Correct the conformance-suite prior-art citation** (lines 180, 244). `plugins/ask-user/src/server/__tests__/testAskUserStore.ts` is a `MemoryAskUserStore` **test double**, not a shared conformance factory; `askUserStore.test.ts` tests `FileAskUserStore` directly with local helpers. There is **no** reusable store-conformance suite to copy — Slice 1 is authoring a new pattern. State that so no one hunts for a factory that isn't there. (The plan's intent is still correct and sound.)

## Required edits before later slices

3. **Slice 2 — fix `openChatPane` naming.** The plugin-facing `WorkspaceShellCapabilities` interface exposes only `openArtifact` and `openDetachedChat` (`packages/workspace/src/shared/plugins/workspaceShellCapabilities.ts:22-25`). `openChatPane` is **internal** to `useWorkspaceShellCapabilitiesController.ts` and is not reachable from a plugin front. Rewrite lines 169/276 to treat `openDetachedChat(sessionId)` as the **confirmed** seam and any `openChatPane` exposure as the "small generic capability" fallback the plan already contemplates.
4. **Slice 0 — keep the gate hard for 5a.** Line 330 correctly blocks Slice 5a on the hosted-topology answer; ensure the Slice 0 note (line 235 "must complete before Slice 3/4") also explicitly names 5a, since B3/B4 are the higher-risk consumers of that spike.

No other changes required. The plan is honest about residual risk and gates it correctly; ship Slice 1.
