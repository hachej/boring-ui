# Boring Workflow

Active explicit-only skills live in `.agents/skills/`. Invoke with
`/skill:<name>`. Policy has one owner:

| Need | Canonical source |
| --- | --- |
| workflow, states, quality bars | [`boring-loop.md`](boring-loop.md) |
| models and review tiers | [`MODEL-CARD.md`](MODEL-CARD.md) |
| factory seats, stages, gates, tools (wraps this loop) | [`../../.agents/factory/README.md`](../../.agents/factory/README.md), [`../factory/VISION.md`](../factory/VISION.md) |
| bead definition-of-ready | [`procedures/bead-ready.md`](procedures/bead-ready.md) |
| nightly documentation refresh | [`procedures/documentation-refresh.md`](procedures/documentation-refresh.md), [`documentation-refresh-tasks.md`](documentation-refresh-tasks.md) |
| coding/invariants/commands | [`procedures/`](procedures/) |
| proof | [`procedures/proof-of-work.md`](procedures/proof-of-work.md) |
| human handoff | [`procedures/owner-review-card.md`](procedures/owner-review-card.md) |
| agent/session handoff | [`procedures/session-handoff.md`](procedures/session-handoff.md) |
| issue intake | [`procedures/well-documented-issue.md`](procedures/well-documented-issue.md) |
| plans | [`procedures/issue-plans.md`](procedures/issue-plans.md) |
| worktree agents | [`procedures/worktree-agent.md`](procedures/worktree-agent.md) |
| owner-approved rolling small-fixes batches | [`procedures/rolling-small-fixes.md`](procedures/rolling-small-fixes.md) |
| skill authoring and size reduction | [`procedures/skill-authoring.md`](procedures/skill-authoring.md), [`procedures/skill-size-reduction.md`](procedures/skill-size-reduction.md) |
| decision reference/history | [`REVIEW_DECISIONS.md`](REVIEW_DECISIONS.md) (reference/history) |

Use `ask_user` for human decisions; use a GitHub issue/PR comment when unavailable.

## Skill catalog

| Skill | Purpose |
| --- | --- |
| `ask-boring` | Route a request to the right Boring v2 workflow skill without doing the work. |
| `autoresearch` | Run a bounded review, fix, test, and re-review convergence loop over one tracked target. |
| `boring-app-setup` | Scaffold, customize, and ship a new boring-ui app from an idea. |
| `boring-plugin-build` | Build or shape a boring-ui plugin for a shipped app or playground. |
| `exec` | Drive one ready artifact through implementation, proof, review, and owner handoff. |
| `feedback` | Capture feedback safely: file confirmed bugs as GitHub issues and route feature ideas to the Product Backlog. Never implement. |
| `fresh-eyes` | Read-only independent review of a plan, diff, or PR for overlooked mistakes, omissions, risks, broken acceptance, and missing proof. |
| `grill-for-unknowns` | Stress-test a plan/design for unknown unknowns using grounded blindspot lenses and one material decision at a time. |
| `handoff` | Create or resume a verified cross-session task handoff. |
| `plan` | Route a tracked request from a small TODO through a reviewed plan or dependency-aware Beads graph. |
| `skill-management` | Explicit router for creating a skill or reducing an existing skill's active context size. |
| `teach` | Teach the user a new skill or concept, within this workspace. |
| `triage` | Classify existing issues or PRs with the Boring state model and record the next action. |
| `ui` | Review the named UI scenario or emit one bounded improvement packet. |
