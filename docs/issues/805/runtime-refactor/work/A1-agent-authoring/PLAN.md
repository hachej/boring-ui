---
github: https://github.com/hachej/boring-ui/issues/805
issue: 805
state: ready-for-human
updated: 2026-07-17
track: owner
flag: not-needed
---

# A1 — Agent-directory authoring and trusted runtime materialization

## Authority

This is the canonical A1 work-package plan under #805. It supersedes the D1/deployment-oriented A1 plan, handoff, TODO, and old `wt-391-forward-d3y` Bead.

A1 is an active dependency of #391 Step 1A:

- A1 materialization is independently implementable before Step 1A's runtime binding lands.
- `wt-391-forward-o0b.25` remains as a thin integration slice: it consumes A1 output through Step 1A's sole-behavior seam (`o0b.17`) and proves real prompt/tool/readiness/log behavior.
- Step 1A session work (`o0b.18`) remains blocked by that integration slice, not by generic CLI work.
- Seneca integration (`o0b.21`) consumes completed A1 conformance, while production routing remains #391 `1A.10a/b`.

Durable constraints come from Decision 26 and:

- [`../../../../391/plan.md`](../../../../391/plan.md)
- [`../../../../391/ROADMAP-ALIGNMENT.md`](../../../../391/ROADMAP-ALIGNMENT.md)
- [`../../../../391/AGENT-CONSUMPTION-MODES.md`](../../../../391/AGENT-CONSUMPTION-MODES.md)

## Product outcome

A developer can create a focused agent without editing platform package source:

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

Then:

```text
boring-ui agent validate agents/<agent-type-id>
-> validates authoring structure and reports behavior identity/references

trusted host composition
-> compiles the directory in memory
-> resolves explicit host-owned catalogs
-> creates one server-only MaterializedAgentSourceV1
-> runs the agent through the existing workspace-backed runtime

boring-ui agent dev agents/<agent-type-id> --prompt "test request"
-> creates/selects an explicit local workspace
-> resolves only trusted installed catalogs
-> starts the existing local workspace host
-> completes one scripted local turn

boring-ui agent dev agents/<agent-type-id> --serve
-> starts the existing local server without an automatic turn
```

The same directory later drives Seneca's static agent-type binding. There is one source for instructions and declared references. A1 returns a materialized authored source; #391's thin integration slice maps it into the exact runtime behavior type established by `1A.6a`.

## Why recut

The previous A1 plan was coupled to the retired AgentHost/D1 path:

- deployable compiled bundles;
- `AgentDeployment` and workspace `default` resolution;
- definition/deployment/composition/resolved digests;
- D1-R0 migration;
- dedicated deployment materialization.

Decision 26 no longer needs those runtime authorities. Seneca needs a much smaller seam: validated authored content becomes one trusted server-only behavior binding through normal application composition.

The existing compiler from PR #624 is valuable and retained. Its deterministic digest may remain an internal compiler/test diagnostic, but it is not runtime selection, session provenance, deployment identity, publication state, CAS input, or an acceptance requirement.

## Existing code and landed behavior

### Retained compiler

`packages/agent/src/server/agentDefinition/compileAgentDirectory.ts` already:

- reads `agent.json` and `instructions.md` without importing authored code;
- rejects missing, malformed, invalid UTF-8, traversal, and symlink-escape inputs with stable codes;
- validates strict schema version 1;
- requires `instructionsRef: "instructions.md"`;
- freezes the definition/assets;
- emits a checkout-independent `CompiledAgentBundle` and digest.

`packages/agent/src/shared/agent-definition.ts` already defines:

```ts
interface AgentDefinition {
  schemaVersion: 1
  definitionId: string
  version: string
  label?: string
  instructionsRef: string
  capabilityRequirements?: string[]
  toolRefs?: string[]
  skillRefs?: string[]
  mcpServerRefs?: string[]
}
```

A1 does not replace this schema or compiler.

### Missing seam

