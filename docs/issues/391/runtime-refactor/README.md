# #391 runtime refactor (v2) — plan pack

Runtime-free, surface-agnostic agents + the `@hachej/boring-bash` / `@hachej/boring-sandbox` split. Read in this order:

1. [`plan-navigator.html`](plan-navigator.html) — interactive overview for
   navigating the critical path, isolated parallel tracks, risks, review order,
   and package drill-down. It summarizes and links; it is not plan authority.
2. [`VISION.md`](VISION.md) — what we are building and the checkable end-state per vision component.
3. [`INDEX.md`](INDEX.md) — **the ordering authority**: phase table, dependency graph, dispatch protocol, binding policies.
4. [`work/`](work/) — one dir per phase, each with `TODO.md` (work order), `PLAN.md` (deliverables+exit), `HANDOFF.md` (closeout checklist).
5. [`architecture/`](architecture/) — the binding design (global ISA `00`, area subplans `01`–`05` and `07`–`10`; `legacy-monolith-source.md` is a non-canonical historical snapshot, not implementation input; there is no canonical `06` file — ordering lives in [`INDEX.md`](INDEX.md) and [`work/`](work/)).
6. [`PR-PLAN.md`](PR-PLAN.md) — the stacked-PR execution plan.

## PROPOSED workspace-first v1 amendment (2026-07-10)

Proposed decision [21](../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode)
supersedes the earlier v1 pure/no-environment direction. Every v1 run is bound
to an authorized workspace and an approved runtime/environment. `headless`
describes presentation only: an API, MCP, CLI, or channel adapter may have no UI
while still addressing a workspace-backed agent. Existing `runtime: 'none'`
code is migration/test residue, not a public product mode or v1 acceptance.

The v1 critical path is now the smallest path to the dedicated proof:

```txt
P0/proposed decision 21 -> P6-D -> A1-compile -----------┐
P0 -> P1 boundary -> P2(runsc minimum) -> P5a(minimum) --┼-> P6-R -> A1-dev -> D1 -> P8
                                                          ┘
```

T1/T2, full P3 extraction, generic E1 attachments, and true no-environment
execution remain documented post-v1. [`INDEX.md`](INDEX.md) owns exact ordering;
[`OWNER-REVIEW.md`](OWNER-REVIEW.md) owns the stopped/reworked PR disposition.

## Delivery policy (2026-07-09)

#391 now ships in increments. The broad platform vision remains directional,
but it is not one merge gate:

1. **Release 0 vertical tracer:** finish the safe `createAgent()` boundary and
   ship the bearer-authenticated managed-MCP agent path with bounded,
   self-contained output and a stock-client smoke, backed by an authorized
   workspace rather than a no-environment runtime.
2. **Version 1 agent factory:** compile a small agent directory into a
   self-contained, content-addressed `CompiledAgentBundle`, run that exact
   bundle in an explicit local workspace/runtime, and deploy it without platform-source edits to one dedicated
   EU hostname whose landing/auth flow enters an authorized workspace with that
   deployment selected as agent `default`.
3. **Later increments:** durable transports, full runtime-route extraction,
   generic environment attachments, true no-environment execution, shared
   tenancy, FUSE/S3, external environment projection, control-plane UX, hosted
   child apps, and advanced plugin/runtime generality remain documented but do
   not gate v1.

[`INDEX.md`](INDEX.md) is authoritative for the exact v1 gate and post-v1
status. A package `TODO.md` coordinates its beads; **one bead/PR, not one whole
package TODO, is the autonomous implementation assignment**.

The legacy [`todos/`](todos/) (`TODO-00..07`) is **non-canonical** — kept for v1 bead intent only; the v2 `work/` pack wins on any conflict.
