# #391 runtime refactor (v2) — plan pack

Runtime-free, surface-agnostic agents + the `@hachej/boring-bash` / `@hachej/boring-sandbox` split. Read in this order:

1. [`VISION.md`](VISION.md) — what we are building and the checkable end-state per vision component.
2. [`INDEX.md`](INDEX.md) — **the ordering authority**: phase table, dependency graph, dispatch protocol, binding policies.
3. [`work/`](work/) — one dir per phase, each with `TODO.md` (work order), `PLAN.md` (deliverables+exit), `HANDOFF.md` (closeout checklist).
4. [`architecture/`](architecture/) — the binding design (global ISA `00`, area subplans `01`–`10`, `legacy-monolith-source.md`).
5. [`PR-PLAN.md`](PR-PLAN.md) — the stacked-PR execution plan.

The legacy [`todos/`](todos/) (`TODO-00..07`) is **non-canonical** — kept for v1 bead intent only; the v2 `work/` pack wins on any conflict.