Today the bundle is not consumed by the running application. Seneca's `scripts/compile-agents.mts` validates and prints a digest, then discards the result. Its `toolRefs` reference a trusted tool implementation, but no runtime catalog binds it. The agent's authored instructions do not become the running agent's prompt.

### Existing runtime composition

Current Agent/Core/Workspace seams already accept:

- `systemPromptAppend`;
- `extraTools`;
- session namespace;
- workspace/runtime composition;
- plugin contributions.

A1 adapts authored content into those existing behavior inputs. It does not create a second runtime composer.

## V1 authoring contract

### Directory layout

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

Only these two files are platform-authored inputs in A1 v1. A `tools/` directory may exist in a host repository for organization, but the generic compiler/materializer never discovers or imports executable modules from it.

### `agent.json`

Allowed fields remain the landed strict `AgentDefinition` schema.

Additional A1 runtime rules:

1. `definitionId` is the agent type identity.
2. For Decision 26 hosts it must follow `^[a-z][a-z0-9-]{0,62}$`. The compatibility workspace type is `default`; its compatibility agent type is `primary`. A1 gives `default` no special agent meaning.
3. A host may supply `expectedAgentTypeId`; mismatch fails before behavior/runtime creation.
4. `version` is author-facing metadata, not a deployment pointer.
5. `instructionsRef` remains exactly `instructions.md` in schema v1.
6. Reference arrays are ordered, duplicate-free, and opaque in authored JSON.
7. Deployment, hostname, workspace, pricing, credentials, roots, provider, sandbox, exposure, registry, and publication fields remain invalid.

### Instructions

`instructions.md` is the only agent-authored prompt asset in v1. The materializer returns its verified UTF-8 content as `systemPromptAppend`.

Environment, governance, workspace plugin, and host policy prompt fragments remain owned by their existing contributions and compose separately. Authors do not copy or override them.

### Tool implementations

`toolRefs` are identifiers, not module paths.

The host supplies a trusted server-only **per-agent allowlist**, not its entire installed catalog:

```ts
type AuthoredAgentToolCatalog = ReadonlyMap<string, AgentTool>
```

In A1 v1, `toolRefs` are additive requests on top of host-standard tools. The final #391 runtime binding still decides the complete tool set.

Required behavior:

- every declared ref resolves exactly once;
- missing refs fail with a stable error before runtime creation;
- A1 adds a stricter authored-tool validator: safe tool-name grammar, non-empty description, non-array JSON-schema object, valid readiness requirements, and executable function shape;
- resolved tool names are unique inside the authored set;
- A1 adds `collisionPolicy: "last-wins" | "error"` to the existing `mergeTools()` seam, preserving `last-wins` as compatibility default and using `error` for authored static/dev bindings;
- final integration detects collisions across standard, authored, and plugin tools before runtime creation;
- catalog functions never enter browser DTOs or serialized authoring output;
- generic A1 never imports `agents/**/tools/*.ts`.

Trusted hosts such as Seneca may import their own tool implementations and construct the per-agent allowlist in normal server composition.

### Other references

A1 v1 materializes instructions and tools only. The landed schema may still parse other reference families for compatibility and `agent validate` reports them, but runtime materialization rejects any non-empty `capabilityRequirements`, `skillRefs`, or `mcpServerRefs` with stable `AUTHORED_AGENT_REFERENCE_UNSUPPORTED` because A1 has no real resolver/contribution seam for them yet.

A later consumer must provide concrete capability-readiness, Pi skill-resource, or trusted MCP binding contributions—not a mere set-membership check—before these families can become runtime behavior. A1 never silently accepts absent behavior.

## Server-only runtime contract

Add a narrow server export in `@hachej/boring-agent/server`:

```ts
type MaterializedAgentSourceV1 = Readonly<{
  schemaVersion: 1
  agentTypeId: string
  version: string
  label?: string
  instructions: string
  tools: readonly AgentTool[]
  declaredToolRefs: readonly string[]
}>

async function materializeAgentDirectory(input: {
  directory: string
  expectedAgentTypeId?: string
  toolCatalog?: ReadonlyMap<string, AgentTool>
}): Promise<MaterializedAgentSourceV1>
```

