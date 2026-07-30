# Adversarial Plan Review — Round 4 (gh-896)

## Review

- **Correct:** All round-1 through round-3 architectural blockers are integrated. The plan now fixes startup at `onListen`, enforces trust before provenance is erased, requires non-throwing abort listeners, makes event-bus ownership explicit, pins `preClose -> beginDrain` / `onClose -> close`, uses one startup-failure policy, and retains stable terminal errors (`docs/issues/896/plan.md:49-58,76-151,180-190`). The Host API, tests, and Slice 1 → 2 → 3 dependency order are otherwise implementable.
- **Blocker (marginal, trust-test contradiction):** Decision 6 permits trusted directory entries regardless of `hotReload` and says re-imports never replace admitted workers (`docs/issues/896/plan.md:109-113`); composition tests repeat that policy at lines 273-274. But line 278 requires “generated/hot-loaded plugins cannot contribute workers.” In-repo internal defaults are directory entries with `hotReload: true` (`packages/workspace/src/app/server/createWorkspaceAgentServer.ts:794-797`), so the literal test rejects an allowed production path and revives round 1’s blocker. **Exact revision:** replace line 278 with “generated or untrusted directory plugins cannot contribute workers; `trust: "internal"` directory entries may contribute once at boot even when `hotReload: true`, and diagnostic re-imports cannot replace them.”
- **Blocker (marginal, proof gate is non-executable as claimed):** The obsolete-API guard scans `docs`, but this plan and rounds 1-3 intentionally contain the forbidden names; it currently returns 38 matches, including `docs/issues/896/plan.md:29,33,306,331`. This also makes Acceptance line 306 (“no ... remains in ... docs”) impossible while issue history is retained. Separately, the scheduler-owner regex at line 332 is a false negative: it returns no matches even though the current duplicate hooks are present as `app.addHook("onReady", ... scheduler...)` and `app.addHook("onClose", ... scheduler...)` at `plugins/boring-automation/src/server/index.ts:99-100`, because the regex requires `scheduler` to precede the hook name on the same line. **Exact revision:** (1) qualify Acceptance as implementation source/current API docs/tests, excluding `docs/issues/896/**`; (2) exclude that issue-history directory from the obsolete-name guard; (3) replace the scheduler guard with a fail-on-match hook guard such as `if rg -n "addHook\\(['\"]on(Ready|Close)['\"]" plugins/boring-automation/src/server/index.ts; then exit 1; fi`; and (4) express all expected-empty `rg` guards as fail-on-match commands so successful proof exits zero.
- **Blocker (marginal, lifecycle-order contradiction):** The Problem calls the current order correct and places all plugin-owned resource closure after AgentHost drain (`docs/issues/896/plan.md:13-18`), while the normative design waits for the worker lifetime—including event-bus closure—before AgentHost admission/runtime drain (`plan.md:57,91,125-131`). The event bus is explicitly plugin/worker-owned, so both orders cannot be preserved. **Exact revision:** align the Problem sequence with the selected design: stop worker admission; join the admitted tick; close worker-owned resources needed only by that worker; then close AgentHost admission/drain/close. If resource-after-Host ordering is actually required, event-bus disposal must instead be moved out of the worker lifetime; the rest of the plan clearly favors the former wording correction.

**Classification:** No structural blocker remains. The three findings are marginal specification/proof corrections, but they block final convergence because one test contradicts the trust policy, the stated proof currently cannot pass honestly, and the top-level shutdown order contradicts the normative algorithm.

**Verdict: NOT CLEAN (marginal revisions only).**

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Three concrete marginal blockers cite docs/issues/896/plan.md, packages/workspace/src/app/server/createWorkspaceAgentServer.ts, and plugins/boring-automation/src/server/index.ts, with exact revisions and structural-vs-marginal classification."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/6521f312/docs/issues/896/reviews/adversarial-round-4.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "nl -ba docs/issues/896/plan.md | sed -n '1,460p'",
      "result": "passed",
      "summary": "Read and line-numbered the complete revised plan."
    },
    {
      "command": "read docs/issues/896/reviews/adversarial-round-{1,2,3}.md completely",
      "result": "passed",
      "summary": "Verified every prior blocker and requested revision against the current plan."
    },
    {
      "command": "rg -n 'WorkspaceServerPluginShutdown|WorkspaceShutdownContribution|AgentShutdownParticipant|shutdownParticipants' packages plugins apps docs",
      "result": "failed",
      "summary": "Returned 38 matches; the proof guard necessarily matches retained issue plan/review history as well as current implementation."
    },
    {
      "command": "rg -n 'scheduler.*onReady|scheduler.*onClose' plugins/boring-automation/src/server",
      "result": "failed",
      "summary": "Returned no matches despite current scheduler onReady/onClose hooks at index.ts:99-100, proving the proposed guard is a false negative."
    },
    {
      "command": "git status --porcelain=v1; git diff --cached --quiet; git diff --check",
      "result": "passed",
      "summary": "No staged files or whitespace errors; issue-plan material is untracked in this worktree."
    }
  ],
  "validationOutput": [
    "Rounds 1-3 lifecycle, provenance, abort, event-bus, SSE, failure-policy, and stable-error blockers are integrated.",
    "No structural redesign or slice reorder is required.",
    "Trusted hotReload directory entries are the real default composition path, so Test Seam line 278 must not reject them.",
    "The current proof regex misses the exact scheduler hooks it claims to exclude and the obsolete-name search cannot be empty while issue history is included."
  ],
  "residualRisks": [
    "Marginal: contradictory hotReload test wording can reject trusted default plugins.",
    "Marginal: static proof guards can pass with duplicate scheduler owners or fail forever on retained issue history.",
    "Marginal: top-level resource order disagrees with the normative worker-before-AgentHost drain algorithm."
  ],
  "noStagedFiles": true,
  "diffSummary": "Review artifact only; no plan, source, or test files edited.",
  "reviewFindings": [
    "blocker (marginal): docs/issues/896/plan.md:278 contradicts Decisions 6 and tests 273-274 by denying all hot-loaded plugins, including trusted internal defaults.",
    "blocker (marginal): docs/issues/896/plan.md:306,331-336 defines impossible/false-negative proof guards; retained issue history guarantees obsolete-name matches, while the scheduler regex misses current hooks at plugins/boring-automation/src/server/index.ts:99-100.",
    "blocker (marginal): docs/issues/896/plan.md:13-18 contradicts lines 57,91,125-131 on whether worker-owned event-bus disposal occurs before or after AgentHost drain.",
    "structural blockers: none."
  ],
  "manualNotes": "NOT CLEAN only because three narrow wording/proof corrections remain. After those exact revisions, the plan is ready for the final Fable gate."
}
```
