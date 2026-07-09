# #391 runtime refactor (v2) — plan pack

Runtime-free, surface-agnostic agents + the `@hachej/boring-bash` / `@hachej/boring-sandbox` split. Read in this order:

1. [`VISION.md`](VISION.md) — what we are building and the checkable end-state per vision component.
2. [`INDEX.md`](INDEX.md) — **the ordering authority**: phase table, dependency graph, dispatch protocol, binding policies.
3. [`work/`](work/) — one dir per phase, each with `TODO.md` (work order), `PLAN.md` (deliverables+exit), `HANDOFF.md` (closeout checklist).
4. [`architecture/`](architecture/) — the binding design (global ISA `00`, area subplans `01`–`05` and `07`–`10`; `legacy-monolith-source.md` is a non-canonical historical snapshot, not implementation input; there is no canonical `06` file — ordering lives in [`INDEX.md`](INDEX.md) and [`work/`](work/)).
5. [`PR-PLAN.md`](PR-PLAN.md) — the stacked-PR execution plan.

## Delivery policy (2026-07-09)

#391 now ships in increments. The broad platform vision remains directional,
but it is not one merge gate:

1. **Release 0 vertical tracer:** finish the safe `createAgent()` boundary and
   ship the bearer-authenticated managed-MCP agent path with bounded,
   self-contained output and a stock-client smoke.
2. **Version 1 agent factory:** compile a small agent directory into a
   self-contained, content-addressed `CompiledAgentBundle`, run that exact
   bundle locally, and deploy it to one dedicated EU tenant without
   platform-source edits.
3. **Later increments:** shared tenancy, FUSE/S3, external environment
   projection, control-plane UX, hosted child apps, and advanced plugin/runtime
   generality remain documented but do not gate v1.

[`INDEX.md`](INDEX.md) is authoritative for the exact v1 gate and post-v1
status. A package `TODO.md` coordinates its beads; **one bead/PR, not one whole
package TODO, is the autonomous implementation assignment**.

The legacy [`todos/`](todos/) (`TODO-00..07`) is **non-canonical** — kept for v1 bead intent only; the v2 `work/` pack wins on any conflict.
