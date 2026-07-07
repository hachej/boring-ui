# P1-headless-core — Plan

> Phase: Phase 1 — Headless core: dependency inversion, pure mode, `createAgent()` · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — package ownership, non-negotiable invariants 1–14, and the seams to reuse.
- [01-agent-core-runtime-free.md](../../architecture/01-agent-core-runtime-free.md) — the pure-mode contract, the `AgentEnvironment` shape, the **no-`AgentFeature`** rule, the pi-harness audit questions, required tests.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — the `createAgent()` nine-member API surface, the two-handles rule, the "façade has no Fastify import / no env reads / no file discovery" rule.

## Design context
Phase 1 is the critical path. It extracts a Fastify-free `createAgent()` façade (published at `@hachej/boring-agent/core`) from the agent server and makes `createAgentApp()`/`registerAgentRoutes()` thin adapters over it with **zero behavior change**. The façade exposes the **nine** members `start`/`stream`/`send`/`resolveInput`/`interrupt`/`stop`/`sessions`/`readiness`/`dispose`: `start` is the accepted-receipt write primitive (turn runs on an independent producer, never consumer-backpressured), `stream` the replay+live-tail read primitive, `send` convenience over both, `interrupt`/`stop` the turn-abort / session-end control pair. Dependency inversion comes first: config is a typed object with **no** `process.env`/`process.cwd()`/`.pi/*`/`workspaces.yaml` reads inside the façade — all ambient reads move to host/CLI composition. It adds a pure `runtime: 'none'` path (no bash bundle spread into `tools`, sealed/absent cwd, no file routes/tools) and separates `sessionStorageRoot` from workspace roots (`SessionCtx.workspaceId` becomes optional). Durable events, approvals, and historical replay are typed stubs (`ERR_NOT_IMPLEMENTED_UNTIL_T1`) that land in T1; `stream` ships a minimal non-durable live tail so `send` works end-to-end, with `AgentEvent.eventIndex` assigned by an in-memory monotonic per-process counter until T1 replaces that field's source with SQLite `seq`. Nothing new is designed — this expands the ratified Phase 0 contract.

## Resolved capability facts (P1/P3/P4/P6 target interface)

P1 must keep `createAgent()` free of a generic `AgentFeature` abstraction. This section defines the target resolved-facts contract for P1/P3/P4/P6 so later phases do not add competing `runtimeMode === ...`, workspace-UI, or route-profile switches. P1 is only required to expose the pure-mode facts where practical; YAML authoring, full policy intersection, frontend auto-exclusion, and environment inspection remain later work. This record is **derived output**, never authored input: host/plugin/environment composition intersects app policy, workspace policy, future child-app policy, plugin manifests, provider facts, environment attachments, readiness, and the actually registered tool set, then exposes read-only facts through existing seams such as `registerCapabilitiesContributor` and `/api/v1/capabilities`.

### Separation of concerns

Keep the three layers separate:

```txt
Authored agent definition       -> requirements / intent, no power grant
Host/plugin/environment resolver -> policy ∩ provider facts ∩ manifests ∩ readiness
ResolvedAgentCapabilities       -> read-only semantic facts for consumers
```

The agent core is surface-agnostic. It exposes semantic capability facts such as `filesystem`, `shell`, and `attachments`; it does **not** name workspace UI plugins or tell a surface what to render. The workspace UI, Slack, embeds, MCP, and CLI consume the same facts and map them to their own affordances.

Do **not** use `runtimeMode` as a feature switch. Runtime mode is diagnostic only. Consumers branch on capability fields.

