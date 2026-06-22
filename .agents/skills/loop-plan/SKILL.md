---
name: loop-plan
description: "Use for /loop-plan or gate:plan: produce the smallest useful Kanzen plan, decide inline versus plan file, run thermo-nuclear plan review when needed, and route to implementation or owner input."
---

# Loop Plan

Goal: make the work executable. Do not implement.

## Decide Shape

| Work | Plan Shape |
| --- | --- |
| tiny, obvious, low risk | inline plan on the issue |
| important, risky, broad, or multi-PR | `docs/plans/<slug>.md` plus thermo-nuclear plan review |
| dependent layers | stack plan: PR order, base, acceptance, proof, review focus |

## Plan Must Say

| Field | Meaning |
| --- | --- |
| Goal | user-visible outcome |
| Scope | files/packages likely touched |
| Acceptance | how done is judged |
| Proof | tests, CI, demo workspace, screenshot, or waiver |
| Risk | why `track:fast` is or is not allowed |
| Next | `/loop-implement`, `/loop-grill`, or owner decision |

## Exit

| Result | Labels / Gate |
| --- | --- |
| missing owner/product/security choice | `state:blocked phase:plan gate:clarity` |
| plan ready | `state:active phase:implement gate:implementation` |
| stack needed | `state:active phase:plan gate:plan` with stack plan attached |

Thermo rule: run thermo-nuclear review for non-trivial plans and fix the plan
until no accepted structural blocker remains.
