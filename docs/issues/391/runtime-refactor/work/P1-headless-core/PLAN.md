# P1-headless-core — Plan

> Phase: Phase 1 — Headless core: dependency inversion, pure mode, `createAgent()` · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — package ownership, non-negotiable invariants 1–14, and the seams to reuse.
- [01-agent-core-runtime-free.md](../../architecture/01-agent-core-runtime-free.md) — the pure-mode contract, the `AgentEnvironment` shape, the **no-`AgentFeature`** rule, the pi-harness audit questions, required tests.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the `createAgent()` nine-member API surface, the two-handles rule, the "façade has no Fastify import / no env reads / no file discovery" rule.

## Design context
Phase 1 is the critical path. It extracts a Fastify-free `createAgent()` façade (published at `@hachej/boring-agent/core`) from the agent server and makes `createAgentApp()`/`registerAgentRoutes()` thin adapters over it with **zero behavior change**. The façade exposes the **nine** members `start`/`stream`/`send`/`resolveInput`/`interrupt`/`stop`/`sessions`/`readiness`/`dispose`: `start` is the accepted-receipt write primitive (turn runs on an independent producer, never consumer-backpressured), `stream` the replay+live-tail read primitive, `send` convenience over both, `interrupt`/`stop` the turn-abort / session-end control pair. Dependency inversion comes first: config is a typed object with **no** `process.env`/`process.cwd()`/`.pi/*`/`workspaces.yaml` reads inside the façade — all ambient reads move to host/CLI composition. It adds a pure `runtime: 'none'` path (no bash bundle spread into `tools`, sealed/absent cwd, no file routes/tools) and separates `sessionStorageRoot` from workspace roots (`SessionCtx.workspaceId` becomes optional). Durable events, approvals, and historical replay are typed stubs (`ERR_NOT_IMPLEMENTED_UNTIL_T1`) that land in T1; `stream` ships a minimal non-durable live tail so `send` works end-to-end. Nothing new is designed — this expands the ratified Phase 0 contract.

## Deliverables
- `createAgentApp()` / `registerAgentRoutes()` receive the runtime adapter and any extra tools (incl. the boring-bash bundle's `{ tools, readinessRequirements }`) by injection — no `features` registry, no `AgentFeature` contract.
- **Export `createAgent()`** from `@hachej/boring-agent/core` — the canonical Fastify-free public entry: façade returning the **nine** members `{ start, stream, send, resolveInput, interrupt, stop, sessions, readiness, dispose }` (see 08). `start(input): Promise<{ sessionId, startIndex }>` is the accepted-receipt write primitive; `stream(sessionId, { startIndex })` is the replay+live-tail read primitive (replaces `replay()`); `send` = convenience over both; `interrupt(sessionId)` aborts the current turn and `stop(sessionId)` ends/closes the session. `createAgentApp()` becomes an adapter over it. The `@hachej/boring-agent/server` barrel re-exports `createAgent` from `/core` for convenience only; the Fastify-free guarantee is anchored on `/core`.
- Typed config object only: no env-var reads or file discovery inside `createAgent()`; `.pi/*`, workspaces.yaml, env parsing move to host/CLI composition.
- Remove static value imports from agent server composition to built-in mode resolution where needed for pure mode. Type-only `RuntimeModeAdapter` contracts may stay in agent during migration; `resolveMode()` and concrete mode adapters move to boring-bash/host composition after compatibility shims.
- Package invariant test: no agent value import from boring-bash **[landed: `scripts/check-invariants.mjs` — extend to the façade]**.
- Add the pure `runtime: 'none'` path (no bash bundle spread into `tools`).
- Separate `sessionStorageRoot` from workspace roots.
- Audit pi-coding-agent cwd/resource assumptions (blocks pure-mode exit; decision: sealed pi harness, not a second harness).
- Add the boring-bash-free operational event/command seam (reload, slash commands, compaction/provider recovery, session notices) if route composition changes. (External hook request/callback/redaction contracts are **not** Phase 1 scope — they land in Phase 7.)

## Exit criteria
- pure agent starts via `createAgent({ runtime: 'none' })` with no workspace/sandbox/cwd/file routes/bash tools, in a plain Node script with no Fastify;
- existing direct/local/vercel modes still work through host composition;
- all current HTTP consumers unchanged.
