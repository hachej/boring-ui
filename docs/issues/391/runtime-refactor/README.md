# #391 runtime refactor (v2) — plan pack

Runtime-package-free, surface-agnostic agent core with workspace-backed v1
composition + the `@hachej/boring-bash` / `@hachej/boring-sandbox` split. Read in this order:

1. [`plan-navigator.html`](plan-navigator.html) — interactive overview for
   navigating the critical path, isolated parallel tracks, risks, review order,
   and package drill-down. It summarizes and links; it is not plan authority.
2. [`VISION.md`](VISION.md) — what we are building and the checkable end-state per vision component.
3. [`INDEX.md`](INDEX.md) — **the ordering authority**: phase table, dependency graph, dispatch protocol, binding policies.
4. [`work/`](work/) — one dir per phase, each with `TODO.md` (work order), `PLAN.md` (deliverables+exit), `HANDOFF.md` (closeout checklist).
5. [`architecture/`](architecture/) — the binding design (global ISA `00`, area subplans `01`–`05` and `07`–`10`; `legacy-monolith-source.md` is a non-canonical historical snapshot, not implementation input; there is no canonical `06` file — ordering lives in [`INDEX.md`](INDEX.md) and [`work/`](work/)).
6. [`PR-PLAN.md`](PR-PLAN.md) — the stacked-PR execution plan.

## Workspace-first v1 amendment (2026-07-10, accepted 2026-07-11)

Decision [21](../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode)
supersedes the earlier v1 pure/no-environment direction. Every v1 run is bound
to an authorized workspace and an approved runtime/environment. `headless`
describes presentation only: an API, MCP, CLI, or channel adapter may have no UI
while still addressing a workspace-backed agent. Existing `runtime: 'none'`
code is migration/test residue, not a public product mode or v1 acceptance.
Decision 21 is now **accepted** (2026-07-11, via #617).

[`REVIEW-2026-07-11-unknowns.md`](REVIEW-2026-07-11-unknowns.md) is the
2026-07-11 plan-review findings/unknowns ledger (reality-sync vs main,
stacked-PR trap, open questions).

The owner-approved execution path is:

```txt
P0 -> P1 ----------------------┐
P0 -> P6-D --------------------┼-> P6-R -> D1-R0 ----------------┐
          \-> A1-compile ----------------------┬-> D1 beads(+P5a) ┼-> P8
                                               \-> producer -> A1-dev

D1 -> M1 recuts -> AR1 -> M2/E2 -> T1/T2 -> P2/X1
```

Full P3 extraction, generic E1 attachments, and true no-environment execution
remain deferred. P2/X1 is the final ordered infrastructure increment, not a
v1 prerequisite. [`INDEX.md`](INDEX.md) owns exact ordering;
[`PR-PLAN.md`](PR-PLAN.md) owns current PR disposition. The former
[`OWNER-REVIEW.md`](OWNER-REVIEW.md) card is historical review evidence and is
not dispatch authority.

## Delivery policy (2026-07-09)

#391 now ships in increments. The broad platform vision remains directional,
but it is not one merge gate. Decision 23 makes the multi-agent Docker journey
binding and dedicated VM the second deployment composition:

1. **Version 1 multi-agent factory host:** compile small agent directories into
   self-contained, content-addressed `CompiledAgentBundle`, run that exact
   bundle in an explicit local workspace/runtime, and deploy N bundles without
   platform-source edits to one EU Docker host. Each exact hostname's
   landing/auth flow enters an authorized workspace with its deployment
   selected as agent `default`.
2. **External consumption:** recut M1, specify AR1 shareable artifacts, then
   graduate M2/E2 without P7/T2/E1 gates.
3. **Channels, then infrastructure:** recut T1/T2 for multi-channel use; merge
   P2 provider extraction and X1 mounts last. Full P3, generic E1, D2 control
   plane, hosted child apps, and advanced plugin/runtime generality remain
   deferred.

Current verified ancestry: workspace-first boundaries #616/#617/#622, P6-D
#623, A1 compile #624, P1 core/local/Pi/request lifecycle #626/#627/#630/#631, and structural-only
runsc preflight #628 are on main. #628 reports `productionReady: false`; it is
not provider-parity evidence. See the dated review ledger for the remaining
facts, recommendations, and owner decisions.

[`INDEX.md`](INDEX.md) is authoritative for the exact v1 gate and post-v1
status. A package `TODO.md` coordinates its beads; **one bead/PR, not one whole
package TODO, is the autonomous implementation assignment**.

The legacy [`todos/`](todos/) (`TODO-00..07`) is **non-canonical** — kept for v1 bead intent only; the v2 `work/` pack wins on any conflict.
