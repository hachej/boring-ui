> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P1-headless-core — Plan

> **Proposed revised v1 plan (2026-07-10).** The directory name is historical.
> P1 delivers an environment- and Fastify-independent core boundary that is
> composed by an authorized workspace and approved runtime. It does **not**
> deliver a public pure/no-workspace mode. The older pure-mode targets retained
> below are post-v1 research and are not dispatch or acceptance authority.

## Active v1 outcome

P1 makes the current workspace-backed execution path easier to compose and
reuse without changing the product authorization boundary:

- keep `@hachej/boring-agent/core` independent of Fastify and concrete runtime
  providers;
- make workspace-scoped host composition explicit at the package boundary;
- keep the existing pi harness, session implementation, routes, and workspace
  behavior unless a smaller extraction is required by that boundary;
- make tool and static-prompt merge order deterministic and duplicate handling
  fail closed;
- bound agent-local caches and lifecycle without giving the core ownership of
  host/provider-global resources;
- preserve actor/origin attribution where the current v1 call path requires it;
- keep session storage and workspace/runtime storage as distinct roots.

V1 adds no `runtime: 'none'` product path, workspace-less session adapter,
`AgentFeature` registry, second harness, generic environment registry, or new
workspace bundle schema. Durable admission/idempotency and the replayable event
protocol move to T1 unless a named current v1 consumer proves a smaller piece is
required now.

## Active implementation order

- Landed ancestry is #616 boundary -> #622 workspace-first correction -> #626
  core relocation -> #627 terminal local binding disposal -> #630 Pi terminal
  teardown -> #631 request-binding/service teardown. The obsolete
  #543/#547/#575 stacks are historical inputs, not current dispatch targets.
- Next, add only fail-closed readiness from the same binding-owned requirement source
  consumed by tool composition. Unknown or unconfigured requirement facts must
  not report ready. The exact P1-R files, truth table, disposal race proof, and
  30-40 minute budget are binding in [`PR-PLAN.md`](../../../../391/runtime-refactor/PR-PLAN.md); #576 is
  research only and must not be cherry-picked.
- Keep each slice independently reviewable. Do not cite in-progress work as
  landed until its merge commit is verified as an ancestor of `origin/main`.

Do not merge or revive the old stack wholesale. PR dispositions are binding in
[PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md).

## Active exit criteria

- Existing workspace/core/CLI HTTP behavior remains unchanged.
- Every v1 local and deployed run still has an authorized workspace and
  approved runtime/environment.
- The core boundary has no Fastify or concrete-provider dependency.
- Tool/prompt composition is deterministic and residue is removed as one
  workspace contribution.
- Agent-local lifecycle is bounded and does not dispose host-global resources.
- Session and workspace/runtime roots remain separate.
- No new public mode label, generic registry, or compatibility abstraction is
  introduced.

## Superseded research below

The remaining sections document the earlier pure-mode design. They are useful
only for a future named no-environment consumer that passes decision 21's
reintroduction gate.

> Phase: Phase 1 — Headless core: dependency inversion, pure mode, `createAgent()` · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture

- [00-global-isa.md](../../../../391/runtime-refactor/architecture/00-global-isa.md) — package ownership, non-negotiable invariants 1–14, and seams to reuse.
- [01-agent-core-runtime-free.md](../../../../391/runtime-refactor/architecture/01-agent-core-runtime-free.md) — pure-mode contract, session/storage config shape, **no-`AgentFeature`** rule, pi-harness audit, required tests. Its historical `AgentEnvironment` name is not the P1 Flue-inspired `AttachedEnvironmentRuntime` seam.
- [08-pluggable-agent-surfaces.md](../../../../391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md) — `createAgent()` nine-member API, two-handles rule, no Fastify/env/file discovery inside the façade.
- [09-environments-attachable.md](../../../../391/runtime-refactor/architecture/09-environments-attachable.md) — filesystems/environments are attachable resources; one agent can have zero, one, or many.

## The three design documents

This P1 plan is now split into three focused documents so the full universe is captured without mixing research, ideal design, and migration mechanics:

1. [RESEARCH.md](RESEARCH.md) — what Anthropic Managed Agents, Flue, and eve teach us.
2. [TARGET_INTERFACE.md](TARGET_INTERFACE.md) — the ideal pluggable-agent interface and invariants.
3. [MIGRATION_FROM_TODAY.md](MIGRATION_FROM_TODAY.md) — how today's code maps to the target and how P1/P2/P3/P4/P6 get there.

