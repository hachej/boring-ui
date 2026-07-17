---
name: plan
description: Route a tracked request through the right planning method, from a small TODO through deep plan convergence and Bead graph decomposition.
---

# Plan

`/plan` is the single public planning command. It is a router over the raw external methods listed in [references/index.md](references/index.md), while respecting Boring-owned procedures in `docs/`.

## First read

1. `references/index.md`.
2. `docs/kanzen/boring-loop.md`.
3. `docs/kanzen/procedures/issue-plans.md` when creating a canonical plan.
4. `docs/kanzen/procedures/branch-worktree.md` before delegated implementation.
5. `skill-library/boring-v2/MODEL-CARD.md` for delegation and reviewer selection.

## Route by planning depth

| Situation | Method | Required output |
| --- | --- | --- |
| Tiny, clear, one safe PR | Boring tracked TODO | Checklist in the canonical tracked task; proof expectation |
| Missing intent, vocabulary, or constraints | `matt-pocock-grill-with-docs` | Resolved questions and documented decisions |
| Conversation is sufficient to state the solution | `matt-pocock-to-spec` | Canonical spec/plan |
| Approved spec needs a few vertical slices | `matt-pocock-to-tickets` | Small tracked slice set |
| Design is uncertain, broad, or architectural | `jeffrey-emanuel-planning-workflow` | Iteratively reviewed canonical plan |
| High-risk architecture, migration, security, public API, or broad refactor | Jeffrey planning + `jeffrey-emanuel-automated-plan-reviser-pro` | Converged canonical plan |
| Approved plan needs dependency-aware parallel delegation | `jeffrey-emanuel-beads-workflow` | `br` Bead epic/children, typed dependencies, graph proof |

## Boring integration rules

- GitHub owns GitHub issues and PRs. Beads own local granular execution/dependencies. Work Queue owns runs, artifacts, Inbox projections, and provenance only.
- Do not create a Bead graph for a simple one-slice task.
- Canonical plans live at `docs/issues/<issue>/plan.md` when a plan file is warranted.
- APR output is review input, never canonical truth. Selectively integrate accepted findings into the canonical plan.
- Before turning an approved plan into Beads, validate it with `br dep cycles` and `bv --robot-insights`; never run bare `bv`.
- Every delegated writer works in `.worktrees/<task-or-bead-slug>/`.
- Use the Delegation Model to select agent/reviewer strength. Keep one coordinator responsible for synthesis.
- If human intent, approval, or product judgement is needed, use `ask_user` with the canonical plan or other review artifact. Inbox is the approval surface.

## Exit

Return the selected method, canonical artifact/task URL, whether Beads were created, proof path, blockers, and exact next action—normally `/exec <issue-or-bead>`.
