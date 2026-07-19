---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-human
phase: plan
track: owner
flag: not-needed
updated: 2026-07-18
---

# #805 Runtime package extraction and attachable environments

## Canonical entry

This issue owns runtime package extraction, attachable environments, and the A1/E1/P1/P3–P8 work packages. **A1 agent authoring is actively executing as a Decision 26 Step 1A dependency** through its recut [`PLAN.md`](runtime-refactor/work/A1-agent-authoring/PLAN.md). P3 now has a separate [Decision 26 remaining-work plan](runtime-refactor/work/P3-routes-tools/DECISION-26-PLAN.md): only its test-only behavior-freeze preparation may run before #808, while all P3 product-code work is blocked behind the active A1 stack, completed Decision 26 product Step 2 plus named-consumer evidence, and #808's sandbox-provider extraction. E1/P1/P4–P8 remain retained and non-dispatchable until separately recut against [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Canonical documents

- [`A1-agent-authoring`](runtime-refactor/work/A1-agent-authoring)
- [`E1-environment-attachments`](runtime-refactor/work/E1-environment-attachments)
- [`P1-headless-core`](runtime-refactor/work/P1-headless-core)
- [`P3-routes-tools` Decision 26 remaining-work plan](runtime-refactor/work/P3-routes-tools/DECISION-26-PLAN.md)
- [`P4-file-ui`](runtime-refactor/work/P4-file-ui)
- [`P5-provisioning-secrets`](runtime-refactor/work/P5-provisioning-secrets)
- [`P6-plugin-child-app`](runtime-refactor/work/P6-plugin-child-app)
- [`P7-multi-agent-inspection`](runtime-refactor/work/P7-multi-agent-inspection)
- [`P8-verification`](runtime-refactor/work/P8-verification)

Historical #391 architecture and the active phased product plan remain at
[`../391/plan.md`](../391/plan.md). The latter controls shared sequencing; this
issue regains dispatch authority only through each work package's own Decision 26 recut and explicit trigger conditions.
