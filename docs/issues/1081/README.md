# Issue #1081 — sovereign sandbox service

Issue folder for the sandbox service (dogfood → product). Two documents plus the
grounding evidence they cite.

## Contents

- **Architecture & vision** (PR #1220):
  [`docs/direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md)
  — the four-layer product architecture, isolation escalation, and the grounded
  v1 control-plane API-shape section (§9). Sits *above* the execution plan.
- **SBX1.4 execution plan** (PR #1219): `plan-sbx14.md` — the v1 build (single-box
  gVisor daemon). Lands in this folder via PR #1219 (branch
  `agent/docs-sbx14-plan`); it is the authority on *what ships first*.
- **[`references/`](references/)** — version-controlled grounding evidence. Every
  API / architecture / isolation decision in the two documents above cites a file
  here. See [`references/README.md`](references/README.md) for the index.

## Grounding rule

No API or architecture decision in this folder is ungrounded: each cites a
primary source (competitor docs, E2B source tree, or our own shipped code) via
`references/`. When adding a decision, add or cite its evidence in `references/`.