```ts
type AgentFilesystemCapability = 'none' | 'read' | 'readwrite'
type AgentShellCapability = 'none' | 'exec'
type AgentAttachmentCapability = 'none' | 'direct' | 'workspace'

/** Read-only facts resolved by host composition. Derived, never authored. */
interface ResolvedAgentCapabilities {
  /** Optional until P6/P7 agent registry routing is always present. */
  readonly agentId?: string
  /** Diagnostic only; consumers MUST NOT branch on this. */
  readonly runtimeMode: string
  /** Aggregated file access across resolved attachments: none < read < readwrite. */
  readonly filesystem: AgentFilesystemCapability
  /** Coarse exec gate. Exec must be tied to an attached environment/source-of-truth when it can observe files. */
  readonly shell: AgentShellCapability
  /** Ordered lattice: none < direct < workspace. `workspace` includes direct attachments. */
  readonly attachments: AgentAttachmentCapability
  /** Projection of tools actually registered post-resolution; not an input catalog. */
  readonly tools: readonly string[]
}
```

Aggregation rule: `filesystem` is the maximum access level over all resolved filesystem attachments visible to this agent/session. A mixed agent with `user: readwrite` and `company_context: read` reports `filesystem: 'readwrite'`; per-filesystem access details belong only in inspection (`environments[]`) and must still be enforced by tools/routes before mutation.

Authoring (`agents/<name>/...` or YAML, post-P7) declares **requirements**, not power grants, using the same semantic vocabulary. The host decides which plugin/environment/provider satisfies them:

```yaml
requires:
  filesystem: readwrite   # none | read | readwrite
  shell: exec             # none | exec
  attachments: workspace  # none | direct | workspace
```

Plugin names may be installation choices, but they are not the power model. For example, `requires.filesystem: readwrite` may be satisfied by the future boring-bash plugin in a workspace-family host, by a library-mode boring-bash bundle in a headless host, or by no provider at all (then resolution fails closed).

### Capability semantics

`filesystem` is an access-mode axis:

| value | meaning | allowed residue |
| --- | --- | --- |
| `none` | no file environment is attached to this agent/session | no file vocabulary anywhere |
| `read` | readonly file access exists | readonly tree/search/read affordances only |
| `readwrite` | mutable file access exists | full filesystem write/upload/edit affordances, subject to readiness/policy |

`shell` is independent from `filesystem` as a semantic axis, but not a bypass. A future shell-only agent may report `filesystem: 'none', shell: 'exec'` only if its shell cannot read or mutate a workspace filesystem. Any shell that can observe or mutate files must be backed by an attached filesystem and must satisfy the same source-of-truth and policy invariants as file routes/tools. `shell: 'exec'` does not by itself grant raw host secrets or bypass filesystem policy.

`attachments` is an ordered lattice:

```txt
none < direct < workspace
```

- `none`: reject every attachment.
- `direct`: allow provider-safe direct attachments that never touch workspace storage, e.g. bounded `data:`/HTTPS image inputs when the model/harness supports them. Direct attachment validation must include size, media-type, URL-scheme, and redaction/secret-leak guards. Direct does not allow local file paths, workspace file refs, server-side URL fetch/proxy, archives, arbitrary binary blobs, or files requiring persistence.
- `workspace`: allow workspace-backed uploads/file refs and also direct attachments.

Invariant: in v1, `attachments === 'workspace'` requires `filesystem === 'readwrite'` because workspace-backed uploads need a writable target. The resolver must reject contradictory outputs; consumers may assert this invariant. If a future non-filesystem artifact/upload store supports workspace-backed attachments, add a separate capability rather than weakening `filesystem` semantics.

`attachments` is not inferred from `filesystem`: a file-capable agent may still set `attachments: 'none'` by policy, and a pure/headless agent may later set `attachments: 'direct'` without gaining filesystem access.

`tools` is a projection of the actual post-resolution tool catalog. It is for display, diagnostics, and cross-checks only. The registered tool array remains the execution source of truth; a mismatch between `tools` and the registered catalog is a bug. `tools` includes registered-but-not-ready tools; readiness remains a separate `ReadyStatusTracker` / capability-readiness concern, so consumers distinguish absent capability from present-but-preparing/degraded capability.

### Workspace/environment fidelity facts