This is a source/materialization contract, not a competing final behavior type. #391 `o0b.25` maps it into the behavior-input type landed by `o0b.17`. The exact names may change during API review, but semantics are fixed.

### Contract rules

- server-only export; no shared/front value export;
- compiles the directory in memory using `compileAgentDirectory()`;
- extracts verified instructions by `instructionsRef`;
- validates agent type grammar and optional expected ID;
- in A1.1, ref-free directories return `tools: []` while any non-empty `toolRefs` fails with `AUTHORED_AGENT_CATALOG_REQUIRED`;
- in A1.2, the same API becomes the sole catalog resolver and validates all declared tool refs fail-closed;
- copies/freezes every returned array and object;
- rejects non-empty capability/skill/MCP refs as unsupported in v1;
- does not expose `CompiledAgentBundle`, digest, asset paths, filesystem root, executable catalog, runtime handle, or credentials in the returned source;
- does not create Workspace, Sandbox, sessions, routes, or model runtime;
- does not cache across calls in v1;
- errors use canonical Agent stable codes and redact paths/catalog values from user-facing output.

## Stable errors

Freeze these canonical Agent codes in the plan before implementation:

- `AUTHORED_AGENT_ID_INVALID`
- `AUTHORED_AGENT_TYPE_MISMATCH`
- `AUTHORED_AGENT_CATALOG_REQUIRED`
- `AUTHORED_AGENT_CATALOG_INVALID` — safe trusted-host fault for catalog resolver/proxy failures (500/report-bug), never a user-authored unknown-ref diagnostic
- `AUTHORED_AGENT_REFERENCE_UNKNOWN`
- `AUTHORED_AGENT_REFERENCE_UNSUPPORTED`
- `AUTHORED_AGENT_TOOL_INVALID`
- `AUTHORED_AGENT_TOOL_COLLISION`

CLI command parsing additionally freezes `AUTHORED_AGENT_DEV_USAGE_INVALID` for bare `agent dev`, simultaneous `--prompt`/`--serve`, missing prompt text, or incompatible local-dev options.

A missing instruction asset after successful compilation is an internal invariant failure, not a normal public input error. Compiler path/JSON/schema errors retain existing codes.

CLI JSON failures use:

```ts
type AgentCliErrorV1 = {
  schemaVersion: 1
  ok: false
  error: { code: string; field?: string; message: string }
}
```

Messages never disclose absolute paths, catalog contents, implementations, prompt content, or secrets.

## CLI contract

### `boring-ui agent validate <dir>`

Add an `agent` command group to `@hachej/boring-ui-cli`.

`validate`:

- calls the retained compiler;
- validates product-safe `definitionId` grammar;
- reports `definitionId`, version, label, instructions presence/byte length, and declared reference names/counts;
- supports machine-readable `--json` output with this versioned, non-executable envelope:

```ts
type AgentValidateSuccessV1 = {
  schemaVersion: 1
  ok: true
  agent: {
    agentTypeId: string
    version: string
    label?: string
    instructions: { present: true; byteLength: number }
    refs: {
      tools: string[]
      capabilities: string[]
      skills: string[]
      mcpServers: string[]
    }
  }
}
```

- exits non-zero with the frozen `AgentCliErrorV1` code/field diagnostics on failure;
- never prints absolute paths, prompt content, tool implementations, credentials, or a deployment identity;
- does not advertise the compiler digest as runtime provenance.

Directory-only validation does not claim refs are runtime-resolvable. Host conformance validates catalogs separately.

### `boring-ui agent dev <dir>`

`dev` is a local developer workflow, not production deployment. Exactly one mode is required:

- `--prompt <text>`: one non-listening turn, then dispose;
- `--serve`: listen until shutdown, with no automatic turn.

Bare `agent dev` and supplying both modes fail with `AUTHORED_AGENT_DEV_USAGE_INVALID` before workspace/runtime side effects.

