# [MCP Program] Turn the MCP plan into dispatchable slices

Owner request (2026-09-04) for the Boring Factory. Feature name `MCP Program`, epic key `mcp-program`. Source of truth: draft PR #1415 (`plan/900-perfect-mcp`): `docs/issues/900/plan.md`, `docs/issues/806/external-workspace-mcp-plan.md`, `docs/issues/900/plan-review.html`, and `docs/direction/DIRECTION.md`. The PR states that no implementation is dispatchable until owner decisions are made (durable secret-resolver store, Composio transport hardening, C2 tracker ownership, account re-linking policy) and until #806 slice 0 is placed on the roadmap in DIRECTION.md. Closed PR #1309 is quarry only and must not be revived.

This epic is a planning epic: its job is to bring the draft onto `main`, put the open decisions in front of the owner as one Inbox question, and leave a ready Bead graph behind. Implementation starts only after Gate 1.

## Slices, in dependency order

1. **[MCP Program] Land the plan and ask the decisions** — bring #1415 onto the epic branch (148 behind main, docs and Beads only), then raise Gate 1 whose context lists the four owner decisions as explicit radio/select fields with the plan's recommended default for each. Nothing else happens before approval.
2. **[MCP Program] Place slice 0 on the roadmap** — a DIRECTION.md amendment placing #806 slice 0 (removal-only cleanup) and 900.1 discovery in a wave; proof: `pnpm lint:invariants` (strategy docs check) green. Depends on 1.
3. **[MCP Program] Un-defer the first Beads** — flip 900.1a/1b/1c and #806 slice 1 from deferred to ready with the decisions recorded in their descriptions; proof: `br ready --label epic:mcp-program` lists exactly those. Depends on 2.

Implementation of 900.1a (shared Composio protocol custody, capped at 1500 lines) is the first Bead of the follow-on epic `[MCP Discovery]`, not this one.

## Proof for Gate 2

The merged plan, the DIRECTION.md amendment, and the ready Bead graph. No demo.
