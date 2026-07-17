# #391 runtime-refactor archive and reference pack

> **Status: historical / non-dispatchable.** The active plan is
> [`../plan.md`](../plan.md); durable supersession is recorded in
> [Decision 25](../../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).
> No file below this directory may be used as an implementation work order when
> it conflicts with those authorities.

This directory preserves the architecture research, implementation plans,
reviews, proofs, and decisions that led to the current #391 direction. It is
valuable evidence, but its former AgentHost/D1 ordering was retired after the
owner-directed physical cleanup merged in PR
[#794](https://github.com/hachej/boring-ui/pull/794).

## Active references

1. [`../plan.md`](../plan.md) — sole active implementation and ordering authority.
2. [`INDEX.md`](INDEX.md) — concise current status and dependency summary.
3. [`VISION.md`](VISION.md) — stable strategic direction, not a work queue.
4. [`PR-PLAN.md`](PR-PLAN.md) — current review-sized slice map.
5. [`OWNER-REVIEW.md`](OWNER-REVIEW.md) — current owner review card.

## Historical evidence

- `architecture/` records package, surface, environment, and testing reasoning.
- `work/` and `todos/` record superseded work orders. They are not dispatchable.
- `FORWARD-PLAN.md` records the former AgentHost-era convergence and its supersession.
- D1/AgentHost specifications, runbooks, controller plans, revision/CAS plans,
  and associated reviews are historical only. Their presence does not authorize
  restoring physically removed assets.

## Current direction in one line

```text
static package contract -> agent identity/session scope -> shared Workspace+Sandbox
-> Core auth/routing -> full-app compatibility -> exact release -> Seneca two-agent proof
```

Later custom tools, native agent-to-agent/A2A, transport, marketplace, generic
environments, provider extraction, and S3/FUSE work require separate approved
plans after the Seneca proof.