Required behavior:

1. validate/materialize the authored directory;
2. resolve tool refs only from an explicit trusted CLI catalog package/adapter; ref-free agents require no catalog;
3. create or select an explicit local workspace through existing CLI workspace storage;
4. use a new embeddable dev-app seam over the existing Workspace/Agent lifecycle, accepting the already materialized source, runtime policy, workspace, and dispatcher callback;
5. default to `local-sandbox`; direct host execution requires explicit `--allow-direct` and never auto-falls back;
6. default to `externalPlugins: false`, plugin authoring disabled, and no ambient skills; trusted-local resources require explicit opt-in;
7. `agent dev <dir> --prompt <text>` runs one non-listening turn and disposes;
8. `agent dev <dir> --serve` starts the local server without an automatic turn;
9. attach authored instructions/tools through normal server options and collision policy `error`;
10. report redacted workspace ID, agent type, runtime mode, and session ID;
11. close/dispose through the existing lifecycle exactly once.

It must not:

- create `AgentDeployment`;
- compute composition/resolved deployment digests;
- use AgentHost/request-scope authority;
- import arbitrary authored TypeScript;
- silently drop unresolved refs;
- silently fall back to direct/unapproved runtime;
- enable ambient plugins/skills by default;
- create a second Workspace/Sandbox composer;
- claim production parity or domain routing.

A purpose-built capture harness must prove the prompt received by the model loop and invoke one resolved test tool. The existing fixed scripted harness may remain for route/lifecycle smoke but cannot prove authored behavior.

Until Step 1A persisted workspace types land, local dev uses the existing compatibility/default local workspace path. The seam must allow the later typed local workspace to be supplied without changing authored behavior.

## Seneca boundary

A1 reusable code ends at validated server behavior plus CLI/local proof.

Seneca later owns:

- importing its trusted tool implementations;
- constructing its tool/skill/MCP/capability catalogs;
- mapping its validated agent directories to static `agentTypeId` declarations;
- domain and workspace-type product configuration;
- production auth, deployment, observability, and rollback.

Step 1A `1A.10a/b` proves that Seneca's authored instructions and refs materially drive runtime behavior. A1 does not edit Seneca production code as part of its reusable package slices.

## Security and trust model

- Authored JSON/Markdown are untrusted data and are parsed/read without code import.
- Host catalogs are trusted server code.
- Prompt/tool selection is product behavior, not filesystem/process isolation.
- Workspace membership and Core typed request context remain authority; A1 never authorizes a workspace.
- A1 never accepts browser-supplied directory, root, agent type, catalog, or runtime handles in production routes.
- Local CLI paths are operator-supplied and remain confined by compiler path checks.
- Tool refs cannot name filesystem paths or trigger dynamic imports.
- Error/log output is redacted and stable.

## Test seams

### Highest public seams

- `materializeAgentDirectory()` server source API;
- existing `mergeTools({ collisionPolicy })` runtime seam;
- existing `compileAgentDirectory()` compiler;
- `boring-ui agent validate` process boundary;
- `boring-ui agent dev` process/workspace lifecycle boundary;
- package export maps proving server-only visibility.

### Existing prior art

- `packages/agent/src/server/agentDefinition/compileAgentDirectory.ts`
- `packages/agent/src/server/agentDefinition/__tests__/compileAgentDirectory.test.ts`
- `packages/agent/src/shared/agent-definition.ts`
- `packages/agent/src/shared/error-codes.ts`
- `packages/agent/src/server/catalog/mergeTools.ts`
- `packages/agent/src/shared/tool.ts`
- `packages/agent/src/shared/validateTool.ts`
- `packages/agent/src/server/testing/scriptedPiHarness.ts` (lifecycle smoke only)
- `packages/agent/src/server/registerAgentRoutes.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/cli/src/server/cli.ts`
- `packages/cli/src/server/localWorkspaces.ts`
- `packages/cli/src/__tests__/cli.integration.test.ts`

### Avoid testing

