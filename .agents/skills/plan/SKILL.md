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
- Choose the feature name once, at epic creation, per
  `docs/procedures/naming-conventions.md`; every title from here on (epic Bead,
  child Beads, Inbox, PR, commits, sessions) leads with it.
- Materialize the Bead graph with `br create ... --labels epic:<key>` (the
  epic Bead first, `--parent <epic bead id>` on children where useful); titles
  follow the naming convention. Slices meet `docs/procedures/bead-ready.md`
  (WHAT, proof path, file scope, fits one session); set bead priority at plan
  time.
- Before Beads handoff run `br dep cycles` and `bv --robot-insights`; never bare
  `bv`.
- Plan ceremony scales to the epic: one short plan note under
  `docs/issues/<issue>/`, at most one adversarial review, no HTML review page
  unless the epic changes UI — reach Gate 1 within minutes, not hours.
- Request tier-1 fresh-eyes review through the host-provided independent-review
  mechanism (`/skill:fresh-eyes` when that command is explicitly granted), then
  continue the required Model Card ladder. If no independent-review mechanism is
  available, stop rather than self-certifying. Use `ask_user` for unresolved
  intent, risk, or approval. A plan-approval intention links the visual plan doc
  from `docs/procedures/visual-review-doc.md`. Gate 1 also carries the
  mandatory show-me plan artifact per `.agents/skills/owner-gate/SKILL.md`.
- **The Steward never self-certifies: an adversarial plan review
  (cross-model per the Model Card) runs BEFORE the owner gate, always** — even
  when every design decision was pre-ratified by the owner via grill. Grill →
  draft → adversarial review → fold findings → gate. Material changes after
  ratification go back to the owner; editorial ones fold silently.
- Gate 1 is raised in the owner's Inbox via `/skill:owner-gate` and blocks;
  nothing is dispatched before approve. After approve, arm durable supervision
  and dispatch Workers with `dispatch_worker` when that tool is available —
  the brief names the epic and the pull protocol, never a specific Bead, since
  Workers pull their own work. Use `/skill:exec <target>` only as the fallback
  when no dispatch tool exists.
- Provider command names are advisory; translate legacy `/implement` to `/exec`.

Return the canonical artifact/URL, method, slices/Beads, blockers, proof path, and
next action—normally `dispatch_worker` (fallback `/skill:exec <target>`).
