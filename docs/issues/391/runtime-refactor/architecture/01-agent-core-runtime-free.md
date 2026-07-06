# 01 — Runtime-free `@hachej/boring-agent`

## Goal

Make `@hachej/boring-agent` a model/session/tool harness that can run with no filesystem and no sandbox.

A pure agent must be valid for Slack/email/support/concierge/research workflows where the only state is session history plus app-owned tools.

## Current blocker

The agent server composition still assumes a runtime bundle and imports runtime mode resolution. File/bash/upload tools and file routes are registered by agent server paths.

This creates two bugs in the architecture:

1. `direct` means host filesystem, not no-runtime.
2. Any app wanting a headless agent has to fake a workspace/cwd or avoid the normal server composition.

## Dependency inversion first

Before moving runtime-mode resolution to `@hachej/boring-bash` and concrete providers to `@hachej/boring-sandbox`, invert composition:

- `createAgentApp()` and `registerAgentRoutes()` stop value-importing built-in runtime modes in the pure path.
- Host/CLI/core passes runtime/features in.
- `@hachej/boring-agent` exports only type contracts for features/tool registration.
- A package invariant test fails if agent has value imports from `@hachej/boring-bash` or `@hachej/boring-sandbox`.
- Existing runtime mode support is migrated to host composition **in the same PR** (no long-lived compatibility wiring); a pure agent must never be forced to build a runtime bundle. Any temporary bridge carries a `// TODO(remove:<bead-id>)` marker naming its deletion-owner bead; a later owner is allowed only when explicitly named per `../INDEX.md`, and no marker outlives its named owner's phase.

This prevents the cycle:

```txt
bad: boring-agent -> boring-bash -> boring-agent
```

Target:

```txt
boring-core/full-app/cli compose boring-agent + optional boring-bash
boring-agent has no bash knowledge except type-level feature hooks
```

## Public core contracts

**No `AgentFeature` abstraction.** There is exactly one prospective contributor (boring-bash), so a `features` registry is a speculative abstraction with a single consumer — forbidden by the no-abstraction-without-two-consumers policy. `createAgent()` config uses the **existing seams directly**: `tools` (extra `AgentTool[]`), `systemPromptAppend` / `systemPromptDynamic`, and readiness gates (`mergeTools({ checkReadiness })` + `registerCapabilitiesContributor`). A pure agent and a non-workspace host use these same seams without importing workspace internals — no new registry, no `AgentFeature`/`AgentFeatureContext` interface, no `features?: AgentFeature[]` config member.

Boring-bash contributes through those seams as a **plain bundle**, not a core contract: `createBashAgentFeature()` (defined in Phase 3, [`../work/P3-routes-tools/TODO.md`](../work/P3-routes-tools/TODO.md)) returns `{ tools, readinessRequirements, systemPromptFragment }` — a boring-bash-local type — that the host **spreads into the `createAgent()` config** (`tools: [...hostTools, ...bashBundle.tools]`, readiness gates plus the prompt fragment). The core never learns the word "feature".

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
2. Environment/capability fragments. Whoever contributes a capability contributes its prompt words; for P3, the boring-bash bundle contributes `systemPromptFragment` beside its tools, routes, renderers, composer providers, skill filters, and readiness gates.
3. Plugin fragments through the existing plugin prompt seam: `WorkspaceServerPlugin.systemPrompt?: string` in `packages/workspace/src/server/plugins/defineServerPlugin.ts`, plus package-manifest `pi.systemPrompt` from `packages/workspace/src/shared/plugins/manifest.ts`, aggregated by the workspace host.
4. Host `systemPromptAppend`, then `systemPromptDynamic` for per-turn dynamic host/plugin context.

Pure mode (`runtime: 'none'`) omits the bash bundle and any filesystem capability fragment. Its assembled prompt must contain **zero filesystem/bash vocabulary**: no cwd, workspace path, file tree, `AGENTS.md`, `read`/`write`/`edit`/`find`/`grep`/`ls`, `bash`, `execute_isolated_code`, or upload guidance. The prompt/tool consistency gate must fail if the assembled prompt references a tool that is not registered in the harness tool catalog.

