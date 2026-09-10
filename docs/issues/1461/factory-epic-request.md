# [Command Palette Replay] Factory request

Plan GitHub issue https://github.com/hachej/boring-ui/issues/1461 on this epic only. It is distinct from closed #1390: Bombadil replay diverges before any hard gate because the command-palette fixture's candidate button pair swaps availability between record and replay.

Owner outcome: make command-palette readiness/action availability deterministic for Bombadil replay and define retained-evidence plus repeatability proof at the 5/5 bar referenced by #1431.

Operating bounds:
- This is a real Gate 1 trial. Gate 1 is **not pre-approved**. Produce plan artifacts and a dependency-correct Beads graph only, then raise exactly `[Command Palette Replay] Plan approval` in Julien's Inbox and stop while unanswered.
- Do not arm supervision, call `dispatch_worker`, create Worker sessions, implement code, push, open a PR, merge, or close the GitHub issue/Beads before Julien approves.
- Use the host-selected Orchestrator model. Do not run direct Codex CLI/review loops. Use at most one host-provided independent plan review; if unavailable, state that in Gate 1 rather than substituting a loop.
- Do not install or build the monorepo on this VM. Planning may inspect repository files, run metadata, and retained fixture/evidence configuration only.
- Keep the graph scoped with label `epic:command-palette-replay`; use the canonical Beads DB required by Factory. Do not touch any other epic.
- Before Gate 1, post one concise triage/graph comment on issue #1461 in the canonical triage format: state `ready-for-agent`, category `bug`, first blocker `plan`, next action the Gate 1 plan approval, expected 5/5 proof, and this epic's Bead IDs. Existing labels are already correct; do not churn them.
- No duplicate PR exists from the pilot's `gh pr list --state all --search 1461` check at intake. Re-check before any future implementation.

Plan expectations: locate the record/replay action-enumeration and command-palette boot seams, choose the smallest deterministic readiness fix, preserve meaningful user behavior, include retained evidence, exact 5/5 proof, rollback, acceptance, and relevant regression tests. Prefer one implementable slice unless evidence requires a dependency.