`workspaceFsCapability: 'none' | 'best-effort' | 'strong'` remains useful, but it is a workspace/environment/provider fidelity fact, not the primary agent residue gate. It belongs to `Workspace.fsCapability`, future E1 `environments[]`, `/agents/:agentId/info`, or diagnostics.

Use it to answer questions such as:

- is host-side filesystem visibility strong or indirect/remote?
- can refresh rely on filesystem events or must it poll?
- is the environment storage-primary or sandbox-primary?
- what source-of-truth caveats should a diagnostics panel show?

Do **not** use it as the primary UI/tool/prompt switch. That switch is `filesystem`.

A later inspection-only shape may include fidelity details without changing the minimal semantic summary:

```ts
interface ResolvedAgentCapabilitiesInspection {
  readonly environments?: readonly Array<{
    readonly filesystem: string
    readonly access: 'read' | 'readwrite'
    readonly execPolicy: 'none' | 'attached'
    readonly workspaceFsCapability?: 'none' | 'best-effort' | 'strong'
    readonly provider?: string
  }>
}
```

### Surface consumption rules

Each consumer maps the same semantic facts to its own affordances:

- **Workspace UI:** consumes semantic facts but remains independently composed. It may hide/suppress filesystem plugin affordances when `filesystem === 'none'`; may render readonly affordances for `filesystem === 'read'`; renders mutable file UI only for `readwrite` plus readiness. The agent never names frontend plugins, panel ids, route names, Fastify route option types, or workspace layout choices.
- **HTTP route adapters:** derive file route registration from `filesystem` and composed route contributions. Pure mode has no file routes by construction.
- **Composer/attachment transport:** uses `attachments` to allow none/direct/workspace-backed attachment paths. In v1, workspace-backed uploads require `attachments === 'workspace'` and `filesystem === 'readwrite'`.
- **Prompt assembly:** includes filesystem/bash prompt fragments only when the corresponding capability bundle is attached and ready enough to advertise. Pure mode has no cwd/workspace/file/bash vocabulary.
- **Skills:** P6 skill filtering hides skills whose declared requirements exceed the resolved capabilities.
- **Plugin manifest validation:** P6 `boring.requires` / `bash.capabilities` requirements are checked against resolved facts and fail closed when missing.
- **Agent inspection/control plane:** P7 `/agents/:agentId/info` can expose the minimal summary plus inspection details for environments/readiness.
- **Slack/embed/MCP/CLI surfaces:** never receive workspace UI names; they consume `sessionId` plus these semantic facts to decide legal inputs and projections.

### Zero-residue rule

When `filesystem === 'none'`, the composed agent has:

- no file/tree/search/fs-events/git/upload routes;
- no read/write/edit/find/grep/ls/upload tools;
- no file tree/editor/viewer UI;
- no filesystem-specific tool renderers (`read`/`write`/`edit`/`find`/`grep`/`ls`/upload); no bash renderer unless an explicitly shell-only capability is attached without filesystem access;
- no file composer providers, `/api/v1/files/search` dependency, upload affordance, or `@files` enrichment;
- no workspace-backed attachments;
- no filesystem/bash prompt fragment, cwd, workspace path, `AGENTS.md`, file-tree, or upload guidance;
- no skills whose declared requirements include filesystem/bash.

Route/tool behavior by filesystem capability:

- `filesystem === 'none'`: file/tree/search/fs-events/git/upload routes are absent; filesystem tools and UI are absent.
- `filesystem === 'read'`: read/list/tree/search/stat/fs-events may exist; viewers/editors may open read-only; write/edit/upload/delete/move/mkdir tools or endpoints are absent or reject with stable readonly errors before mutation; git routes may exist only when readonly-safe and source-of-truth consistent.
- `filesystem === 'readwrite'`: readonly affordances plus write/edit/upload/delete/move/mkdir may exist, subject to target filesystem access, readiness, stale-write checks, and provider facts.

