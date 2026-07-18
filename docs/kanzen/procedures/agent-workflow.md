# Agent Workflow

Compatibility pointer only. Do not add new process here.

Use [`../boring-loop.md`](../boring-loop.md) for the current Boring v2 workflow.

Current workflow:

```text
ask-boring -> feedback -> triage -> plan -> exec
```

Active skills live in [`../../../.agents/skills/`](../../../.agents/skills/). Kanzen procedures and policy live under [`../`](../).

Use focused procedures for how-to details:

- [`coding-rules.md`](coding-rules.md)
- [`coding-invariants.md`](coding-invariants.md)
- [`repo-commands.md`](repo-commands.md)
- [`trunk-flags-review-budget.md`](trunk-flags-review-budget.md)
- [`issue-plans.md`](issue-plans.md)
- [`worktree-agent.md`](worktree-agent.md)
- [`visual-review.md`](visual-review.md)
- [`proof-of-work.md`](proof-of-work.md)

Human review or decision requests should use the `ask_user` tool when available so the request appears in the Boring UI inbox. If `ask_user` is unavailable, leave a clear GitHub/PR comment instead.