Read them in that order.

## One-sentence design

```txt
Authored agent definition -> requirements only
Host/plugin/environment resolver -> policy ∩ provider facts ∩ manifests ∩ readiness
ResolvedAgentComposition -> semantic capability facts + concrete capability bundles
Surfaces/adapters -> render/register from facts, never from runtimeMode
```

## Non-negotiable decisions

- Refactor/extract from the existing agent package; do **not** reimplement from scratch. Current `createAgent()`/shared contracts/runtime/tool/profile seams are the building blocks, and P1 must preserve HTTP behavior.
- `runtimeMode` is diagnostic only. New consumers must not branch on it for feature gating.
- `AgentRouteBindingProfile` is Fastify adapter output only. It must not become the capability registry.
- Workspace UI plugin/panel names are surface implementation details, not capability truth.
- P1 does **not** introduce a generic `AgentFeature` abstraction.
- `environments[]` is the source of truth for filesystem/bash/environment authority. Do not store scalar `filesystem`, `shell`, or `attachments` as capability truth.
- User-provided files/images are input assets. Intake is derived from writable environment sinks, provider direct-asset support, and host policy — not an `attachments` capability axis.
- Prompt fragments, skills, MCP servers/toolsets, asset intake, routes, tools, UI affordances, renderers, composer providers, and readiness/status are all capability residue.
- Detaching a capability removes the whole bundle, not only tools.
- Subagents get their own resolved composition unless explicitly configured as self/copy sharing.

## Target minimal capability facts

P1 should make pure mode report the honest target shape:

```ts
{
  v: 1,
  runtimeMode: 'none', // diagnostic only; adapter shim during migration
  environments: [],
  tools: [...actualRegisteredToolNames],
  skills: [],
  mcpServers: [],
}
```

Existing direct/local/vercel modes keep behavior unchanged. They may expose a coarse compatibility projection until P2/P3 move real filesystem/bash bundles into boring-bash.

## P1 deliverables

- Export `createAgent()` from `@hachej/boring-agent/core` with the nine-member Fastify-free API: `start`, `stream`, `send`, `resolveInput`, `interrupt`, `stop`, `sessions`, `readiness`, `dispose`.
- Keep `createAgentApp()` and `registerAgentRoutes()` as adapters over the core path where practical, with no HTTP behavior change.
- Add pure default core path: no runtime/environment attachment means no workspace, sandbox, cwd, file routes, or bash/file tools. Existing `runtime: 'none'` remains a server/host shim input during migration.
- Add/document minimal `ResolvedAgentCapabilities` projection through the existing capability exposure seam where practical.
- Keep `createAgent()` typed-config-only: no env-var reads, cwd discovery, `.pi/*`, or `workspaces.yaml` reads inside the façade.
- Create the injection seam for runtime adapters and extra tools. P2 moves `resolveMode()` and concrete adapters out atomically.
- Preserve/extend invariant tests: no agent value import from boring-bash or boring-sandbox, including the new façade.
- Separate `sessionStorageRoot` from workspace/environment roots.
- Audit pi-coding-agent cwd/resource assumptions enough for pure mode.
- Make `start()` the single per-session admission boundary used by `send()` and
  every surface. Add caller `requestId` idempotency, actor/origin propagation,
  and one fail-closed duplicate-tool policy.
- Separate agent-local cleanup from host/provider-global lifecycle; bound all
  runtime/session caches.

## Exit criteria

- Pure agent starts via `createAgent()` with no runtime/environment attachment in a plain Node script with no Fastify.
- Pure mode has no attached environments, no workspace/sandbox/cwd authority, no file/bash environment tools, no filesystem prompt residue, and no file skills.
- Pure-mode capability facts match the target minimal projection.
- Existing direct/local/vercel modes continue to work through existing server adapters with current HTTP behavior unchanged; adapter relocation to host composition is P2.
- New code uses semantic capabilities, not `runtimeMode`, for feature gating.
- `AgentRouteBindingProfile` remains adapter plumbing.
- Concurrent starts have a documented queue-or-busy rule; retries cannot create
  a second run; `interrupt()` targets the admitted run.
- Session/run metadata retains `actor` and `originSurface`.
- Core does not own or dispose a provider-global runtime adapter.
- `git diff --check` passes and relevant tests/typechecks run or blockers are recorded.