When `filesystem === 'read'`, readonly route/UI/tool affordances are allowed, but write/edit/upload/file-mutating shell assumptions are forbidden. When `filesystem === 'readwrite'`, the full boring-bash filesystem capability bundle may be present, subject to policy, readiness, and provider facts.

### Relationship to `AgentRouteBindingProfile`

`AgentRouteBindingProfile` is a narrow Fastify adapter output derived from `ResolvedAgentCapabilities` plus composed route/tool contributions:

```txt
ResolvedAgentCapabilities + composed contributions
  -> AgentRouteBindingProfile
  -> Fastify route registration
```

It must not become the capability source of truth and must not carry lifecycle hooks, plugin registries, or authored requirements.

### P1 concrete target

For pure mode, the resolved facts are:

```ts
{
  runtimeMode: 'none',
  filesystem: 'none',
  shell: 'none',
  attachments: 'none', // temporary until the direct-attachment follow-up lands
  tools: [...actualTools],
}
```

P1 may land this as plan language plus the smallest practical pure-mode projection. Do not implement YAML authoring, full requirement intersection, environment inspection details, or frontend auto-exclusion in P1 unless they are already needed by the PR. Those later consumers must target this semantic interface instead of adding `runtimeMode === 'none'`, route-profile, or workspace-plugin-name checks.

Regression guard target: tests should eventually assert capability consistency across route registration, tool catalog, prompt fragments, composer providers, frontend filesystem UI, attachment validation, readiness reporting, and skill filtering. A mismatch means capability residue leaked.

## Deliverables
- `createAgentApp()` / `registerAgentRoutes()` receive the runtime adapter and any extra tools (incl. the boring-bash bundle's `{ tools, readinessRequirements }`) by injection — no `features` registry, no `AgentFeature` contract.
- **Export `createAgent()`** from `@hachej/boring-agent/core` — the canonical Fastify-free public entry: façade returning the **nine** members `{ start, stream, send, resolveInput, interrupt, stop, sessions, readiness, dispose }` (see 08). `start(input): Promise<{ sessionId, startIndex }>` is the accepted-receipt write primitive; `stream(sessionId, { startIndex })` is the replay+live-tail read primitive (replaces `replay()`); `send` = convenience over both; `interrupt(sessionId)` aborts the current turn and `stop(sessionId)` ends/closes the session. `createAgentApp()` becomes an adapter over it. The `@hachej/boring-agent/server` barrel re-exports `createAgent` from `/core` for convenience only; the Fastify-free guarantee is anchored on `/core`.
- Typed config object only: no env-var reads or file discovery inside `createAgent()`; `.pi/*`, workspaces.yaml, env parsing move to host/CLI composition.
- Remove static value imports from agent server composition to built-in mode resolution where needed for pure mode. Type-only `RuntimeModeAdapter` contracts may stay in agent during migration. P1 creates the injection seam only; P2 atomically moves `resolveMode()`/mode adapters to boring-bash/host composition and migrates every importer in the same PR. No compatibility shim, old-path re-export, or host bridge is allowed.
- Package invariant test: no agent value import from boring-bash **[landed: `scripts/check-invariants.mjs` — extend to the façade]**.
- Add the pure `runtime: 'none'` path (no bash bundle spread into `tools`).
- Separate `sessionStorageRoot` from workspace roots.
- Audit pi-coding-agent cwd/resource assumptions (blocks pure-mode exit; decision: sealed pi harness, not a second harness).
- Add the boring-bash-free operational event/command seam (reload, slash commands, compaction/provider recovery, session notices) if route composition changes. (External hook request/callback/redaction contracts are **not** Phase 1 scope — they land in Phase 7.)

## Exit criteria
- pure agent starts via `createAgent({ runtime: 'none' })` with no workspace/sandbox/cwd/file routes/bash tools, in a plain Node script with no Fastify;
- existing direct/local/vercel modes still work through host composition;
- all current HTTP consumers unchanged.