- private helpers when the public materializer proves behavior;
- digest values as runtime authority;
- deployment resolution or AgentHost behavior;
- arbitrary module loading from authored directories;
- Seneca production domain routing inside reusable A1 tests.

## Acceptance

A1 is complete when:

1. the landed compiler remains deterministic/import-free/path-contained;
2. an authored directory materializes one frozen server-only source;
3. the embeddable dev seam maps that source into existing runtime options without a second composer, while #391 retains a later thin product-integration proof;
4. verified instructions become the captured model prompt input;
5. tool refs resolve from a per-agent allowlist or fail, while capability/skill/MCP refs reject as unsupported;
6. host tools are strict-validated and collision-safe; authored executable code is never imported;
7. expected agent type mismatch and invalid IDs fail with the frozen codes;
8. browser/shared exports contain no behavior functions, prompt contents, roots, or catalogs;
9. `agent validate` supports human and versioned JSON output without deployment provenance claims;
10. `agent dev` defaults sandboxed, disables ambient resources, and proves prompt/tool behavior through one existing runtime lifecycle;
11. no AgentDeployment/controller/CAS/registry/second composer is added;
12. Agent/CLI builds/tests, packed consumer/bin smoke, full-app compatibility, invariants, and independent review pass;
13. docs and Seneca's A1 README describe the same boundary before product integration.

## Implementation slices

### A1.0 — Canonical recut and Bead graph

**Delivers:** this plan, rewritten handoff/TODO, #805 index activation, replacement of old D1 A1 Bead, and cross-dependencies into #391 Step 1A.

**Proof:** plan links, `br lint`, `br dep cycles`, `bv --robot-insights`, independent Sol xhigh review, `git diff --check`.

### A1.1 — Server materialized-source contract

**Delivers:** frozen server-only `MaterializedAgentSourceV1`; verified instruction extraction; product ID grammar/expected-ID checks; unsupported capability/skill/MCP rejection; the eight frozen materializer errors and CLI error envelope; no runtime side effects. Ref-free definitions return `tools: []`; non-empty `toolRefs` fail `AUTHORED_AGENT_CATALOG_REQUIRED` until A1.2 adds the sole resolver.

**Blocked by:** A1.0 plan merge only. This contract deliberately precedes #391's final behavior type.

**Proof:** focused Agent server tests, server/shared/front export audit, typecheck/build, invariants, security/API review.

### A1.2 — Trusted tool allowlists and collision-safe merge

**Delivers:** per-agent tool-ref allowlist resolution; strict authored-tool validation; deterministic declared-order output; `mergeTools` collision policy with compatibility default `last-wins` and authored `error`; redacted stable failures; no dynamic imports.

**Blocked by:** A1.1.

**Proof:** absent catalog/ref, unsupported ref families, invalid name/schema/readiness/execute, duplicate output name, standard/authored/plugin collision, freeze/mutation, compatibility last-wins, and no-import tests; Agent package build/typecheck/tests and security review.

### A1.3 — CLI validate command

**Delivers:** `boring-ui agent validate <dir>` human/JSON output and stable process exit behavior.

**Blocked by:** A1.1. It may plan in parallel with A1.2 but shares Agent/CLI exports, so implementation writers remain serialized unless isolated and conflict-free.

**Proof:** CLI integration tests across valid/malformed/missing/traversal/schema/reference-report cases; snapshot/redaction/export review.

### A1.4a — Embeddable local dev-app seam and capture harness

**Delivers:** narrow server API accepting already materialized source, explicit workspace, runtime policy, and dispatcher callback; maps resolved instructions/tools into existing Workspace/Agent options exactly once; disables ambient plugins/skills by default; collision policy `error`; purpose-built capture harness proving prompt and tool invocation; exact lifecycle/disposal.

**Blocked by:** A1.2.

**Proof:** captured prompt/tool/context, ref-free and catalog cases, external-resource-disabled defaults, one runtime/disposal, no second composer, Agent/Workspace/CLI server tests and architecture/security review.

### A1.4b — Workspace-backed `agent dev` CLI workflow

