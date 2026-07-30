# Adversarial Plan Review — Round 3 (gh-896)

## Review

- **Blocker (P1, marginal lifecycle revision): `onClose: drain+close` does not guarantee `close()` after the specified rejecting drain.** The plan requires `drain()` to advance to `drained` and then reject on a worker failure, while `close()` must still close bindings/resources and reject with the retained first failure (`docs/issues/896/plan.md:97,186-187`). But the pinned hook mapping says only “`host.drain()` followed by `host.close()`” (`docs/issues/896/plan.md:101,265`). A direct pair of awaits—the natural extension of the current hooks at `packages/agent/src/server/agent-host/httpProjection.ts:402-407`—skips `close()` when `drain()` rejects, violating cleanup tests 9 and 15 (`plan.md:261,267`). **Required revision:** pin an error-safe mapping, preferably `try { await host.drain() } finally { await host.close() }`, and specify that a terminal/repeated `drain()` or `close()` rethrows the retained normalized first failure while keeping `drained`/`closed` state. Alternatively, map `onClose` only to `host.close()` because `close()` already implicitly drains; then revise Test 13 accordingly. Do not leave this to projection-local aggregation.

- **Blocker (P1, marginal failure-policy revision): “partial explicit startup failure” contradicts the uniform unexpected-exit policy and has no implementable boundary.** The contract says every worker starts once and an early resolve/reject is logged without crashing or restarting the app (`docs/issues/896/plan.md:51-56,89,138-140`), but explicit non-listening startup alone allegedly aborts and joins every invoked worker after a partial failure (`plan.md:141,263`). A declared `run()` that throws synchronously and an `async run()` that rejects before its first `await` are equivalent worker failures once normalized; “immediate rejection” has no reliable timing boundary. The API sketch also calls `startWorkers` without awaiting it (`plan.md:80-85`), so “joins” has no defined completion contract. **Required revision:** use one rule for listening and explicit starts: invoke every declared worker, immediately attach settlement observers, normalize/retain any throw, rejection, non-Promise result, or pre-abort resolve, but do not abort healthy peers until `beginDrain`. Remove line 141/Test 11 and replace them with a test that one synchronous throw does not prevent later declarations from being invoked and all started workers are subsequently aborted/joined. If startup-wide abort is truly desired, define `startWorkers(): Promise<void>`, the exact setup-failure boundary, all-worker invocation behavior, and identical `onListen` semantics; that is the more complex option and conflicts with the stated availability policy.

- **Required (P1, marginal error-semantics revision): normalized error retention and stable lifecycle codes remain incomplete.** Unexpected normal resolution is called a failure (`docs/issues/896/plan.md:56,190,405`), but normalization explicitly covers only synchronous throws and rejections (`plan.md:148`); the plan does not say whether early resolution is retained and later propagated by `drain/close`. It should synthesize a safe `AgentHostWorkerError` with a stable unexpected-exit code and final worker id, observe/log it immediately, and retain it for lifecycle propagation. Also, `plan.md:97` calls duplicate legacy lifecycle registration an “existing stable lifecycle error,” but current code throws an uncoded `TypeError` (`packages/agent/src/server/agent-host/createAgentHost.ts:526-535`). Define a coded lifecycle/validation error rather than relying on that message. Tests should assert codes/worker ids and that normalized errors contain no raw cause/message/stack.

**Convergence verdict: NOT CLEAN, but structurally converged.** These are required marginal specification fixes, not a redesign. The `onListen` readiness boundary, `beginDrain`-before-admission ordering, explicit composition-vs-caller event-bus ownership (including scheduler-disabled disposal), and Slice 1 → 2 → 3 package dependencies are now coherent and implementable. No remaining structural blocker or event-bus/slice reorder was found.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Three concrete required revisions cite docs/issues/896/plan.md and current implementation lines in packages/agent/src/server/agent-host/httpProjection.ts and createAgentHost.ts; review also records which requested areas have converged."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/dfadff02/docs/issues/896/reviews/adversarial-round-3.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "nl -ba docs/issues/896/plan.md | sed -n '45,190p;230,410p'",
      "result": "passed",
      "summary": "Verified exact lifecycle, startup failure, test, and slice wording with line numbers."
    },
    {
      "command": "nl -ba packages/agent/src/server/agent-host/createAgentHost.ts packages/agent/src/server/agent-host/httpProjection.ts plugins/boring-automation/src/server/index.ts plugins/boring-automation/src/server/hostedScheduler.ts",
      "result": "passed",
      "summary": "Verified current admission flag behavior, projection hook mapping, uncoded duplicate lifecycle error, scheduler drain mechanics, and event-bus construction layers."
    },
    {
      "command": "pnpm --filter @hachej/boring-agent exec node <Fastify onListen rejection probe>",
      "result": "passed",
      "summary": "Confirmed Fastify listen resolves and remains listening when an async onListen hook rejects, reinforcing the need for an internally observed/non-throwing worker startup policy."
    },
    {
      "command": "git diff --check && git diff --cached --quiet",
      "result": "passed",
      "summary": "No whitespace errors and no staged changes."
    }
  ],
  "validationOutput": [
    "Round-1 and round-2 requirements are integrated: onListen startup, provenance-before-bootstrap, non-throwing abort listeners, explicit bus ownership, common projection phases, plugin-body worker scope, and single legacy lifecycle ownership.",
    "Current AgentHost admission closes through runtime.startDrain/draining (createAgentHost.ts:178,213-215,296-305); the revised plan correctly defers that until worker join.",
    "Scheduler-disabled composition can keep one pending resource-owner worker and close only a composition-owned bus on abort; no residual ownership contradiction was found.",
    "Slices are dependency-correct: Agent API first, composition/Automation migration second, obsolete branch-only API deletion and whole-app proof last."
  ],
  "residualRisks": [
    "A rejecting drain can skip final Host cleanup unless the Fastify onClose mapping is made error-safe.",
    "The undefined partial-start boundary can produce divergent listening versus explicit-start behavior and an infeasible timing-sensitive test.",
    "Early normal worker exit and duplicate legacy lifecycle registration still lack fully specified stable coded errors."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review artifact only; no source, test, or plan edits.",
  "reviewFindings": [
    "blocker: docs/issues/896/plan.md:97,101,186-187 - sequential onClose drain+close can skip close after the deliberately propagated drain error; require try/finally or close-only mapping.",
    "blocker: docs/issues/896/plan.md:51-56,89,138-141,263 - partial explicit startup failure conflicts with uniform early worker failure semantics and lacks a definable async boundary.",
    "required: docs/issues/896/plan.md:56,97,148,190 and packages/agent/src/server/agent-host/createAgentHost.ts:526-535 - synthesize/retain a coded error for early normal exit and replace the uncoded duplicate-lifecycle TypeError claim with a stable code."
  ],
  "manualNotes": "NOT CLEAN, but no structural redesign is needed. Event-bus ownership, onListen readiness, begin/drain admission ordering, test feasibility outside the listed failure-policy test, and slice dependencies have converged."
}
```
