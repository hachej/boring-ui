# S2-embed-contract — Plan

> Phase: Phase S2 — Spreadsheet embed (pi-excel) (after S1 learnings) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the headless `createAgent()` façade and the reference-adapters table (Spreadsheet/pi-excel row: domain tools supplied by the host as `tools`, boring-bash not installed); two-handles and HITL.

## Design context
S2 is deliberately lighter than S1: a publishable embedding contract doc plus one minimal reference embed, reusing S1's shared surface pieces. It proves the agent can be mounted as a library inside another product — the host supplies its domain tools (`read_range`, `write_range`, side-effecting ones marked `needsApproval`) as `tools`, runs `runtime: 'none'` with no filesystem bindings, and renders approvals in its own host/task-pane dialog resolved via `resolveInput`. The trust boundary is explicit: `createAgent()`, model credentials, and the agent loop run host-side (trusted Node); the task-pane/browser add-in consumes only the `ChatTransport` contract. The embed owns its `workbookId+sheetId → sessionId` addressing (two handles); core APIs take `sessionId` only. Governed-context-in-embeds is descoped to a post-E2 follow-up filed at P8 — the reference injects no readonly binding. Conformance reuses S1's suite from the neutral `@hachej/boring-agent/testing` home.

## Deliverables
- Embedding guide + client contract for mounting the agent inside another product: host supplies domain tools (read/write range etc.) as `tools`, `runtime: 'none'`, optional readonly bindings; approvals via host dialog.
- Reference implementation in the pi-excel plugin (or the closest existing spreadsheet surface) consuming only the published contract.

## Exit criteria
The embed has no boring-bash dependency; tool outputs project into the sheet; conformance suite passes.
