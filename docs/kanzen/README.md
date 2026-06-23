# Kanzen

Kanzen is the boring-ui maintainer loop:

```text
/feedback -> enriched GitHub issue
/triage   -> grill, plan, implement, review, prove, or merge
```

Keep it simple: state says whether work can move, phase says what kind of work
is next, gates say why it cannot move yet.

Boundary: Kanzen is a maintainer routing loop. Coding execution still follows
the canonical workflow in [`../AGENT_WORKFLOW.md`](../AGENT_WORKFLOW.md).

Read:

- [`boring-loop.md`](boring-loop.md) - clean model, labels, gates, and product
  shape.
- [`boring-feedback`](../../.agents/skills/boring-feedback/SKILL.md)
  - `/feedback` intake skill.
- [`boring-orchestration`](../../.agents/skills/boring-orchestration/SKILL.md)
  - orchestration skill.
- [`boring-triage`](../../.agents/skills/boring-triage/SKILL.md) - triage
  skill.
- [`loop-grill`](../../.agents/skills/loop-grill/SKILL.md) - clarity loop.
- [`loop-plan`](../../.agents/skills/loop-plan/SKILL.md) - planning loop.
- [`loop-implement`](../../.agents/skills/loop-implement/SKILL.md)
  - implementation loop.

Source notes live in [`sources/`](sources/):

- [`theo_loop.md`](sources/theo_loop.md) - Theo transcript.
- [`steinberger_loop.md`](sources/steinberger_loop.md) - Steinberger skill
  analysis.
