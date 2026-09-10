# [Playground E2E CI] Factory request

Plan GitHub issue https://github.com/hachej/boring-ui/issues/1476 on this epic only.

Owner outcome: add the `apps/workspace-playground` Playwright suite to CI with bounded runtime and failure artifacts, and repair or retire the stale `multi-agent-addressed-ui.spec.ts`, so CI can verify the multi-agent workspace surface.

Operating bounds:
- This is a real Gate 1 trial. Gate 1 is **not pre-approved**. Produce plan artifacts and a dependency-correct Beads graph only, then raise exactly `[Playground E2E CI] Plan approval` in Julien's Inbox and stop while unanswered.
- Do not arm supervision, call `dispatch_worker`, create Worker sessions, implement code, push, open a PR, merge, or close the GitHub issue/Beads before Julien approves.
- Use the host-selected Orchestrator model. Do not run direct Codex CLI/review loops. Use at most one host-provided independent plan review; if unavailable, state that in Gate 1 rather than substituting a loop.
- Do not install or build the monorepo on this VM. Planning may inspect repository files and existing CI/test configuration only.
- Keep the graph scoped with label `epic:playground-e2e-ci`; use the canonical Beads DB required by Factory. Do not touch any other epic.
- Before Gate 1, post one concise triage/graph comment on issue #1476 in the canonical triage format: state `ready-for-agent`, category `bug`, first blocker `plan`, next action the Gate 1 plan approval, expected proof, and this epic's Bead IDs. Existing labels are already correct; do not churn them.
- No duplicate PR exists from the pilot's `gh pr list --state all --search 1476` check at intake. Re-check before any future implementation.

Plan expectations: name exact CI config/scripts and Playwright seams, include a bounded command strategy and retained-artifact behavior, decide repair versus retirement from repository evidence, include rollback, acceptance, and proof. Prefer one implementable slice unless evidence requires a dependency.
