---
name: autoresearch
description: Run a bounded review, fix, test, and re-review convergence loop over one tracked target.
disable-model-invocation: true
---

# Autoresearch

Invocation:

```text
/skill:autoresearch <issue-or-target> goal="<outcome>" [ui=<registered-spec>] [max=<1..5>]
```

Read `../../../docs/kanzen/procedures/autoresearch.md`, then the regular
`../plan/SKILL.md` and `../exec/SKILL.md`. Autoresearch controls their sequence;
it does not replace their contracts.

1. Require a tracked issue, measurable goal, bounded target, exact functional
   proof, optional exact registered UI spec, and iteration cap (default 3,
   maximum 5). Resolve missing intent through the plan procedure and stop while
   any owner decision remains open.
2. Apply the plan procedure once. In a dedicated worktree, capture iteration 0
   from the unchanged target and bind its evidence to the commit and tree.
3. Apply the exec procedure once as the sole writer. Internally repeat the
   canonical combined-review loop: select at most three ordered findings, fix,
   prove, and independently re-review the resulting revision. A selected fix
   spends one iteration even when proof remains red.
4. Stop early at `success`, `stalled`, or `blocked-owner`; otherwise stop after
   the declared cap as `cap-exhausted`. Produce one terminal owner handoff and
   never merge.

Complete only when every iteration is recorded, deterministic proof and
reviewer dispositions target the same final revision, the terminal state is
explicit, and the owner has a runnable artifact or exact validation path.
