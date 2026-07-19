# Boring Workflow

```text
feedback → triage → plan → exec
```

Active explicit-only skills live in `.agents/skills/`. Invoke with
`/skill:<name>`. Policy has one owner:

| Need | Canonical source |
| --- | --- |
| workflow, states, quality bars | [`boring-loop.md`](boring-loop.md) |
| models and review tiers | [`MODEL-CARD.md`](MODEL-CARD.md) |
| coding/invariants/commands | [`procedures/`](procedures/) |
| proof | [`procedures/proof-of-work.md`](procedures/proof-of-work.md) |
| human handoff | [`procedures/owner-review-card.md`](procedures/owner-review-card.md) |
| issue intake | [`procedures/well-documented-issue.md`](procedures/well-documented-issue.md) |
| plans | [`procedures/issue-plans.md`](procedures/issue-plans.md) |
| worktree agents | [`procedures/worktree-agent.md`](procedures/worktree-agent.md) |
| skill authoring and size reduction | [`procedures/skill-authoring.md`](procedures/skill-authoring.md), [`procedures/skill-size-reduction.md`](procedures/skill-size-reduction.md) |

Use `ask_user` for human decisions; use a GitHub issue/PR comment when unavailable.
