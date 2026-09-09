# Agent runtime

This pack absorbs the #391 (application agent fleet, Workspace orchestration,
shared execution environments) and #909 (AgentGateway v0) planning set into
one place, organized by product area instead of by issue number. Moved here
2026-08-26 as part of PR #1409; nothing was deleted, only relocated and
relinked.

## Areas

| Area | What it covers | Status |
| --- | --- | --- |
| [`fleet-and-environments/`](fleet-and-environments/README.md) | the agent fleet product plan and its governed execution environment | ceded sequencing authority to `docs/direction/DIRECTION.md` on 2026-07-31; still the Decision 28 roadmap content |
| [`gateway/`](gateway/README.md) | the AgentGateway spine — one frozen contract, one construction path | shipped in v0.1.91, recorded as Decision 29; plan doc predates the shipped state |
| [`plugins-across-hosts/`](plugins-across-hosts/README.md) | how a plugin behaves consistently across every host surface | owner analysis, converged through adversarial hardening (v2) |
| [`consumption-modes/`](consumption-modes/README.md) | the ways something can consume an agent from a Workspace | shared architecture contract under Decision 28 |
| [`cloud-vision/`](cloud-vision/README.md) | the longer-range "agent cloud" vision and the landing-surface decision | vision note is non-binding; landing-surface reconciliation is RATIFIED (Decision 30) |
| [`alignment/`](alignment/README.md) | ownership map, work-package alignment, and the live contradiction-audit record | `CONTRADICTIONS.md` is live — the 2026-08-26 audit verdicts and per-area review table; start there |

## What did not move

The July execution subtree at
[`docs/issues/391/runtime-refactor/`](../../issues/391/runtime-refactor/) is
still in place. It is a working tree of issue-anchored implementation docs,
not product planning, and stays where it is.

## Where ordering lives

This pack holds the "what" and the "why" of each area. Dependency rationale
for what runs next lives in
[`docs/plans/multiagent-shell/premises.md`](../multiagent-shell/premises.md),
and executable ordering lives in
[`docs/direction/DIRECTION.md`](../../direction/DIRECTION.md).
