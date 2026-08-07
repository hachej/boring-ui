---
name: plan
description: Route a tracked request from a small TODO through a reviewed plan or dependency-aware Beads graph.
disable-model-invocation: true
---

# Plan

Use `../../skill-references/plan/index.md` for provider methods and these
canonical contracts: `docs/procedures/{boring-loop.md,MODEL-CARD.md}` and
`docs/procedures/issue-plans.md`.

| Need | Method |
| --- | --- |
| Tiny, clear, safe change | tracked TODO + proof expectation |
| Missing owner intent | `grill-me` |
| Missing vocabulary/repository constraints | Matt `grill-with-docs` |
| Blind spots | `grill-for-unknowns` |
| Conversation → spec | Matt `to-spec` |
| Approved spec → few slices | Matt `to-tickets` |
| Broad/architectural uncertainty | Jeffrey planning workflow |
| High-risk convergence | Jeffrey planning + APR |
| Approved dependent/parallel work | Jeffrey Beads workflow |

## Rules

- GitHub owns issues/PRs; Beads own local dependencies; Work Queue owns runs,
  artifacts, Inbox projections, and provenance only.
- Keep one slice when possible. APR is advisory; accepted revisions enter the
  canonical plan.
- Materialize slices as beads meeting `docs/procedures/bead-ready.md` (WHAT,
  proof path, file scope, fits one session), and set bead priority at plan time.
- Before Beads handoff run `br dep cycles` and `bv --robot-insights`; never bare
  `bv`.
- Use `/skill:fresh-eyes` as tier 1, then continue the required Model Card ladder.
  Use `ask_user` for unresolved intent, risk, or approval. A plan-approval
  intention links the visual plan doc from `docs/procedures/visual-review-doc.md`.
- **The Steward never self-certifies: an adversarial plan review
  (cross-model per the Model Card) runs BEFORE the owner gate, always** — even
  when every design decision was pre-ratified by the owner via grill. Grill →
  draft → adversarial review → fold findings → gate. Material changes after
  ratification go back to the owner; editorial ones fold silently.
- Provider command names are advisory; translate legacy `/implement` to `/exec`.

Return the canonical artifact/URL, method, slices/Beads, blockers, proof path, and
next action—normally `/skill:exec <target>`.