Capability residue rule: a capability is a complete contribution bundle, not just a tool list. If the host detaches `boring-bash`, it detaches its tools, routes, file UI, bash/file tool renderers, file mention/slash composer providers, prompt fragment, upload affordances, and skill filters together. The pure-mode front/API must therefore have no file-search endpoint dependency, no `@files` composer note, no attachment upload path, no bash/file tool renderer registration, and no skills whose declared requirements are unsatisfied.

Skills can declare lightweight capability requirements, using the same `boring.requires` style reserved for plugin manifests. This is a loader concern: wherever skills are resolved (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`, `packages/agent/src/server/http/routes/skills.ts`, workspace plugin skill mirroring), the host filters by the capabilities attached to the active agent before adding skills to Pi resources, the `/api/v1/agent/skills` response, slash-command suggestions, or prompt-visible available-skills text. A skill that requires filesystem/bash is absent in pure mode rather than shown disabled by default.

### Skills prompt fragment law

The prompt-visible skills index is a **generated fragment** derived from the capability-filtered skill set (downstream of the P6a skill capability filter), not a hand-authored prompt block. Per-skill `SKILL.md` content remains on-demand as today: the prompt advertises names/descriptions/locations and the agent reads an individual skill only when needed.

Current repo reality to preserve and filter: the Pi harness merges static and hot-reloadable `additionalSkillPaths`/Pi packages in `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:373-399`, passes them to `DefaultResourceLoader` and `loadSkills(...)` in `createHarness.ts:502-529`, exposes skill diagnostics from `resourceLoader.getSkills()` in `createHarness.ts:622-629`, and exposes slash commands through `resourceLoader.getExtensions().runtime.getCommands()` in `createHarness.ts:643-645`. The `/api/v1/agent/skills` route resolves package skill paths and calls `loadSkills(...)` in `packages/agent/src/server/http/routes/skills.ts:78-103`. Plugin manifest `pi.skills` entries flow from browser-safe manifest fields (`packages/workspace/src/shared/plugins/manifest.ts:31-39`), to scan-resolved `skillPaths` (`packages/workspace/src/server/agentPlugins/scan.ts:272-284`), to the loaded Pi snapshot (`packages/workspace/src/server/agentPlugins/manager.ts:295-305`), and server-owned plugin skills can be mirrored into `.boring-agent/skills` by `packages/agent/src/server/workspace/provisioning/skills.ts:37-74`. Workspace prompt reality already treats skills as a pointer/index, not inline content: `packages/workspace/src/server/boringSystemPrompt.ts:4-14` says the agent reads `SKILL.md` and references on demand, `boringSystemPrompt.ts:77-80` points at `<available_skills>`, and `packages/workspace/src/server/__tests__/boringSystemPrompt.test.ts:123-139` asserts that fallback. P6a inserts the capability filter before each of those outputs is handed to Pi, HTTP, slash suggestions, or the generated prompt index.

## Pure runtime mode

Add a composition path equivalent to:

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

## Pi harness audit

`createPiCodingAgentHarness` must be audited before pure mode ships.

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

Required tests for this area:

- pure agent starts without workspace/sandbox/runtime bundle;
- no file/bash/upload routes are registered in pure mode;
- no file/bash/upload tools appear in catalog;
- harness construction receives no host cwd/path, or receives a sealed virtual root with no host files;
- system prompt snapshot has no cwd/workspace/AGENTS.md leakage;
- pi pure-mode audit result is encoded in tests;
- operational command seam works without boring-bash;
- import invariant: `@hachej/boring-agent` has no value import from `@hachej/boring-bash`.

## Acceptance

This area is done when an app can instantiate a useful conversational agent with app-owned tools, durable sessions, and no host file authority anywhere in the request path.
