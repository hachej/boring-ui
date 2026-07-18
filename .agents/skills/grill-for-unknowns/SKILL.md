---
name: grill-for-unknowns
description: Stress-test a plan/design for unknown unknowns using grounded blindspot lenses and one material decision at a time.
disable-model-invocation: true
---

# Grill for Unknowns

Read the plan and real code/tests. Classify gaps before asking anything:

- **known-known:** proven; cite it.
- **known-unknown:** already open; track it.
- **unknown-known:** implicit team knowledge; make it explicit.
- **unknown-unknown:** unconsidered; investigate it.

Probe seven lenses: **scale, security, failure, edge cases, concurrency, migration,
rollback**. Rank by implementation risk.

Ask one question only when it is:

1. material to architecture, scope, data, security, or acceptance;
2. grounded in code/doc evidence; and
3. answerable as a choice or recommended default.

Use:

```text
Question: <one decision>
Why: <consequences>
Evidence: <citation>
Recommendation: <default + rationale>
```

Resolve or explicitly accept every material unknown. Propose defaults for low-risk
gaps. Record hard-to-reverse decisions in `docs/DECISIONS.md`, not only chat.

Example: `docs/issues/391/runtime-refactor/REVIEW-2026-07-11-unknowns.md`.
