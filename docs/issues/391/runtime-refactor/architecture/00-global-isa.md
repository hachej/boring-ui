# 00 — Global ISA: intent, strategy, architecture

ISA here means **Intent, Strategy, Architecture**.

> **Accepted v1 amendment (2026-07-10): workspace-first execution.** Decision
> [21](../../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode)
> supersedes the public `pure`, `runtime: 'none'`, and workspace-less v1 path
> described in older sections of this pack. The long-term core remains
> environment- and Fastify-independent, but every v1 local or deployed run is
> authorized through a workspace and an approved runtime/environment.
> `headless` means no UI surface; it does not mean no workspace. Historical
> pure/no-environment contracts below are post-v1 research unless a named
> consumer and a stronger explicit contract pass the reintroduction gate.

> **Binding topology amendment (2026-07-11).** Decision
> [23](../../../../DECISIONS.md#23-multi-agent-docker-first-deployment-topology)
> supersedes dedicated-tenant and runsc-first v1 sequencing below. V1 first
> applies a finite boot/deploy-time collection of N exact-host -> authorized
> workspace -> deployed-`default` bindings to one EU Docker image/compose host;
> a dedicated VM running the same artifact is variant 2. P5a is conditional on
> a D1-R0-demonstrated missing host seam. P2 provider extraction and X1 mounts
> merge last. Older dedicated/runsc-first passages are historical context, not
> dispatch authority.

## Intent

Make boring-ui an agent factory that preserves a clean agent core while using
the workspace as the v1 authorization, composition, and execution boundary.

Today `@hachej/boring-agent` is too coupled to `Workspace + Sandbox + FileSearch`. We want:

- headless agents with no UI surface but with an authorized workspace and approved runtime/environment;
- optional working environments for coding/file tasks through `@hachej/boring-bash`;
- multiple agent personalities/runtimes inside one deployed app and one workspace;
- child apps such as Macro hosted inside the same full-app deployment without leaking tools/prompts/provisioning into generic workspaces;
- **(v2)** the agent mountable behind any surface — boring-ui workspace (first-class UI), Slack, spreadsheet embeds (pi-excel), CLI/cron — each surface a thin ingress/egress adapter over one event-stream contract; see [`08-pluggable-agent-surfaces.md`](08-pluggable-agent-surfaces.md).

### North star (v2 product vision)

The owner's vision, in one sentence: **eve-style DECLARATIVE authoring that ships agents fast, natively integrated into the boring-ui FARM, open to foreign agents.** Land on an **eve-class UX** (`vercel/eve`) — author an agent, deploy it, converse with it from any channel, inspect it — but **steered from the boring-ui workspace** and **hosted in Europe**:

- **eve-style declarative authoring (ship agents fast)**: an `agents/<name>/`
  directory compiles to a self-contained content-addressed bundle containing a
  versioned behavior-only `AgentDefinition` and immutable referenced assets;
  the host combines it with a separate `AgentDeployment` and records an
  immutable `ResolvedAgent` digest. Local development and D1 multi-agent Docker delivery
  consume the same authored definition through workspace composition, so the
  minimal compiler is no longer deferred. The compiler does not invent a
  workspace-bundle schema: `agents/<name>/` remains the authoring shape.
- **the boring-ui FARM, natively integrated**: the workspace is not just a chat surface — it is the **farm control plane**: **fleet view** (every agent + session across every surface), **tasks** (work items linked to sessions), **artifacts** (outputs agents publish from their environments — 08 `data-artifact`), and **approvals** (one inbox, `resolveInput`). This epic ships the *substrate*; the farm UI is the next epic (VISION farm row).
- **OPEN integration — foreign agents join the farm**: a non-boring agent (Claude Code, Codex, any MCP client) can attach an environment (E2 MCP projection) and — deferred — create tasks / publish artifacts / request human input over a **Farm MCP** control-plane surface (08 Farm-MCP note). The farm is open, not a walled garden.
- **Flue's internals**: durable indexed event streams, channel ingress packages, `SessionEnv`-shaped environments (already adopted — 08/09).
- **boring-ui's existing UX**: the workspace stays the first-class surface and becomes the **control plane** — the one place to author agents, wire channels/environments, watch sessions across every surface, and answer approvals (08 "The steering surface").
- **PLUGIN-extensible host product**: both the workspace UI and the agents inside it are extensible by third parties — internally and externally — over real APIs (`definePlugin`/`defineServerPlugin`, `/api/v1/plugins/:pluginId/*`, the `boring-ui-plugin` CLI). eve/Flue extend *your own* agent; boring's plugin layer lets others extend the *host product* without forking it. See [`08-pluggable-agent-surfaces.md`](08-pluggable-agent-surfaces.md) "Plugin-extensibility" (with honest caveats: external plugins are trusted local code, hosted-iframe is future, `full-app` ships `externalPlugins:false`).
- **EU-sovereign hosting**: see invariant 15; deployment tiers/providers in [`10-sandbox-deployment-eu.md`](10-sandbox-deployment-eu.md).

## Business horizons

Grounded in the owner's strategy (the boring-ui-factory brain); the epic builds the shared substrate, not any one commercial topology. **Do not build ahead of these — they frame *what the architecture must not preclude*, not this epic's scope.**

- **Horizon 1 — now, services-led.** Named vertical agents (**Engagement Analyst** — sovereign deck+model agent for consulting boutiques; **MacroAnalyst** — sovereign macro/investment-research agent) deployed and managed on **dedicated sovereign tenants**, offered **managed OR as a self-host handoff**. The **farm is INTERNAL leverage** here — the factory that delivers client work (dogfooded to build/research/generate artifacts), not a product sold to clients.
- **Horizon 2 — post 3+ repeats.** After the same SSO/governance/workroom pattern recurs across 3+ deployments, productize a **white-label "AI Analyst Workroom"** for consultancies/fiduciaries to resell; the **farm becomes client-facing**.
- **Horizon 3 — 2027+.** A **hub-and-spoke** shape: a **free local CLI ⇄ hosted specialist agents** via **MCP delegation**, with **artifacts delivered cross-org**. This is the open-integration end state (foreign agents + the E2 MCP projection + `data-artifact`), not a near-term build.

**Architecture rule: one deployable artifact; topology is the product line.** The same build may eventually run single-tenant self-host, managed sovereign tenant, shared tenant, or hub-and-spoke — the *topology* is the commercial choice, not a code fork. Version 1 proves one EU Docker image/compose host with N exact-host/workspace/default-agent bindings; a dedicated VM is the second composition. It must not force marketplace, billing, FUSE, or a shared multi-tenant control plane while keeping later adapters possible.

**Open tension (verbatim-ish, owner to resolve):** the current STRATEGY.md leans to a **managed retainer** default, while the older decision log has **clients owning ops** (self-hosted handoff). The architecture **supports both** (one artifact, either topology); the **commercial default is TBD by the owner** — the plan pack does not pick one.

## Target package ownership

| Package | Owns | Must not own |
| --- | --- | --- |
| `@hachej/boring-agent` | model loop, sessions, runner API, tool registry, channel-neutral event seam, and methodless resolved capability facts — **defines its consumed contracts, imports neither boring-bash nor boring-sandbox**; durable admission/idempotency remains a later T1 responsibility | filesystem, file routes, bash, file UI, concrete sandbox providers, environment preparation, provider lifecycle, provisioning execution |
| `@hachej/boring-bash` (THE RUNTIME) | optional fs + exec working environment, path safety, search/watch, file routes/tools/UI, requirement normalizer, extracted environment provisioning engine/runners/fingerprints, **runtime-mode resolution (`resolveMode` = the CHOICE of sandbox)**; imports sandbox **values** + agent **types** | auth, billing, app membership, LLM harness core, host orchestration, concrete sandbox providers/mount/lifecycle |
| `@hachej/boring-sandbox` (sandbox management) | concrete providers (`direct`, `bwrap`-gVisor, `vercel`-PROXY, `remote-worker`-client), **FUSE-S3 mounts**, sandbox lifecycle, provider **capability facts (`reported \| unknown`)**; imports agent **types only** | model loop, sessions, file routes, bash tools, file UI, runtime-mode resolution (owned by boring-bash), auth/billing |
| `@hachej/boring-workspace` | UI shell, layout, plugin host, UI bridge/RPC, surface registry | agent model loop, concrete bash providers |
| `@hachej/boring-core` / app composition layer | auth, DB, workspaces, definition/deployment resolution, provisioning orchestration, prepared-environment ownership, child-app context resolution, billing, deployment composition | model loop, concrete provider internals outside injected adapters |
| surface/channel packages (v2, e.g. `@hachej/boring-channel-slack`, spreadsheet embeds) | platform ingress/egress, platform auth, surface-owned continuation/addressing → `sessionId` mapping, event projection | agent loop, sessions, tools, provider internals, boring-bash server code |

Non-negotiable: `@hachej/boring-agent` has **zero value imports** from `@hachej/boring-bash` **or `@hachej/boring-sandbox`** (it defines the contracts both consume, and imports neither). Bash + sandbox are injected by host/CLI/composition. **Acyclic layering (owner-ruled):** `boring-sandbox → boring-agent` (types only); `boring-bash → boring-sandbox` (values) `+ boring-agent` (types). boring-bash is THE RUNTIME (the CHOICE of sandbox, `resolveMode`); boring-sandbox is sandbox management (providers, FUSE-S3 mounts, lifecycle, capability facts).

Provisioning ownership rule: v1 does not move the generic provisioning engine.
D1-R0 first proves whether the Docker host lacks a readiness or secret-
brokerage seam; only a demonstrated gap permits a narrow P5a slice. P5a does
not select a sandbox provider or make runsc a D1 prerequisite. The host owns
authority, orchestration, prepared resources, and disposal; agent consumes only
bound tools, prompt/readiness inputs, input handling, and methodless facts.
Post-v1, a named second consumer may justify moving requirement normalization
and environment runners/fingerprints to `@hachej/boring-bash/server`, while
`@hachej/boring-sandbox` continues to own provider adapters/facts. No
agent-owned provisioning contract or compatibility re-export is introduced.

## What we learned from Flue

- `SessionEnv` is the key seam: file tools, programmatic fs, shell, grep/glob all share one backing environment.
- Conversation/session durability does not imply sandbox/file durability.
- Durable submissions need stable environment identity and conservative recovery.
- Subagent profiles are useful for cheap delegation but normally share parent environment; they are not enough for isolated agent sandboxes.
- Default fs/bash tools are too powerful for every agent. The v1 workspace host
  must resolve the least-capable approved runtime/environment and tool set for
  the deployed agent; it must not silently expose the full coding workspace.
- Transcript-visible shell operations and out-of-band host fs plumbing are different contracts.

## What we learned from eve

- Filesystem-discovered slots are excellent DX: `agent.ts`, `instructions.md`, `tools/*`, `skills/*`, `subagents/*`, `channels/*`, `connections/*`, `sandbox/workspace/**`.
- Discovery should be import-free; compile/runtime can reattach live exports later.
- Path-derived names avoid drift.
- Authored tools/routes can override or disable framework defaults.
- Declared subagents as separate runtime nodes are the right model for different sandbox/tool policies.
- Sandbox lifecycle should separate reusable template/bootstrap from live session setup.
- `/workspace` as one model-visible namespace prevents split brain.
- Read-before-write/stale-write stamps are worth stealing for model-facing file edits.
- Provider labels are insufficient; a capability matrix must say real bash, real binaries, network isolation, and persistence semantics.

## What we learned from the surface/transport survey (v2)

Vercel AI SDK v5/v6, eve channels, Flue channel packages, Claude Agent SDK, and Slack Bolt AI apps converge on one boundary contract between an agent core and any surface: **message in / indexed replayable event stream out / approvals as request→response events on the same stream / runtime-owned session id with surface-owned addressing**. Details and adopted rules: [`08-pluggable-agent-surfaces.md`](08-pluggable-agent-surfaces.md).

## Direction

Build one platform with five clean layers (v2 extends the original three):

```txt
Surfaces         workspace UI | Slack | pi-excel | CLI — ingress/egress adapters only
Transport        in-process | HTTP+SSE | future WS/durable — send + reconnect
Agent core       model/session/tool loop; no implicit runtime; typed event stream
Feature layer    optional UI, bash, web, plugin, approval, search capabilities
Runtime layer    concrete storage/sandbox/provider implementation
```

Then one deployed app can host:

- generic Seneca coding workspaces;
- Macro child-app workspaces;
- concierge/support agents with no files;
- reviewers with readonly files and no shell;
- coding agents with full bash;
- hosted iframe plugins with no backend code;
- trusted internal plugins with explicit server/runtime requirements.

## Current seams to reuse, not replace

This repo already has real seams. The refactor must extend them:

- `disableDefaultFileTools`;
- `buildHarnessAgentTools()` for `bash` / `execute_isolated_code`;
- `buildFilesystemAgentTools()` for `read/write/edit/find/grep/ls`;
- `buildUploadAgentTools()`;
- `workspaceFsCapability` on runtime modes;
- `RuntimeBundle.storageRoot`, `Workspace.root`, `WorkspaceRuntimeContext.runtimeCwd`, and `getRuntimeBundleStorageRoot()`;
- `provisionWorkspaceRuntime()` with merge-by-id, fingerprint skipping, and `WorkspaceProvisioningResult.changed`;
- `RuntimeDependencyReadiness`, `ReadyStatusTracker`, and `mergeTools({ checkReadiness })`;
- `registerCapabilitiesContributor`;
- workspace-owned `/api/v1/ui/*`, `exec_ui`, `get_ui_state`, `WorkspaceBridge`, and `/api/v1/plugins/:pluginId/*`.

## Non-negotiable invariants

1. **(v1 delivery)** Every local and deployed agent run is authorized through a
   workspace and an approved runtime/environment. `headless` removes the UI
   surface only. There is no public/product `runtime: 'none'` or workspace-less
   v1 mode.
2. Bash and file APIs are optional and live in `@hachej/boring-bash`.
3. File routes/search/watch/bash/git/status must use the same source of truth.
4. Partial file exposure with shell is physical: mount/seed only allowed files for untrusted exec.
5. Session history durability and file/workspace durability are separate.
6. Plugins/agents declare requirements; hosts resolve and intersect policy. No silent widening.
7. Provider fallback is policy-driven. Never silently downgrade isolation or capability.
8. Child-app/workspace-kind policy can narrow defaults and requirements.
9. Users are principals/supervisors/approval channels, not model-callable root agents.
10. Open backlog issues are not automatically solved; the abstraction only supplies the spine.
11. **(v2)** Surfaces never own the loop: a surface package depends only on the public agent contract, never on provider internals or boring-bash server code.
12. **(v2)** Two handles: `sessionId` is runtime-owned; continuation/addressing is surface-owned. **"Platform addressing" = surface-native identifiers** (Slack team/channel/thread ts, workbook/sheet ids, workspace pane ids); public agent APIs never accept these. `SessionCtx { workspaceId, userId? }` is boring's OWN runtime tenancy context (the `SessionStore` key) and is explicitly ALLOWED on the façade — it is not platform addressing. A raw `x-boring-workspace-id` header resolves to a `SessionCtx` in the adapter.
13. **(v2)** One approval channel: HITL is declared on the tool and travels as stream events; no per-surface approval side channels.
14. **(v2)** Secrets stay on the trusted core side; credentials are brokered at the environment boundary and never enter the sandbox process or the model transcript.
15. **(v2)** EU-sovereign defaults: every default component of the platform (event store, session store, sandbox providers, remote workers, channel egress) is self-hostable on EU infrastructure. US-hosted providers (e.g. `vercel-sandbox`) are strictly optional providers behind the standard capability matrix — never the default path, never a hard dependency.
16. **(v2)** Capability residue: every capability travels as a complete bundle (tools + routes + UI + renderers + prompt fragment + composer providers + skill filters). Detaching a capability leaves **zero residue** in prompt, UI, or API surface. In v1, a workspace whose policy excludes filesystem capability shows no filesystem vocabulary anywhere; a future no-environment consumer must pass the same conformance law.
17. **(v1 delivery)** Definitions and deployments are separately versioned.
    P6-D owns immutable definition lookup only; P6-R is stateless. D1's complete
    redacted site snapshot pins every site desired-state input. P7 owns the
    first registry of stateless P6-R outputs. D2 alone owns
    `SharedTenantAgentDeclaration` and consumes that P7 registry; no Phase 6
    resolved registry or shared declaration exists.
18. **(post-v1 reliability)** T1 owns restart-durable admission, caller request
    idempotency, and durable actor/origin event metadata. P1 owns only the
    workspace-composed boundary and bounded agent-local lifecycle. R0/M1 may use
    a bounded process-local receipt map keyed by subject + `workspaceId` +
    `deploymentId` + `agentId` + caller idempotency key and must state that
    restart can lose it.

## Issue coverage posture

Do not overclaim. This abstraction directly owns #391 and materially advances parts of other issues only when their acceptance criteria land.

Materially advanced by this plan:

- #12 harness pluggability, if pure runtime-free harness acceptance passes;
- #242 app assembler / route composition, if dependency injection lands;
- #16 and #223 runtime/provider abstraction, if provider capability matrix lands;
- #26, #220, #221 file API/UI ownership, if file routes/tools/UI move;
- #357, #254, #256 plugin/runtime capability declaration, if plugin validation/runtime context lands;
- #243, #211 multi-agent/session scoping foundations, if route/session/search work lands.

Explicitly not fully solved but must be supported by extension points:

- #376 child-app platform / Macro hosted in full-app;
- #380 external harness hooks;
- #379 session-history search;
- #307 remote-worker hardening;
- #181 secrets;
- #328/#258 managed plugin services;
- #295 file tree replacement;
- #367/#226 document-authoritative collaboration;
- #189 git/source-of-truth consistency;
- #371/#228/#224 provider recovery and operational commands.

## Open decisions before implementation

v2 status — resolved (recommendations locked in [`08-pluggable-agent-surfaces.md`](08-pluggable-agent-surfaces.md), to be ratified in the Phase 0 ADR):

1. Pure/headless mode: **superseded for v1 by decision 21.** V1 keeps the
   existing pi harness behind workspace composition and an approved runtime.
   A true no-environment consumer is post-v1 and must be named before its
   harness contract is chosen; it must not be introduced as another mode label.
2. Multi-mount/overlay: superseded — named `(filesystem, path)` bindings shipped via #416; arbitrary overlays stay deferred.
3. Providers package location: **RESOLVED** — concrete providers do **not** live under `@hachej/boring-bash/providers`; they live in a dedicated **`@hachej/boring-sandbox`** package (sandbox management: providers, FUSE-S3 mounts, lifecycle, capability facts `reported | unknown`). The three-package stack is: `boring-agent` (contracts, imports neither) ← `boring-bash` (THE RUNTIME: fs/tools/routes/UI + bash + runtime-mode resolution `resolveMode`; imports boring-sandbox values + agent types) ← `boring-sandbox` (imports agent types only). Acyclic. See 08 decision 11; P2 creates the package (PR-PLAN P2).
4. Multi-agent route shape: **resolved (locked at pass 3)** — one canonical `/api/v1/agents/:agentId` path-prefix family (see `../work/P7-multi-agent-inspection/TODO.md`). There is no header/request-scope alternative.
6. Readonly fs: **v1 — already landed** via #416.

Deferred carryover ratified in [`docs/DECISIONS.md` §19](../../../../DECISIONS.md#19-runtime-free-agent-core-and-pluggable-surfaces):

5. Provisioning sharing defaults — deferred to **P5 provisioning/readiness**;
   P6-D owns immutable definition lookup only, P6-R remains stateless, P7 owns
   the first registry of P6-R outputs, and D2 alone owns
   `SharedTenantAgentDeclaration` and consumes the P7 registry.
7. (v2) Surface `addressing → sessionId` map persistence — deferred to **T2 transport**, **S1/S2 concrete surface stores**, and **P7 agent scoping**.
