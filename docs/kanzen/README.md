# Kanzen

Kanzen is the boring-ui maintainer loop:

```text
/feedback -> enriched GitHub issue
/triage   -> grill, plan, implement, review, prove, or merge
```

Keep it simple: state says whether work can move, phase says what kind of work
is next, gates say why it cannot move yet.

Read:

- [`boring-loop.md`](boring-loop.md) - vision/index, clean model, labels,
  gates, and product shape.
- [`boring-feedback`](../../.agents/skills/boring-feedback/SKILL.md)
  - `/feedback` intake skill.
- [`boring-orchestration`](../../.agents/skills/boring-orchestration/SKILL.md)
  - orchestration skill.
- [`boring-triage`](../../.agents/skills/boring-triage/SKILL.md) - triage
  skill.
- Agent workflow procedure:
  [`procedures/agent-workflow.md`](procedures/agent-workflow.md).
- Trunk/flag/review budget procedure:
  [`procedures/trunk-flags-review-budget.md`](procedures/trunk-flags-review-budget.md).
- Plan files live under `../issues/<issue-number>/`; see
  [`procedures/issue-plans.md`](procedures/issue-plans.md).
- Visual owner handoffs use `visual-explainer` plus a thin ask-user-style
  pending review surface; see
  [`procedures/visual-review.md`](procedures/visual-review.md).

Source notes live in [`sources/`](sources/):

- [`theo_loop.md`](sources/theo_loop.md) - Theo transcript.
- [`steinberger_loop.md`](sources/steinberger_loop.md) - Steinberger skill
  analysis.
