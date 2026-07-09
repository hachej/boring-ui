# Boring Workflow

Boring v2 is the maintainer workflow for turning feedback into safe PRs.

```text
ask-boring -> feedback -> triage -> plan -> implement
```

## Skills

Draft skills live in `skill-library/boring-v2/skills/`. They are not active until copied into `.agents/skills/`.

| Skill | Job |
| --- | --- |
| `ask-boring` | Route to the right workflow. Does no work. |
| `feedback` | Create a GitHub issue from user feedback. Stops there. |
| `triage` | Classify an issue/PR and pick the next action. |
| `plan` | Turn an issue into a spec/plan; split into slices only when needed. |
| `implement` | Build one ready issue/slice with proof, review, and PR handoff. |

## Labels

Use a simple surface model.

Category, choose one when possible:

- `bug`
- `enhancement`

State, choose one:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

Do not reintroduce `state:*`, `phase:*`, `track:*`, or `gate:*` labels. Put details in comments, PR handoff cards, or `ask_user` review requests.

## Keep these procedures

- [`procedures/coding-rules.md`](procedures/coding-rules.md)
- [`procedures/coding-invariants.md`](procedures/coding-invariants.md)
- [`procedures/repo-commands.md`](procedures/repo-commands.md)
- [`procedures/proof-of-work.md`](procedures/proof-of-work.md)
- [`procedures/owner-review-card.md`](procedures/owner-review-card.md)
- [`procedures/well-documented-issue.md`](procedures/well-documented-issue.md)
- [`procedures/issue-plans.md`](procedures/issue-plans.md)
- [`procedures/trunk-flags-review-budget.md`](procedures/trunk-flags-review-budget.md)

Everything else in this folder is legacy/reference unless linked by a current skill.

## Model and review policy

See [`../../skill-library/boring-v2/MODEL-CARD.md`](../../skill-library/boring-v2/MODEL-CARD.md).

When human review or a decision is needed, use the `ask_user` tool if available so the request appears in the Boring UI inbox. If unavailable, fall back to a GitHub/PR comment.
