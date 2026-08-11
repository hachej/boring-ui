# Issue #1081 — sovereign sandbox service

Issue folder for the sandbox service (dogfood → product). One unified owner-gate
(**PR #1220**): the architecture/vision and the SBX1.4 execution plan are the same
product at two altitudes, reviewed together. PR #1219 (the standalone execution
plan) is **superseded by #1220** — its content and review lineage are preserved
here (see below).

## Read in this order

1. **Architecture & vision — what/why.**
   [`docs/direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md)
   — the four-layer product architecture, isolation escalation, and the grounded
   v1 control-plane API-shape section (§9). Sits *above* the execution plan and is
   the authority on *what the slices are slices of*.
2. **Execution plan — the v1 slices.** [`plan-sbx14.md`](plan-sbx14.md) — the
   single-box gVisor daemon build (S1 daemon+auth → S5 Seneca flip). Authority on
   *what ships first*. Originated as PR #1219; **adversarially reviewed L1 (Opus,
   commit `e17242958`) + L2 (Fable, commit `0aedd1a9d`)** — see PR #1219 history
   for the full record.
3. **Grounding — the evidence.** [`references/`](references/) — version-controlled
   research artifacts. Every API / architecture / isolation decision in (1) and
   (2) cites a file here. Index: [`references/README.md`](references/README.md).

## Grounding rule

No API or architecture decision in this folder is ungrounded: each cites a
primary source (competitor docs, E2B source tree, or our own shipped code) via
`references/`. When adding a decision, add or cite its evidence in `references/`.
