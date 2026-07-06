# S2-embed-contract — Plan

> Phase: Phase S2 — Spreadsheet embed (pi-excel) (after S1 learnings) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the headless `createAgent()` façade and the reference-adapters table (Spreadsheet/pi-excel row: domain tools supplied by the host as `tools`, boring-bash not installed); two-handles and HITL.

## Design context
S2 is deliberately lighter than S1: a publishable embedding contract doc plus one minimal reference embed, reusing only S1's neutral surface-adapter conformance suite. It proves the agent can be mounted as a library inside another product — the host supplies its domain tools (`read_range`, `write_range`, side-effecting ones marked `needsApproval`) as `tools`, runs `runtime: 'none'` with no filesystem bindings, and renders approvals in its own host/task-pane dialog resolved via `resolveInput`. The trust boundary is explicit: `createAgent()`, model credentials, and the agent loop run host-side (trusted Node); the task-pane/browser add-in consumes only the `ChatTransport` contract. The embed owns its `workbookId+sheetId → sessionId` addressing (two handles); core APIs take `sessionId` only. Governed-context-in-embeds is descoped to a post-E2 follow-up filed at P8 — the reference injects no readonly binding. Conformance reuses S1's suite from the neutral `@hachej/boring-agent/testing` home; it does not reuse S1's Hono/Fastify wrapper or any channel-core package.

**Amendment (2026-07-06) — relationship to #526/#551:** the shipping Office surface is the pi-for-excel wrapper (#551), which runs pi-agent-core's own loop and integrates with boring-ui via `/api/v1` REST tools and a hosted model gateway — it does **not** consume `createAgent()`. S2 remains the library-embedding contract proof; do not retarget S2 at the wrapper, and do not treat the wrapper as satisfying S2's exit criteria.

Verified current repo reality: there is no pi-excel plugin and no `examples/` tree in this worktree. The existing app convention is `apps/*` with package names such as `workspace-playground`; `pnpm-workspace.yaml` already includes `apps/*`. The S2 reference implementation therefore belongs at `apps/spreadsheet-embed-playground` as a minimal spreadsheet-ish host/task-pane reference, not as a real Office add-in and not under a nonexistent plugin.

## Deliverables
- Embedding guide + client contract for mounting the agent inside another product: host supplies domain tools (read/write range etc.) as `tools`, `runtime: 'none'`; approvals via host dialog. Governed readonly bindings stay descoped to the post-E2 follow-up.
- Reference implementation at `apps/spreadsheet-embed-playground`, consuming only the published contract; it is a minimal spreadsheet-ish host/task-pane reference, not a real Office add-in or a nonexistent pi-excel plugin.

## Exit criteria
The embed has no boring-bash dependency; tool outputs project into the sheet; conformance suite passes.
