# #391 runtime-refactor archive and reference pack

> **Status: historical / non-dispatchable.** The active plan is
> [`../plan.md`](../plan.md); durable supersession is recorded in
> [Decision 25](../../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).
> No file below this directory may be used as an implementation work order when
> it conflicts with those authorities.

This directory preserves shared architecture, retained #391 work orders, reviews, proofs, redirect stubs, and historical evidence. Its former AgentHost/D1 ordering was retired after PR [#794](https://github.com/hachej/boring-ui/pull/794), but Decision 25 does not cancel valid child-issue work. See [`../OWNERSHIP.md`](../OWNERSHIP.md) for #805–#809 ownership and the completed move record.

## Active references

1. [`../plan.md`](../plan.md) — sole active implementation and ordering authority.
2. [`INDEX.md`](INDEX.md) — concise current status and dependency summary.
3. [`VISION.md`](VISION.md) — stable strategic direction, not a work queue.
4. [`PR-PLAN.md`](PR-PLAN.md) — current review-sized slice map.
5. [`OWNER-REVIEW.md`](OWNER-REVIEW.md) — current owner review card.

## Classification

- **8 retired work orders:** AgentHost/D1 execution and D2 mesh tied to that topology; non-dispatchable.
- **29 historical snapshots/evidence/redirects:** dated context, not current ordering authority.
- **74 redirect stubs:** direct links to canonical child-issue documents moved to #805–#809.
- **Retained #391 files:** shared architecture and its own P0/D1/D2/history remain here.
- `todos/` and `FORWARD-PLAN.md` preserve former ordering only.

D1/AgentHost specifications never authorize restoring physically removed assets. Valid independent plans have moved under child issues #805–#809 in this completed path-only redistribution; the former paths are redirect stubs.

## Current direction in one line

```text
static package contract -> agent identity/session scope -> shared Workspace+Sandbox
-> Core auth/routing -> full-app compatibility -> exact release -> Seneca two-agent proof
```

Later custom tools, native agent-to-agent/A2A, transport, marketplace, generic
environments, provider extraction, and S3/FUSE work require separate approved
plans after the Seneca proof.
