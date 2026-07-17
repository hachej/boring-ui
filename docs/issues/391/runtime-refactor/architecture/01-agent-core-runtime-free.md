> **Scope status (2026-07-17): retained architecture; outside the current #391
> static critical path.** Decision 25 supersedes only conflicting AgentHost/D1/
> controller/CAS/revision/publication ordering. Implementation requires a current
> consumer-backed tracker and approved plan.

# 01 — Runtime-free `@hachej/boring-agent`

> **V1 scope amendment.** "Runtime-free" names a package boundary, not a v1
> product mode. Decision
> [21](../../../../DECISIONS.md#21-workspace-first-agent-factory-v1-supersedes-public-pure-mode)
> requires every v1 run to be authorized and composed by a workspace with an
> approved runtime/environment. `@hachej/boring-agent` must remain independent
> of Fastify and concrete environment providers, but v1 does not expose
> `runtime: 'none'` or a workspace-less adapter. The pure-mode design and audit
> sections below are retained as post-v1 research, not P1 acceptance.

## Goal

Make `@hachej/boring-agent` an environment- and Fastify-independent
model/session/tool harness that the v1 workspace host composes with an
authorized runtime/environment.

Headless Slack/email/support/concierge/research surfaces remain workspace-backed
in v1; headless means presentation-free, not environment-free.

## Current blocker

The agent server composition still assumes a runtime bundle and imports runtime mode resolution. File/bash/upload tools and file routes are registered by agent server paths.

This creates two bugs in the architecture:

1. `direct` means host filesystem, not no-runtime.
2. Agent-core behavior and HTTP/workspace composition are difficult to change
   independently even though the v1 product intentionally uses both.

## Dependency inversion first

Before moving runtime-mode resolution to `@hachej/boring-bash` and concrete providers to `@hachej/boring-sandbox`, invert composition:

- `createAgentApp()` and `registerAgentRoutes()` receive host-composed runtime
  inputs instead of making built-in runtime choices inside the core boundary.
- Host/CLI/core passes runtime/features in.
- `@hachej/boring-agent` exports only type contracts for features/tool registration.
- A package invariant test fails if agent has value imports from `@hachej/boring-bash` or `@hachej/boring-sandbox`.
- Existing runtime mode support is migrated to workspace host composition
  without changing v1 behavior. Any temporary bridge carries a
  `// TODO(remove:<bead-id>)` marker naming its deletion-owner bead; no marker
  outlives its named owner's phase.

This prevents the cycle:

```txt
bad: boring-agent -> boring-bash -> boring-agent
```

Target:

```txt
boring-core/full-app/cli compose boring-agent + authorized workspace runtime
boring-agent has no bash knowledge except type-level feature hooks
```

## Public core contracts

**No `AgentFeature` abstraction.** There is exactly one prospective contributor (boring-bash), so a `features` registry is a speculative abstraction with a single consumer — forbidden by the no-abstraction-without-two-consumers policy. `createAgent()` config uses the **existing seams directly**: `tools` (extra `AgentTool[]`), `systemPromptAppend` / `systemPromptDynamic`, and readiness gates (`mergeTools({ checkReadiness })` + `registerCapabilitiesContributor`). The workspace host uses these seams without making the core import workspace internals. V1 adds no registry, `AgentFeature`/`AgentFeatureContext` interface, or `features?: AgentFeature[]` config member.

Boring-bash contributes through those seams as a **plain bundle**, not a core
contract. V1 reuses the current workspace composer; the full P3 ownership
extraction is post-v1 and contributes no prerequisite or snapshot. The core
never learns the word "feature".

```ts
interface AgentEnvironment {
  sessionStorageRoot: string
  workspaceId?: string
  agentId?: string
  // No `grants` escape hatch in the P1 config. Typed grant fields arrive in P5/P7,
  // where they are actually consumed (provisioning/secrets, multi-agent scoping) —
  // not as an opaque `Record<string, unknown>` here.
}
```

HTTP routes are owned by the HTTP adapter (`createAgentApp` / `registerAgentRoutes`), which imports and mounts a route module directly (e.g. `registerBashRoutes`) via **host composition** — never through the agent core and never through the bash bundle. The bundle carries tools + readiness + its own prompt fragment only, no route metadata.

Rules:

- Routes are mounted by host composition, not by the core or the bundle. No `Fastify` value/type leaks into shared/front packages.
- `sessionStorageRoot` is transcript/session storage, not workspace file storage.

## Tool resolution law

Tool and renderer contribution order is deterministic and fail-closed:

1. Environment bundle tools/renderers (for example the P3 boring-bash bundle).
2. Plugins, in manifest/resolved plugin order.
3. Host config.

Duplicate tool names are typed errors unless the later source explicitly declares `overrides: true`; there is no silent last-writer-wins merge. The same chain resolves `ToolUiMetadata.rendererId` ownership for tool renderers: a later renderer id may replace an earlier one only with the same explicit override marker. This extends the current seam, it does not add a parallel catalog. Current code reality: `packages/agent/src/server/catalog/mergeTools.ts:29-59` already centralizes `standardTools`, `extraTools`, `pluginTools`, and `checkReadiness`, but today it only logs and overwrites duplicate names; `packages/agent/src/server/catalog/toolReadiness.ts:98-112` wraps merged tools through `checkReadiness`. P1/P3 must change that seam to source-ordered records plus typed duplicate errors while preserving readiness wrapping.

## System prompt composition

The system prompt is **composed**, not inherited wholesale from Pi. Boring owns a capability-neutral **base prompt** containing identity, loop, and response conventions; when the Pi harness is the runtime, this base prompt **replaces Pi's default prompt** instead of being appended after it.

Prompt assembly order is deterministic:

1. Boring base prompt.
2. The active definition's immutable `instructionsRef` asset. In A1 v1 this is
   `instructions.md`; it is the sole agent-authored system-instruction source.
3. Environment/capability fragments from the existing authorized workspace
   composition. Whoever contributes a capability contributes and removes its
   prompt words with the same activation; no P3 extraction is required in v1.
4. Prompt fragments from activated workspace plugins through the existing
   plugin prompt seam: `WorkspaceServerPlugin.systemPrompt?: string` in
   `packages/workspace/src/server/plugins/defineServerPlugin.ts`, plus
   package-manifest `pi.systemPrompt` from
   `packages/workspace/src/shared/plugins/manifest.ts`.
5. The generated index for skills supplied by the active v1 contributions.
   Requirement-based per-skill filtering is the post-v1 P6a extension.
6. Static host `systemPromptAppend`.
7. `systemPromptDynamic` for explicitly per-turn host context.

In v1 the existing authorized workspace composer owns steps 1-6. P6-R consumes
that already-resolved composition plus its host-produced manifest/digest; it
does not build a second `ResolvedStaticPromptPlan`, select fragments, or own a
prompt registry. D1 pins the immutable host artifact and exact workspace-
composition manifest/digest in its complete redacted deployment snapshot so
rollback can rematerialize the same inputs. Per-turn dynamic context remains
outside static identity and cannot register or grant authority.

Plugin discovery or installation is not sufficient to append prompt text. In
v1 the workspace host activates trusted boot plugins from host configuration
for the sole routed `default` agent. The same successfully loaded server record
must drive its tools, Pi skills/resources, prompt fragment, routes, and
versioned front-artifact declaration; scan/discovery metadata cannot feed a
separate prompt stream. Host disable or server import/validation/front-artifact
verification failure before route registration contributes nothing, and a
required internal plugin failure blocks readiness rather than leaving partial
server surfaces. A later browser front import/register failure is a separate UI
diagnostic: it preserves the current previous-good-UI contract and cannot
unregister boot-time Fastify routes or erase an active server contribution. V1
does not add plugin requirement-policy filtering or partial per-agent selection.
`boring.requires`, `pluginRefs`, and independently scoped per-agent plugin
contributions arrive together in the post-v1 schema/resolver.

V1 adds no P3 `ActivatedWorkspacePluginSnapshot`. The existing workspace host
must emit one deterministic redacted composition manifest/digest for the
contributions it actually activates; P6-R consumes that value without loading,
selecting, or persisting plugins. D1 pins the corresponding immutable host
artifact plus that manifest/digest in its own rollback snapshot. A future full
P3 extraction may standardize scoped registrars and plugin snapshot internals
after a named consumer; it is not P1, P6-R, or P8 acceptance.

There is no generic `systemPromptFragmentRefs` list in `AgentDefinition` v1.
Reusable agent-authored prose belongs in the referenced instructions asset;
capability prose stays owned by the contribution that makes the capability
real. This avoids a second prompt registry and makes removal residue-free.

**Post-v1 only:** a future true no-environment consumer would omit the bash bundle and any filesystem
capability fragment. Source-labeled base/host/capability-generated prompt
fragments must contain zero filesystem/bash guidance: no cwd, workspace path,
file tree, `AGENTS.md`, bash/file tool catalog entry, or upload guidance. Do not
apply a word blacklist to the agent-authored `instructionsRef`; ordinary prose
may legitimately use words such as "read" or "find". Platform-generated exact
tool references must fail validation when the named tool is absent from the
harness catalog, while arbitrary authored prose is not parsed as a tool grant.

Capability residue rule: a capability is a complete contribution bundle, not
just a tool list. If the host detaches `boring-bash`, it detaches its tools,
routes, file UI, bash/file tool renderers, file mention/slash composer providers,
prompt fragment, upload affordances, and skills contributed by that bundle
together. The same law applies to workspace plugins: their prompt fragments
cannot be merged independently from their resolved server contribution. The
future no-environment front/API must therefore have no file-search endpoint dependency, no
`@files` composer note, no attachment upload path, no bash/file tool renderer
registration, and no skills contributed only by a detached capability.

Post-v1 P6a lets skills declare lightweight capability requirements using the
same `boring.requires` style reserved for plugin manifests. That is a loader
concern: wherever skills are resolved (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`, `packages/agent/src/server/http/routes/skills.ts`, workspace plugin skill mirroring), the host filters by the capabilities attached to the active agent before adding skills to Pi resources, the `/api/v1/agent/skills` response, slash-command suggestions, or prompt-visible available-skills text. It is not required by the v1 prompt gate.

### Skills prompt fragment law

The prompt-visible skills index is a **generated fragment**, not a hand-authored
prompt block. In v1 it derives from resources supplied by active contributions;
post-v1 P6a derives it from the capability-filtered skill set. Per-skill
`SKILL.md` content remains on-demand as today: the prompt advertises names/
descriptions/locations and the agent reads an individual skill only when needed.

Current repo reality to preserve and filter: the Pi harness merges static and hot-reloadable `additionalSkillPaths`/Pi packages in `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:373-399`, passes them to `DefaultResourceLoader` and `loadSkills(...)` in `createHarness.ts:502-529`, exposes skill diagnostics from `resourceLoader.getSkills()` in `createHarness.ts:622-629`, and exposes slash commands through `resourceLoader.getExtensions().runtime.getCommands()` in `createHarness.ts:643-645`. The `/api/v1/agent/skills` route resolves package skill paths and calls `loadSkills(...)` in `packages/agent/src/server/http/routes/skills.ts:78-103`. Plugin manifest `pi.skills` entries flow from browser-safe manifest fields (`packages/workspace/src/shared/plugins/manifest.ts:31-39`), to scan-resolved `skillPaths` (`packages/workspace/src/server/agentPlugins/scan.ts:272-284`), to the loaded Pi snapshot (`packages/workspace/src/server/agentPlugins/manager.ts:295-305`), and server-owned plugin skills can be mirrored into `.boring-agent/skills` by `packages/agent/src/server/workspace/provisioning/skills.ts:37-74`. Workspace prompt reality already treats skills as a pointer/index, not inline content: `packages/workspace/src/server/boringSystemPrompt.ts:4-14` says the agent reads `SKILL.md` and references on demand, `boringSystemPrompt.ts:77-80` points at `<available_skills>`, and `packages/workspace/src/server/__tests__/boringSystemPrompt.test.ts:123-139` asserts that fallback. P6a inserts the capability filter before each of those outputs is handed to Pi, HTTP, slash suggestions, or the generated prompt index.

## Post-v1 research: true no-environment execution

Do not add this path in v1. If a named post-v1 consumer passes the
reintroduction gate, its explicit composition contract may be equivalent to:

```ts
runtime: 'none'
// no bash bundle spread into `tools`; only host/app-owned non-file tools, if any
```

It registers only:

- chat/session/model routes;
- session store routes;
- non-bash operational hooks explicitly configured by host;
- app-owned tools that do not require files or shell.

Pure mode must not build the harness with `process.cwd()` or any host workspace path. It must pass no cwd, or a sealed virtual root with no host files. This is stronger than "do not mention cwd in prompt"; the harness itself must not have ambient host file authority. Pure mode must also skip or relocate boot-time plugin discovery that currently receives a cwd, unless the host explicitly enables a non-bash plugin source.

It must not register:

- file/tree/search/fs-events/git routes;
- `read/write/edit/find/grep/ls`;
- `bash`;
- `execute_isolated_code`;
- upload/runtime artifact tools bound to a workspace;
- attachment uploads or model-facing attachment metadata that requires workspace file storage;
- cwd, workspace path, or AGENTS.md context in the system prompt.

## Post-v1 research: Pi harness audit

`createPiCodingAgentHarness` must be audited before a future true
no-environment consumer ships. It is not a v1 gate.

Questions to answer:

1. Can pi-coding-agent run with no cwd?
2. Does it auto-load AGENTS.md/CLAUDE.md/workspace resources?
3. Does it inject current directory, file tree, or file tool hints into the prompt?
4. Does compaction assume file tools exist?
5. Does session identity assume workspace root?

Outcome must be explicit:

- Pure mode uses the **sealed pi harness only** — pi with cwd/resource loading disabled and snapshot-tested — per the locked decision in `08-pluggable-agent-surfaces.md` (decision 2) and `00-global-isa.md` (open-decision 1). There is **no** separate non-pi harness option for Phase 1: if the audit shows pi cannot run with cwd disabled/sealed, **STOP and escalate** rather than introducing an alternative harness.

## Non-bash operational seams

Some open issues are agent/session problems, not bash problems. The agent core needs optional seams for them:

### External review/question hooks (#380) — deferred to Phase 7 (NOT P1 scope)

The external-hook request/callback/redaction contract is **not a Phase 1 deliverable**. External hooks depend on durable approvals (the single on-stream approval channel, T1) and on multi-agent target resolution, so the request shape, auth/redaction/callback contract, and target resolution all land in **Phase 7** (`../work/P7-multi-agent-inspection/TODO.md`, BBP7-006), routed onto the T1 approval channel — never a second channel. P1 adds **no** external-hook request/callback/redaction contract and **no** hook route.

### Operational event/command seam (#371, #228, #224)

Expose command/event hooks for reload, slash commands, compaction/provider recovery, and session operational notices without depending on bash.

Do not route these through `boring-bash`; they are agent/session concerns.

## Tool readiness

The agent core should know readiness keys only as opaque gates. Concrete runtime readiness is supplied by the injected tools/bundle (e.g. the boring-bash bundle's `readinessRequirements`), not by a feature registry.

Preserve existing `mergeTools({ checkReadiness })` behavior. Do not replace it with a parallel tool catalog.

## Tests

There is no active no-environment conformance suite in v1. Only if a future
named consumer passes decision 21's reintroduction gate should the following
tests return as acceptance for that new explicit contract:

- pure agent starts without workspace/sandbox/runtime bundle;
- no file/bash/upload routes are registered in pure mode;
- no file/bash/upload tools appear in catalog;
- harness construction receives no host cwd/path, or receives a sealed virtual root with no host files;
- system prompt snapshot has no cwd/workspace/AGENTS.md leakage;
- pi pure-mode audit result is encoded in tests;
- operational command seam works without boring-bash;
- import invariant: `@hachej/boring-agent` has no value import from `@hachej/boring-bash`.

## Acceptance

The v1 area is done when the workspace host can instantiate a useful deployed
agent through the core boundary with deterministic tool/prompt composition,
bounded lifecycle/readiness, actor/origin attribution where required, and no
Fastify or concrete-provider dependency in the core package. Durable admission
and idempotency are T1 unless a current v1 consumer proves they are required.