**Delivers:** `boring-ui agent dev <dir> --prompt <text>` one-shot and `--serve` modes with exactly one required; stable usage failure for bare/both modes; explicit local workspace; sandbox default; `--allow-direct` only explicit; trusted catalog adapter; redacted identity output; process exit/disposal.

**Blocked by:** A1.3 and A1.4a.

**Proof:** subprocess tests for one-shot/serve, sandbox default, direct denial/opt-in, unresolved/unsupported refs, no ambient resources, captured authored prompt/tool, lifecycle/disposal, and existing CLI command compatibility.

### A1.5 — A1 conformance, package proof, and documentation freeze

**Delivers:** example authored directory; validate -> materialize -> dev proof; packed Agent/CLI tarball consumer; installed-bin smoke; updated Boring and Seneca authoring docs; exact rollback record.

**Blocked by:** A1.4b.

**Proof:** clean Agent/CLI build/typecheck/tests, packed consumer server-only import positives and shared/front negatives, installed-bin validate/dev smoke, purpose-built behavior capture, import scan proving no authored modules loaded, relevant full-app tests, `pnpm lint:invariants`, `pnpm check:golden-path`, independent Standards/Spec/Thermo review.

## Dependency graph

Epic: `wt-391-forward-c0u`.

```text
c0u.1 A1.0
-> c0u.2 A1.1 materialized source
-> c0u.3 A1.2 trusted tools/collision policy

c0u.2 -> c0u.4 A1.3 validate CLI
c0u.3 -> c0u.5 A1.4a embeddable dev seam
c0u.4 + c0u.5 -> c0u.6 A1.4b dev CLI
c0u.6 -> c0u.7 A1.5 conformance/docs

#391 1A.6a (o0b.17) + A1.2 (c0u.3)
-> #391 1A.6b thin runtime integration (o0b.25)
-> #391 1A.7 session identity (o0b.18)

#391 1A.8b (o0b.26) + A1.5 (c0u.7)
-> #391 exact release qualification (o0b.20)
-> Seneca integration (o0b.21)
```

A1.3 planning may overlap A1.2, but one writer owns overlapping files. The orchestrator dispatches one implementation slice per isolated `.worktrees/` worktree, then runs worker -> Sol-high reviewer -> worker correction loops until clean.

## Rollout and rollback

All APIs/commands are additive.

- Materializer is unused until a host opts in.
- CLI commands do not affect existing default command behavior.
- Revert A1 package/CLI commits before release to remove the feature.
- After release, restore the last-known-good authored directory and per-type binding plus the prior exact compatible package cohort; corrective releases never rewrite published versions.
- Never map a non-default workspace type to compatibility agent `primary` during rollback.
- After #391 session identity lands, preserve the agent-specific namespace/history and use the typed-aware rollback floor from `1A.8b`.
- Executed production rollback remains #391 `1A.8b/1A.10b`, not A1.5.
- Authored directories remain plain JSON/Markdown and require no data migration.

## Out of scope

- Domain/workspace-type routing and persisted workspace type.
- Multiple agents in one workspace or selection UI.
- External MCP/A2A or contracted agents.
- Dynamic registry/install/update/control plane.
- AgentDeployment, definition/deployment/composition/resolved runtime provenance.
- Compiled bundle storage, CAS, publication, watcher, or upload.
- Importing authored executable modules.
- Sandbox custom-tool subprocess execution.
- Generic environment attachment, provider extraction, or mounts.
- Production Seneca deployment.

## Stop conditions

Stop and amend rather than improvise if:

1. existing Agent server options cannot accept authored instructions/tools without a second composer;
2. runtime tool resolution would require importing untrusted authored modules;
3. local dev cannot use the existing workspace/runtime lifecycle;
4. the materializer would need browser/shared executable exports;
5. capability/skill/MCP refs cannot be rejected clearly without changing the landed schema;
6. compiler/public API changes would break a published consumer;
7. implementation begins restoring deployment/CAS/controller concepts.
