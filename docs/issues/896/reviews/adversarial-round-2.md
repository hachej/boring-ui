# Adversarial Plan Review — Round 2 (gh-896)

Scope: revised `docs/issues/896/plan.md` vs. round-1 review and current code. Focus: `onListen`/non-listening semantics, AgentHost lifecycle ownership, binding admission ordering, worker failure handling, privileged-plugin provenance, Automation event-bus/SSE ownership, test/proof feasibility. No edits made.

## Review

### Correct — round-1 blockers are integrated and grounded

- **Readiness placement fixed.** Startup is now `onListen` after successful readiness, with an explicit non-listening start method; "partial readiness failure aborts started workers" is replaced by "readiness failure starts no worker" (`plan.md` Decision 3, Failure policy, Test seam 1). This matches Fastify reality: `onListen` fires only after `app.ready()` succeeds and the server listens.
- **Provenance enforcement moved to the resolver.** The plan generalizes `assertWorkspaceBridgeHandlersTrusted` into an entry-bound privileged check in both resolution loops before `entry` is dropped. This is implementable exactly as written: both loops already hold `plugin` + `entry` and already call the bridge assertion at `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:814` and `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:998`, and `isTrustedWorkspaceBridgeHandlerEntry` already encodes "prebuilt object OR `trust: "internal"` dir entry" (`packages/workspace/src/app/server/pluginEntryResolver.ts:151-158`). Default Automation entries are `{ dir, hotReload: true, trust: "internal" }` (`createCoreWorkspaceAgentServer.ts:976`), so the "trusted, boot-time, hotReload-is-not-authority" policy admits Automation and rejects untrusted dir entries.
- **Native abort-listener containment claim dropped.** The plan now makes non-throwing abort listeners a worker conformance rule and normalizes `run()` throws/rejections into `AgentHostWorkerError` with stable code and no raw message/stack. Correct given Node surfaces `AbortSignal` listener throws via `uncaughtException`.
- **SSE proof corrected.** The proof no longer promises the closing SSE stream receives the terminal invalidation; it asserts prompt stream termination + durable terminal state observed after reconnect/restart. Consistent with the hijacked long-lived route (`plugins/boring-automation/src/server/routes.ts`).
- **Lifecycle API frozen.** `CreateAgentHostOptions.hostWorkers` + `startWorkers/beginDrain/drain/close`, no worker fields on HTTP projection options, `created -> running -> aborting -> drained -> closed` with all-settled advance-on-error. Matches the existing two-phase binding lifecycle (`startDraining` = admission close, `closeBindings` = full close) at `packages/agent/src/server/agentHostLegacyRouteRuntime.ts:288-290`, so the `drain -> startDraining`, `close -> closeBindings` mapping is realizable.

### Blocker (P1) — Automation event-bus ownership cannot be inferred from `options.eventBus`; the two-layer construction defeats the plan's ownership rule

- Plan Decision 9 requires: the worker owns disposal of the *internally created* bus (including scheduler-disabled mode), while "callers injecting an event bus own and close that bus," and route mounting never closes the bus.
- Grounding: composition is split across two functions. `defaultBoringAutomationServerPlugin` creates the hosted bus and passes it *inward* as `options.eventBus`: `const eventBus = options?.eventBus ?? new PostgresAutomationRunEventBus(sql)` then `createBoringAutomationServerPlugin({ ..., eventBus, ... })` (`plugins/boring-automation/src/server/index.ts:140,147`). Inside `createBoringAutomationServerPlugin`, ownership would be inferred as `const eventBus = options.eventBus ?? new InMemory...` (`index.ts:44`). So the composition-created Postgres bus is indistinguishable from a genuinely caller-injected bus.
- Consequence of the naive rule:
  - If the worker closes only when `options.eventBus === undefined`: the hosted Postgres bus (the real production path) is never closed by the worker → resource leak, and Decision 9's "worker owns disposal including scheduler-disabled mode" is unmet.
  - If the worker always closes `options.eventBus`: external direct-mount callers who inject a bus have it closed under them → violates "callers injecting an event bus own and close that bus."
  - Today's code sidesteps this by closing the bus unconditionally in the route `onClose` (`index.ts:91`), which the plan removes.
- **Exact revision:** Add an explicit ownership signal threaded from the composition layer, not inferred from presence of `options.eventBus`. Give `createBoringAutomationServerPlugin` an explicit input such as `eventBusOwner: "composition" | "caller"` (or `ownsEventBus: boolean`). `defaultBoringAutomationServerPlugin` sets composition-owned when it constructs the Postgres/in-memory bus itself; external direct-mount callers default to caller-owned. The contributed worker's `try/finally` closes the bus exactly once only when composition-owned; direct route mounting and caller-injected buses are never closed by Automation. State this ownership flag in Decision 9 and in the Automation section of "Files and Responsibilities."

