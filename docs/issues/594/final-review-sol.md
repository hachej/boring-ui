# Final review — #594

## Findings

1. **High — link authorization is unspecified.** `docs/issues/594/plan.md:101,158` allows `link(... sessionId)` and the Link existing flow, but never requires the Tasks route/service to verify that the authenticated caller can access that session before persisting the binding. Require authorization through the shared session service at link time, with a stable not-found/forbidden policy.
2. **High — binding uniqueness and concurrent-write behavior are unspecified.** `docs/issues/594/plan.md:98-108` defines link/unlink and an “atomic JSON file,” but does not define whether `(workspaceId, adapterId, taskId, sessionId)` is unique/idempotent or how concurrent read-modify-write operations avoid lost updates. Without this, retries can duplicate counts and concurrent links/unlinks can discard records. Add invariants and conformance tests for both adapters.
3. **High — queued activity rollup remains contradictory/undecided.** `docs/issues/594/plan.md:118` includes processing a queued continuation in task working behavior, while `docs/issues/594/session-status-spike.md:80,112-116` recommends a distinct non-working `queued` state/rollup unless explicitly mapped. Specify exactly when queued work becomes `working` and pin it in bulk-activity and TaskCard tests.
4. **Medium — persisted-session state is not deterministic.** `docs/issues/594/plan.md:119` permits either `idle` or `unknown`, but `docs/issues/594/session-status-spike.md:68` recommends `idle` for the first implementation. Choose one rule (including `source`) so adapters, polling reconciliation, UI labels, and tests agree.
5. **Medium — a required title input is still open while the plan is marked ready.** `docs/issues/594/plan.md:311-317` leaves the canonical task display reference unresolved even though New chat and acceptance require a task-reference title prefix. Resolve the normalized field/fallback before Slice 3 to prevent adapter-specific title behavior.

## Residual risks

- The proposed live-runtime activity source is process-local; correctness in a multi-instance hosted deployment depends on session affinity or another shared activity mechanism, neither of which is stated.
- Standalone Pi activity remains intentionally undetectable and must not be presented as authoritative idle activity.

## Verdict

**NOT READY** — findings 1–3 require contract decisions before implementation.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Five concrete findings identify severity, exact document paths/lines, impact, and required resolution; residual risks are listed separately."
    }
  ],
  "changedFiles": [
    "docs/issues/594/final-review-sol.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff -- docs/issues/594/plan.md docs/issues/594/session-status-spike.md",
      "result": "passed",
      "summary": "Confirmed the reviewed documents had no working-tree diff; only a pre-existing untracked .pi-subagents/ entry was reported."
    }
  ],
  "validationOutput": [
    "Reviewed docs/issues/594/plan.md and docs/issues/594/session-status-spike.md in full.",
    "Verdict: NOT READY."
  ],
  "residualRisks": [
    "Process-local live activity may be incomplete in multi-instance hosted deployments without affinity or shared runtime state.",
    "Standalone Pi live activity is not detectable by the proposed design."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the required final-review report; no product or reviewed-document edits.",
  "reviewFindings": [
    "high: docs/issues/594/plan.md:101,158 - link-time session authorization is not required.",
    "high: docs/issues/594/plan.md:98-108 - binding uniqueness, idempotency, and concurrent update semantics are absent.",
    "high: docs/issues/594/plan.md:118 and docs/issues/594/session-status-spike.md:80,112-116 - queued-to-working semantics are unresolved.",
    "medium: docs/issues/594/plan.md:119 and docs/issues/594/session-status-spike.md:68 - persisted sessions may nondeterministically be idle or unknown.",
    "medium: docs/issues/594/plan.md:311-317 - canonical task title reference remains open despite ready-for-agent state."
  ],
  "manualNotes": "No source files or reviewed documents were edited."
}
```
