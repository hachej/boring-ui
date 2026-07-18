---
name: grill-for-unknowns
description: Stress-test a plan or design by surfacing unknown unknowns — classify gaps into four quadrants, run seven blindspot lenses against real code, and grill one material decision at a time. Use when asked to "grill this plan", find "unknown unknowns", "stress test the plan", or hunt "blind spots".
disable-model-invocation: true
---

# Grill for Unknowns

Adversarially review a plan/design to surface what nobody has considered yet.
Inspired by [nicobailon/grill-for-unknowns](https://github.com/nicobailon/grill-for-unknowns).

Worked example in this repo:
[`docs/issues/391/runtime-refactor/REVIEW-2026-07-11-unknowns.md`](../../../docs/issues/391/runtime-refactor/REVIEW-2026-07-11-unknowns.md).

## Frame — four quadrants

Classify every gap before probing:

- **Known-knowns** — proven by code/docs. Cite, don't question.
- **Known-unknowns** — acknowledged open decisions. Track, don't rediscover.
- **Unknown-knowns** — you'd recognize the right answer but can't state it upfront (team memory not written into the plan). Surface and write down.
- **Unknown-unknowns** — nobody's considered it. The real target of this skill.

## Seven blindspot lenses

Run each lens against the plan; example question shape for this repo's runtime/plan work:

1. **Scale** — what happens under 10x workspace/session concurrency?
2. **Security** — does the new boundary change what paths/tools an adapter can reach?
3. **Failure modes** — if it crashes mid-operation, what state is inconsistent and who detects it?
4. **Edge cases** — what happens to sessions/workspaces created under the old runtime still open at swap time?
5. **Concurrency** — can two mode transitions race and leave a pair mismatched?
6. **Migration** — what must exist in both old and new shapes simultaneously, and for how long?
7. **Rollback** — if we revert, what is now irreversible (schema, on-disk format, deleted code path)?

## Process

1. Restate the plan and its stated assumptions.
2. Read the actual code/tests — never trust the plan's self-description.
3. Build an unknowns ledger sorted into the four quadrants.
4. Run the seven lenses; rank suspects by implementation risk.
5. Grill one material decision at a time.
6. For low-risk gaps, propose a default instead of blocking.
7. Stop when every unknown that could materially change the plan is resolved or explicitly accepted as an assumption.

## Question filter

Only ask a question if ALL three hold:

- **Material** — changes architecture, scope, data model, security, or acceptance criteria.
- **Grounded** — tied to actual code/doc evidence, not speculation.
- **Answerable** — the user can pick an option or approve a default.

## Output format per blocking question

```md
**Blocking question:** <the question>
**Why it matters:** <A vs B consequences>
**Evidence:** <file citation>
**Recommended answer:** <default + rationale>
```

Hard-to-reverse, non-obvious, real-trade-off decisions get flagged as ADR /
`docs/DECISIONS.md` candidates instead of being buried in chat.