### Blocker (P1) — The exact preClose/onClose → Host-method mapping is unpinned and conflicts with the existing addressed projection, risking Test seam #13

- Plan claims one lifecycle implementation shared by both legacy and addressed projections (Decision 4; Test seam AgentHost #13 "both legacy and addressed-only projections share the same lifecycle behavior"), and introduces `beginDrain` specifically because it "must return promptly and is safe in timed `preClose`" while `drain` performs the worker join.
- Grounding: the addressed projection today runs the *full* drain in `preClose` and close in `onClose`: `app.addHook('preClose', async () => await input.host.drain())` / `onClose -> host.close()` (`packages/agent/src/server/agent-host/httpProjection.ts:400-407`). The legacy projection instead splits work across `preClose` (begin) and `onClose` (drain + closeBindings + close) (`packages/agent/src/server/agent-host/createAgentHost.ts:476-524`). If the new `drain()` implicitly aborts-and-joins workers, then the addressed path would perform the heavy worker join inside `preClose` while the legacy path performs it in `onClose`. That is two different lifecycle behaviors, directly contradicting Decision 4 and Test #13, and it re-opens the "prompt preClose" intent that motivated `beginDrain`.
- The plan text ("`httpProjection.ts` — Use the common Host lifecycle phases") does not state which method each hook calls, so an implementer cannot satisfy #13 unambiguously.
- **Exact revision:** Pin the identical hook→method mapping for *both* projections in the plan, e.g.: `preClose -> host.beginDrain()` (prompt, abort only); `onClose -> await host.drain(); await host.close()`. Update `httpProjection.ts` (addressed path) from `preClose: host.drain()` to `preClose: host.beginDrain()` and add `onClose: host.drain()` before `host.close()`. Add this file/line to "Files and Responsibilities" and add an explicit assertion to Test #13 that both projections invoke the same phase sequence (abort in preClose, join+drain+close in onClose). If instead the intended design is join-in-preClose, say so explicitly and drop the "beginDrain is for timed preClose" rationale — but do not leave it implied.

### Note (P2) — Automation worker must be constructed at plugin-body scope, not inside the `routes` closure

- Today the scheduler is created lazily inside the `routes` async closure (`plugins/boring-automation/src/server/index.ts:92-100`), and `eventBus`/`hostedDueCoordinator` are already at plugin-body scope (`index.ts:44,57-60`). To contribute a `hostWorkers` entry, scheduler construction and the worker's `run()` must live at plugin-body scope so the intent is declarable on the returned plugin object, sharing the same `hostedDueCoordinator` the routes use. The worker should take its logger from the `run()` context (`AgentHostWorkerLogger`), not `app.log`. Feasible with the existing `HostedAutomationScheduler` (`beginShutdown`/`drain`/`stop` already exist in `hostedScheduler.ts`), but the plan should explicitly note the scope move so the worker doesn't depend on route registration having run.

### Note (P2) — Name the non-listening explicit-start caller, or state it is test-only

- Decision 3 requires non-listening/injected apps to call `startWorkers` explicitly "after their complete readiness barrier," but names no in-repo caller. In practice every production embedding listens (`createAgentApp` returns an app the caller listens on; Core listens), so the explicit path appears to be exercised only by AgentHost contract tests and Automation unit tests that drive `host.startWorkers` directly. State this plainly: no production non-listening embedding exists in-repo; the explicit start is a test/embedder affordance. If any real injected embedding is intended, add its composition function to "Files and Responsibilities." Otherwise an implementer may hunt for a production caller that does not exist.

### Note (P2) — Confirm single legacy binding lifecycle owner on the Host

- Only the legacy projection registers a binding lifecycle (`agentHostLegacyRouteRuntime.ts:288`; addressed routes use per-request bindings and `manageLifecycle`). The plan's "register the internal legacy projection lifecycle into Host at mount time" is fine, but the plan should assert the Host holds at most one legacy binding lifecycle and that a second registration throws (mirrors the existing `'legacy route lifecycle already registered'` guard at `createAgentHost.ts:531`), so `drain()`'s "close binding admission" step has an unambiguous target.

### Note (P2) — Boot-validation wording is now correct; keep the proof searches honest

- Failure policy correctly limits boot validation to array/object shape, safe local id, callable `run`, duplicate final id, and thenable-at-invocation, deferring "remains pending until abort" to contract tests. Good. Ensure the Proof `rg` guard also greps for the *new* forbidden duplicate owners the plan promised (no `scheduler.*onReady|scheduler.*onClose`, no plugin-route `eventBus.close`, no worker arrays on HTTP projection options) — the current Proof block covers the first two but should also assert no `hostWorkers` on projection option types.

## Verdict

**NOT CLEAN (close).** Round-1 blockers are fully integrated and grounded. Two residual P1 implementability gaps remain before this is ready for an agent: (1) Automation event-bus ownership must be an explicit composition-vs-caller signal, because the two-layer plugin construction defeats inference from `options.eventBus`; and (2) the preClose/onClose→Host-method mapping must be pinned identically for the legacy and addressed projections and reconciled with the existing `httpProjection.ts` drain-in-preClose behavior, or Test seam #13 and the "prompt preClose" rationale conflict. The P2 notes (worker scope move, non-listening caller naming, single-lifecycle guard, proof searches) should be folded in but are not blocking.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Two P1 blockers and four P2 notes returned with exact file paths/lines: plugins/boring-automation/src/server/index.ts:44,91,140,147 (event-bus ownership inference); packages/agent/src/server/agent-host/httpProjection.ts:400-407 and createAgentHost.ts:476-524 (unpinned preClose/onClose mapping vs Test #13); plus provenance grounding at pluginEntryResolver.ts:151-158, createWorkspaceAgentServer.ts:814, createCoreWorkspaceAgentServer.ts:976,998."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Read plan.md and adversarial-round-1.md; inspected boring-automation index.ts/hostedScheduler.ts, agent createAgentHost.ts/createAgentApp.ts/httpProjection.ts, workspace pluginEntryResolver.ts/bootstrapServer.ts/createWorkspaceAgentServer.ts, core createCoreWorkspaceAgentServer.ts.",
    "Confirmed round-1 blockers (onListen, provenance-at-resolver, non-throwing abort, SSE proof, frozen lifecycle API) are integrated and code-grounded.",
    "Confirmed residual P1: hosted event bus is created in defaultBoringAutomationServerPlugin (index.ts:140) and passed inward as options.eventBus (index.ts:147), so createBoringAutomationServerPlugin (index.ts:44) cannot infer composition-vs-caller ownership.",
    "Confirmed residual P1: addressed projection runs host.drain() in preClose (httpProjection.ts:400-407) while legacy path splits begin/drain across preClose/onClose (createAgentHost.ts:476-524), conflicting with Test seam #13 and the beginDrain-for-preClose intent."
  ],
  "residualRisks": [
    "P1: Automation event-bus disposal ownership is ambiguous under the two-layer plugin construction; naive inference either leaks the hosted Postgres bus or closes caller-injected buses.",
    "P1: Unpinned preClose/onClose -> Host-method mapping across legacy vs addressed projections risks divergent lifecycle behavior and failing Test seam #13.",
    "P2: Worker must be hoisted from the routes closure to plugin-body scope and take its logger from run() context.",
    "P2: No named in-repo non-listening startWorkers caller; likely test-only and should be stated.",
    "P2: Single legacy binding-lifecycle owner on Host should be asserted; extend proof rg guards to new forbidden owners."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes; review-only output written to docs/issues/896/reviews/adversarial-round-2.md via the authoritative artifact path.",
  "reviewFindings": [
    "blocker: plugins/boring-automation/src/server/index.ts:44,140,147 - event-bus ownership cannot be inferred from options.eventBus because the default wrapper creates the bus and passes it inward; add an explicit composition-vs-caller ownership signal so the worker closes only the composition-owned bus.",
    "blocker: packages/agent/src/server/agent-host/httpProjection.ts:400-407 vs createAgentHost.ts:476-524 - pin identical preClose(beginDrain)/onClose(drain+close) mapping for both projections; current addressed path drains in preClose, conflicting with Test seam #13 and the beginDrain-for-prompt-preClose intent.",
    "note: plugins/boring-automation/src/server/index.ts:92-100 - move scheduler/worker construction out of the routes closure to plugin-body scope; take logger from run() context.",
    "note: plan.md Decision 3 - name the non-listening explicit startWorkers caller or state it is test-only; no production non-listening embedding exists in-repo.",
    "note: packages/agent/src/server/agent-host/createAgentHost.ts:531 - assert a single legacy binding lifecycle owner on Host; extend Proof rg guards to hostWorkers-on-projection-options and plugin-route eventBus.close."
  ],
  "manualNotes": "Round-1 revisions are well integrated and code-grounded; the plan is close to implementation-ready. The two P1 items are narrow, mechanical specification gaps rather than directional flaws. Recommend resolving both plus folding the P2 notes before flipping to ready-for-agent."
}
```
