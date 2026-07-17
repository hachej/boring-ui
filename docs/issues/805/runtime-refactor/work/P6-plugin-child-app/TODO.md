> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# TODO-P6 — Plugin and child-app integration

> **Dispatch supersession (reality-synced 2026-07-11).** Do not dispatch the 2026-07-09
> P6-R/generation design below. Active v1 work is limited to:
>
> 1. P6-D: minimal behavior-only `AgentDefinition` plus host-owned
>    `AgentDeployment` schemas, their canonical digests, referenced definition
>    assets. P6-D identities landed via #623 and A1 compile via #624 under
>    accepted decision 21. BBP6-003 lookup is not a P6-R prerequisite; the next
>    resolver accepts one verified compiled bundle directly.
> 2. P6-R: a stateless resolver that combines the definition with a host-owned
>    deployment, one host-authorized composition identity/digest attestation,
>    and that workspace's explicit `default` deployment binding. It does not
>    select contributions and does not depend on P5a or P2; D1 consumes its
>    output and evaluates operational readiness separately.
>
> V1 rejects `pluginRefs`, generic prompt-fragment refs, per-agent runtime
> profiles, and per-agent environment/plugin catalogs. Do not implement
> `WorkspaceAgentsDeclaration` or any replacement workspace-bundle schema.
> Workspace plugins, skills, prompts, tools, routes, UI, and runtime are selected
> by the existing workspace host. Immutable generation stores, reload routing,
> generic environment resolution, child-app scoping, and per-agent plugin
> composition are post-v1.

## Superseded 2026-07-09 slice (historical)

Dispatch these first and independently of plugin/child-app work:

1. **BBP6-009 / P6-D:** front-safe behavior-only `AgentDefinition`, separate
   `AgentDeployment`, and deterministic canonical digest.
2. **BBP6-003 / P6-D:** minimal Map registry stores immutable verified bundles
   by definition id/version. Duplicate id/version with the same digest is
   idempotent; a different digest fails closed.
3. **BBP6-011 / P6-R:** after E1/P5a and P3 BBP3-020, host-resolve definition +
   deployment + workspace activated-plugin snapshot + active authority to
   `ResolvedAgent`; validate requirements and store definition/deployment/
   plugin/resolved-snapshot identity on new sessions. Keep a current agent
   pointer separate from durable immutable generations so sessions remain
   addressable after a same-generation reload/restart. A pointer change retires
   sessions on the prior generation; v1 does not route requests across multiple
   boot-time host/plugin generations.

A1 and D1 justify these abstractions. Consuming P3's immutable workspace-level
activation snapshot is the limited v1 plugin integration; P6-R does not load or
select plugins. Manifest requirements, hosted mode, reload, remote-worker image,
per-agent plugin UI/routes, and child-app beads below are post-v1. BBP6-010
cannot implement UI/route gating before P7 supplies trusted agent-aware routing.

Coordinator only. Dispatch exactly one bead/PR per implementation assignment;
never hand this whole multi-increment TODO to one coding agent. Each assignment
cites its bead plus the architecture and milestone authorities.

## Context (read first)

- `docs/issues/391/runtime-refactor/architecture/04-plugin-child-app-runtime.md` — child-app target, "Relationship to shared child-app platform plan" (consume, do not define), plugin manifest requirements, hosted external plugins (#357 fail-closed), `RuntimePluginContext`, shared per-workspace plugin runtime (#254), hot reload in full-app (#41), Macro-hosted-inside-full-app, secrets, managed-service plugins, Tests list.
- `docs/issues/805/plan.md` — Phase 6 deliverables/exit ("as v1"). Prerequisite unchanged: **do not define a competing child-app registry here.**
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — invariants 6 (no silent widening), 8 (child-app/workspace-kind narrows, never widens), 11 (surfaces never own the loop), 14 (secrets brokered), 15 (EU-sovereign). P6-D owns immutable definition lookup; P6-R is a stateless resolved-value function. P7 is the first owner/consumer of a registry of those values.
- `docs/issues/805/plan.md` — dispatch protocol; **Simplicity & no-compat policy (binding)**: migrate importers in-PR, no shims/aliases/legacy paths, no abstraction without two real consumers (or one named consumer in the immediately following phase). D1 consumes stateless P6-R directly; P7 later justifies and owns the first resolved-output registry. `// TODO(remove:<bead-id>)` + deletion bead for transitional code.
- The v1 child-app/plugin coverage (BBA-050..056) is **superseded and non-canonical** here — every compatibility-export/shim/deprecation-window instruction is stripped; secret handling follows the P5 brokering rule (host-side handles; brokered secrets never enter any sandboxed environment).

### Dependency — shared child-app platform plan (STATE PRECISELY, verify before starting)

[`../../architecture/04-plugin-child-app-runtime.md`](../../../../391/runtime-refactor/architecture/04-plugin-child-app-runtime.md) and [`../../architecture/05-multi-agent-sessions-hooks.md`](../../../../391/runtime-refactor/architecture/05-multi-agent-sessions-hooks.md) reference the child-app product/registry/billing/workspace-kind design as owned by the **real plan `docs/issues/376/plan.md`** (issue #376). Verified reality: that plan exists and describes `resolveChildAppContext`, `childAppId`, and `workspaceKind`, but the current repo has **no code export** named `ResolvedChildAppContext`; `! rg -n "ResolvedChildAppContext|childAppId|workspaceKind|ChildApp" packages apps` exits 0 today. P6b consumes the owner-approved exported resolved context type from #376 (expected name: `ResolvedChildAppContext`) — it does not define product/registry/billing/workspace-kind here. Until that code export exists, P6b's child-app-scoping beads stay **BLOCKED**.

Consequence, binding:

- This TODO **consumes** resolved child-app context; it must **not** define the product registry, billing model, hostname resolver, or `workspaceKind` schema (invariant, `04` "Relationship" section).
- The shared child-app platform implementation/type (issue #376; expected export `ResolvedChildAppContext`) is a **HARD prerequisite** for P6's child-app-**scoping** beads (BBP6-001 and anything consuming `childAppId`/`workspaceKind`). It is **not** optional and there is **no local fallback shape**: if the shared type has not landed in code, those beads are **BLOCKED — STOP and report**. Do **not** invent a `ResolvedChildAppContext` here (a forked shape would duplicate the platform contract). When it lands, import the type **type-only** and reconcile to the owner-approved export; do not invent product/billing fields. Beads that do **not** need child-app context — manifest validation (BBP6-002), plugin runtime context, `AgentRegistry` — proceed independently of this prerequisite.

### Dependencies (phase order)

- **P6-D ← accepted decision 21 (landed via #623; no P1 dependency):** BBP6-009
  establishes behavior/deployment identities and digest rules. Any remaining
  lookup work stays narrow and evidence-backed.
- **P6-R ← P6-D + P1 lifecycle/readiness boundary:** BBP6-011 statelessly combines
  the verified definition/deployment with one host-authorized workspace
  composition attestation. It creates no deployment,
  registry, generation store, plugin snapshot, attachment catalog, or loader.
- **Post-v1 plugin expansion ← P6-R + P5:** BBP6-002/004/005/007/008/010
  extend manifest, hosted-mode, and reload behavior. They are not a P8 gate.
- **P6b ← P6a + child-app platform type**: P6b (BBP6-001, BBP6-006) additionally requires the shared child-app platform code export (expected `ResolvedChildAppContext`, #376) — HARD BLOCKED / STOP-and-report until it lands (no local fallback shape). Child-app policy may narrow maximum authority; child-app requirements only validate active authority through the P5 normalizer once the resolved context exists.
- **Consumers:** A1 compilation consumes P6-D immediately; A1 local development
  and D1 multi-agent delivery consume stateless P6-R after the branches join.
  Post-v1 P7 may introduce durable resolved lookup; it is not the
  reason to delay the definition boundary.

### Already landed (do not redo, build on it)

- Plugin manifest reader (import-free, browser-safe): `packages/workspace/src/shared/plugins/manifest.ts` — `validateBoringPluginManifest(raw)`, `BoringPluginPackageJson` (`name`, `version`, `boring{ id, front, server, label }`, `pi{ extensions, skills, packages, systemPrompt }`), `isValidBoringPluginId`, `isSafePluginRelativePath`, `BoringPluginManifestErrorCode`, `REMOVED_BORING_UI_FIELDS`. **No `boring.requires` and no `bash` block exist yet** — extend this validator, do not add a second one.
- Plugin scan (import-free, executes no plugin code): `packages/workspace/src/server/agentPlugins/scan.ts` — `scanBoringPlugins`, `preflightBoringPlugins`, `readBoringPlugins`, `BoringPluginPreflightIssue`, `pluginIdFromPackageJson` (id derivation: `boring.id` else normalized `name` — no `boring.id` addition beyond existing). Plugin source trust kinds: `BoringPluginSource.kind = 'internal' | 'external'` (in `agentPlugins/types.ts`).
- Runtime plugin RPC (do not add a competing route family): `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts` — mounts `/api/v1/plugins/:pluginId` and `/api/v1/plugins/:pluginId/*`; `RuntimeBackendDispatcher` facade routes by `request.workspaceId`. `runtimeBackendRegistry.ts` — `RuntimeBackendRegistry` (`reloadFromLoadedPlugins`, `close`, dispose snapshots, `RuntimeBackendReloadResult`), `RuntimeBackendDispatchRequest { pluginId, method, path, query, headers, signal, body, logger, workspaceId? }`, `RuntimeBackendDispatchResponse`.
- Per-workspace plugin runtime unit: `packages/workspace/src/server/agentPlugins/manager.ts` — `BoringPluginAssetManager` (asset reload, `/reload` pickup, `LoadBoringAssetsResult`, `LoadedBoringPluginInspection`, `LoadedBoringPluginPiSnapshot`, non-hot-reloadable-surface reporting). Composition uses it in `packages/cli/src/server/modeApps.ts` (`BoringPluginAssetManager` + `RuntimeBackendRegistry` per workspace, dispatcher facade) and `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`. Core consumes plugins **statically** (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — `hotReload?: false`).
- Front plugin trust union (the seam hosted/iframe extends): `packages/workspace/src/shared/plugins/runtimePluginTypes.ts` — `BoringPluginNativeFrontTargetTrust = "local-trusted-native"`, `BoringPluginFrontTarget` union (comment: iframe/artifact kinds extend it without breaking).
- Reload route: `POST /api/v1/agent/reload` in `packages/agent/src/server/registerAgentRoutes.ts` (~line 998) + `http/routes/reload.ts`; `beforeReload` hook (ctx `{ workspaceId, workspaceRoot, request }`); plugin diagnostics tool `packages/agent/src/server/tools/pluginDiagnostics.ts`; `getPluginDiagnostics` option.
- Macro reference fixture: `packages/workspace/src/app/server/__tests__/macroRuntimeProvisioning.test.ts` (grounds child-app-scoped provisioning without hardcoding Macro in the runtime layer).
- No definition-version or resolved-agent registry exists in current code.
  BBP6-003 introduces only immutable definition lookup. BBP6-011/P6-R remains
  stateless and introduces no resolved registry; post-v1 P7 is the first owner
  and consumer of one registry of P6-R outputs.

## Goal / exit criteria

V1 P6 establishes immutable definition/deployment data and host resolution for
A1 and D1. Plugin/runtime expansion and child-app scoping remain separately
dispatchable post-v1 work. P8 uses [`P6-V1-HANDOFF.md`](P6-V1-HANDOFF.md),
not the aggregate package handoff.

### Post-v1 plugin expansion acceptance (not a P8 gate)

- [ ] import-free manifest validation runs **before** any plugin code executes.
- [ ] hosted plugin fails closed in remote mode for unsupported front/server/tool/bash/service/secret requirements.
- [ ] plugin/skill requirements are evaluated against resolved environment facts (not scalar bash/fs labels); missing or unknown required facts skip/diagnose fail-closed.
- [ ] a plugin requiring secrets receives status only (P5 brokering; no raw values).
- [ ] trusted service plugin lifecycle works (via P5 managed services).
- [ ] runtime backend RPC still dispatches after bash extraction (`/api/v1/plugins/:pluginId/*` unchanged).
- [ ] full-app reload route resolves per workspace/agent/plugin runtime.
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

### P6b follow-up (HARD BLOCKED on #376; outside epic/P8 gate)

- [ ] child-app-scoped default plugins/prompts/provisioning apply only in the matching workspace kind.
- [ ] Macro requirements do not leak into a generic workspace.
- [ ] child-app policy narrows but never widens workspace max policy (invariant 8); unknown `childAppId`/`workspaceKind` → stable diagnostic, never a silent fallback to Macro.

## Sub-parts — P6a (dispatchable) and P6b (hard-blocked)

Pass-3 split (binding): P6 is **two explicitly-labeled sub-parts** with different readiness. Dispatch them independently — do not let P6b's hard block hold P6a hostage, and do not let P6a smuggle child-app scoping forward.

**Post-v1 plugin core:** BBP6-002/004/005/007/008/010. These beads remain
child-app-independent, but they do not gate A1, D1, or P8.

**P6b — child-app scoping (post-v1, blocked on #376).** No provisional local
type. It gates neither P6-R nor P8.

Proposed v1 dispatch: **P6-D ← decision 21, with no P1 dependency**;
**P6-R ← P6-D + P1 lifecycle/readiness**, using the existing workspace
composer statelessly. Plugin expansion, E1, T2, P7, and P6b are post-v1.

## Non-negotiables

- Do **not** define a competing `ChildAppDefinition`, `workspaceKind` schema, billing model, or hostname registry. Consume resolved context only (see the dependency section).
- Do **not** create a second plugin manifest scanner or second plugin id system — extend `validateBoringPluginManifest` / `scanBoringPlugins`.
- Do **not** add a competing runtime plugin route family — keep `/api/v1/plugins/:pluginId/*` and the `RuntimeBackendDispatcher` facade.
- Do **not** leak Macro tools/prompts/provisioning/panels into generic workspaces.
- Secrets follow the P5 brokering rule: plugin/browser/model contexts see status only (`missing|granted|denied|expired`); no raw values in manifests, logs, transcripts, or provisioning artifacts.
- Hosted/untrusted plugin mode stays deliberately constrained (fail-closed) unless host policy promotes the plugin to a trusted tier.
- The P6-D definition registry is a **minimal Map-backed** data structure — no
  runtime handles, lifecycle framework, plugin system, or speculative
  parameters. P6-R is stateless; post-v1 P7 may introduce durable resolved
  registry for its named routing consumer.
- `AgentDefinition` is canonical reusable behavior. `AgentDeployment` pins only
  deployment identity, `agentId`, and definition identity/digest. D1 desired
  state plus the authorized workspace host own environments, runtime, model,
  sandbox, governance, exposure, hostname, and tenant policy.
- `@hachej/boring-agent` keeps zero value imports from `@hachej/boring-bash`; surfaces never own the loop (invariant 11).

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do not build the child-app product registry/billing/hostname resolver.
- Do not re-shape the landed #416 `packages/boring-bash/src/shared` contracts.
- Do not add a US-hosted provider as a default (invariant 15).
- Do not hot-register unsafe server routes on reload — reload diagnoses drift; trusted server-plugin route/tool changes still require restart/redeploy.

## Beads

### BBP6-001 — [P6b · HARD BLOCKED] Consume resolved child-app/workspace-kind context [size M]

- **Files create:** `packages/workspace/src/server/childApp/resolvedChildAppContext.ts` (the **consumption seam** wrapper + intersection helper around the owner-approved #376 exported type; no local source-of-truth shape) + `__tests__/`.
- **Files touch:** `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` and `packages/cli/src/server/modeApps.ts` (thread an optional host-supplied `ResolvedChildAppContext` into requirement/plugin/prompt resolution — do not source it here); the P5 normalizer call sites (child-app requirements become one requirement source).
- **Notes:** **Hard-prerequisite check first:** the resolved child-app context type is owned by the shared child-app platform implementation (#376; expected export `ResolvedChildAppContext`). Import it **type-only**. **If that code export has not landed, this bead is BLOCKED — STOP and report; do NOT define a local shape** (no fallback, no `// TODO(remove:BBP6-001)` stub — a forked shape would duplicate the platform contract). Once it has landed, compute `maximumAuthority = providerFacts ∩ host/app policy ∩ resolved childApp/workspaceKind policy ∩ workspace policy ∩ deployment policy`, then `activeAuthority = maximumAuthority ∩ authenticated grants ∩ session/subagent scope`; validate plugin/tool requirements against active authority. Child-app policy narrows, never widens; requirements never grant or narrow. Billing/product ids are core-owned metadata for diagnostics only — never consumed by boring-bash logic. Unknown `childAppId`/`workspaceKind` → stable diagnostic, no silent Macro fallback.
- **Tests:** generic workspace excludes child-app-scoped plugins/prompts/provisioning; matching kind includes them; child-app policy narrows but cannot widen workspace max; declaring a requirement does not grant the capability; missing active capability fails readiness; unknown id → stable error; billing/product metadata reaches diagnostics only.
- **Acceptance:** the runtime layer consumes child-app context and scopes requirements without owning or duplicating the child-app platform.

### BBP6-002 — [P6a] Extend plugin manifest validation import-free for `boring.requires` + `bash`; reserve skill filters over resolved environment facts [size M]

- **Files touch:** `packages/workspace/src/shared/plugins/manifest.ts` (add `boring.requires?: string[]` and a `bash?` block validation: `capabilities{ fs:'readonly'|'readwrite', exec, services, secrets }`, `nodePackages`, `python`, `templateDirs`, `sdkArchives`, `env`/`pathEntries`, `services`); `packages/workspace/src/server/agentPlugins/scan.ts` (surface new fields on `BoringServerPluginManifest`, preflight-validate before code import); `agentPlugins/types.ts`; the skill-loading boundary files that already assemble skill availability (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`, `packages/agent/src/server/http/routes/skills.ts`, and workspace/plugin skill mirroring call sites) for a lightweight requirement filter.
- **Notes:** Extend the existing validator — no second scanner, no new plugin id system, keep `boring.id` behavior. Validate `boring.requires` entries (legacy strings such as `"boring-bash"` may remain as manifest shorthand) and the `bash` block **before** executing plugin code, then lower them into requirements over resolved environment facts: filesystem access, exec/bash tools, services, secrets, provider facts, and unknown/reported status. Validate safe relative paths/containment for any manifest file references (reuse `isSafePluginRelativePath`/`resolveContainedPluginPath`). Reject raw secret **values** in the manifest — allow secret **names/grant refs** only (P5). Add stable `BoringPluginManifestErrorCode` entries for unsupported requirement, trust-tier mismatch, missing required environment fact, and unknown required fact. Optional requirement failure degrades with a diagnostic, does not block unrelated plugin features. Reuse the `bash` requirement shape from P5 (`@hachej/boring-bash/shared` `BashRequirement` sub-types) — type-only import into the browser-safe manifest module (data shapes only, no `node:*`).
- **Amendment (2026-07-08):** per-agent plugin resolution consumes this same validated manifest (`boring.requires`, `pi.extensions`, skills, packages, front/server targets); do not add a second validator or per-agent manifest scanner.
- **Skill capability reservation:** Skills may declare capability requirements in a boring-style metadata field (spelling can be `boring.requires` or an equivalent frontmatter key chosen during implementation, but it must be documented once and kept lightweight). The owner is the skill-loading boundary, not model prompt assembly after the fact: hosts filter skills by the active agent's resolved environment facts before passing skills to Pi, before returning `/api/v1/agent/skills`, and before registering slash-command suggestions from skills. The prompt-visible skills index is generated from this filtered set; per-skill `SKILL.md` content still loads on demand. A filesystem/bash-required skill is absent when no resolved environment fact satisfies that requirement. This is a reservation-level filter only; do not build a rich skill policy language.
- **Tests:** manifest requiring bash/exec/filesystem facts is skipped/diagnosed when the resolved facts are missing or unknown; invalid `bash` block rejected before import; side-effecting `boring.server`/`boring.front` fixture proves validation is import-free; existing trusted plugins still load; hosted iframe fields still validate; raw secret value in manifest rejected with stable code; optional requirement failure degrades; `boring.id` behavior unchanged; a skill declaring filesystem/bash requirements is filtered from Pi resources, `/api/v1/agent/skills`, slash suggestions, and the generated skills-index prompt fragment when no resolved environment fact satisfies it but visible when the fact is present.
- **Acceptance:** hosts determine whether a plugin is allowed/ready without executing untrusted plugin code, and skill availability is filtered by resolved environment facts where skills are loaded. The generated skills-index prompt fragment is downstream of the same filter and never advertises a skill whose requirements are unsatisfied. **P6a grep-gate (blocking):** the manifest validator carries ZERO child-app fields/types — `! rg -n "childAppId|workspaceKind|ChildApp" packages/workspace/src/shared/plugins/manifest.ts packages/workspace/src/server/agentPlugins/scan.ts packages/workspace/src/server/agentPlugins/types.ts` exits 0 (child-app scoping of manifests is P6b, layered elsewhere).

### BBP6-003 — [P6-D] Introduce immutable bundle registry [size S]

- **Files create:** `packages/agent/src/server/agents/AgentDefinitionRegistry.ts`
  plus `__tests__/`.
- **Files touch:** `packages/agent/src/server/index.ts` (export the type + class).
- **Notes:** Back one registry with `Map<definitionId, Map<version, CompiledAgentBundle>>`.
  Provide register, get,
  list-versions, and has operations by `(definitionId, version)`. Registering
  the same tuple and digest is idempotent; registering the same tuple with a
  different digest fails with a stable conflict code. On registration, verify
  canonical definition+asset digest, contained normalized asset paths, unique
  asset names, each asset digest, and every `instructionsRef`; then deep-freeze
  or defensively copy the bundle. No delete, agentId, runtime handle, tool/plugin
  catalog, readiness handle, lifecycle, event bus, or disposal belongs here.
  P6-R and P7 own resolved runtime agent-id lookup.
- **Tests:** register/get/list-versions/has round-trip after source-checkout
  removal; same digest is
  idempotent; conflicting digest fails closed; returned data cannot mutate the
  stored bundle; tampered/missing/duplicate/traversing assets reject; no
  agentId/runtime/child-app field exists.
- **Acceptance:** A1 and P6-R can select an immutable definition version without
  importing runtime lifecycle. **P6-D grep-gate:**
  `! rg -n "agentId|readiness|tool|childAppId|workspaceKind|ChildApp" packages/agent/src/server/agents/AgentDefinitionRegistry.ts`
  exits 0 (asset `path`/`content` fields are allowed).

### BBP6-004 — [P6a] Runtime plugin context (`RuntimePluginContext`) on the gateway [size M]

- **Files create:** `packages/workspace/src/server/runtimeBackend/runtimePluginContext.ts` (`RuntimePluginContext` per `../04`) + `__tests__/`.
- **Files touch:** `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts` / `runtimeBackendRegistry.ts` (`RuntimeBackendDispatchRequest` → derive and attach context); composition (core/cli/workspace) to supply the feature/readiness/secret-status sources.
- **Notes:** Do not add a competing route family. The **P6a** context carries **no child-app fields**: `RuntimePluginContext { pluginId, workspaceId?, availableFeatures{ bash?: BashEnvironmentSummary, uiBridge?: boolean, secrets?: Record<string,'missing'|'granted'|'denied'|'expired'>, services?: Record<string,'not-started'|'starting'|'ready'|'failed'> } }`. **`childAppId`/`workspaceKind` are NOT part of this contract** — child-app scoping of the plugin context is layered on in **P6b** (BBP6-001), which extends the derived context once `ResolvedChildAppContext` exists. Context is **derived from resolved policy/readiness** (P5), never from plugin-controlled request params/body — plugin cannot spoof `workspaceId`/`agentId`/feature availability. Secret entries are status only (P5 brokering). Missing required feature → clear diagnostic response, no unsafe backend action; missing optional feature → visible, non-fatal.
- **Tests:** trusted plugin backend receives context; missing required feature → stable diagnostic, no unsafe action; secret context is status-only; service status updates with readiness; existing `/api/v1/plugins/:pluginId/*` dispatch still works; plugin cannot spoof context via params/body.
- **Acceptance:** runtime plugin backends degrade safely with explicit scoped context; no route proliferation. **P6a grep-gate (blocking):** `! rg -n "childAppId|workspaceKind|ChildApp" packages/workspace/src/server/runtimeBackend/runtimePluginContext.ts` exits 0 (child-app scoping is P6b).

### BBP6-005 — [P6a] Hosted external plugin fail-closed in remote mode [size M]

- **Files touch:** `packages/workspace/src/shared/plugins/runtimePluginTypes.ts` (extend the `BoringPluginFrontTarget` trust union for a hosted/iframe tier — the file already anticipates this); manifest/scan validation (BBP6-002) to gate hosted-mode requirements; the front iframe host + CSP wiring.
- **Notes:** Hosted remote mode fails closed for unsupported front/server/tool/bash/service/secret requirements. Preserve iframe safety: constrained sandbox (`allow-scripts` only by default; no `allow-same-origin`/forms/popups/top-nav absent explicit future policy), strict CSP (no arbitrary network by default), bounded diagnostics bridge (ready/log/error, size-limited), manifest/document size limits, safe relative entry validation, symlink/special-file rejection before read, fail-closed when safe file-metadata APIs are unavailable. A hosted plugin may declare **readonly visibility / diagnostics only** when host policy + provider capability allow. It never gets `boring.server`, host routes, plugin-owned agent tools, runtime backend code, raw filesystem access, a generic fetch proxy, or raw secrets — those require promotion to a trusted tier by app/child-app policy.
- **Tests:** hosted plugin cannot request server route/tool/backend runtime; unsupported bash/service/secret requirement fails closed before code execution; readonly diagnostic requirement succeeds only when policy allows readonly fs; iframe sandbox/CSP attributes match constraints; diagnostics bridge enforces size/type limits; symlink/special-file fixtures rejected; missing safe-metadata support fails closed.
- **Acceptance:** hosted plugin mode stays strictly safer than local/trusted mode after boring-bash integration.

### BBP6-006 — [P6b · HARD BLOCKED] Macro child-app requirement scoping [size M]

- **Files create/touch:** a Macro-in-full-app resolution fixture/smoke building on `packages/workspace/src/app/server/__tests__/macroRuntimeProvisioning.test.ts`; wire `ResolvedChildAppContext` (BBP6-001) for `childAppId='macro'` / Macro workspace kind through the composition.
- **Notes:** Use resolved child-app context for Macro — do not hardcode Macro behavior in boring-bash or the runtime layer. Macro prompts/tools/provisioning/default panels are visible only for the Macro workspace kind; generic Seneca shares deployment/auth/DB/billing but not runtime requirements. Macro trusted domain routes (e.g. `/api/macro/*`) may remain trusted app/internal plugin APIs (child-app plan non-goal — do not force generic RPC). boring-bash receives only resolved policy/requirements, never billing secrets or child-app registry internals.
- **Tests:** Macro context fixture yields Macro plugin/prompt/provisioning requirements; generic fixture excludes them; Macro trusted routes present only in Macro context; billing/product metadata reaches core diagnostics only, not boring-bash logic; no Macro leakage into generic workspace.
- **Acceptance:** Macro-in-full-app is supported without leaking capabilities/secrets/prompts/tools/provisioning across the child-app/workspace-kind boundary.

### BBP6-007 — [P6a] Shared per-workspace plugin runtime compatibility (#254) [size M]

- **Files touch:** `packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, and (static path) `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — route boring-bash plugin requirements through one shared per-workspace runtime unit (`BoringPluginAssetManager` + `RuntimeBackendRegistry` + dispatcher facade) rather than divergent maps.
- **Notes:** Avoid duplicate per-workspace plugin maps across CLI/full-app/workspace modes; use the `RuntimeBackendDispatcher` resolver for multi-tenant dispatch. Preserve plugin SSE/load/unload/error behavior and revision/signature cache-busting (`agentPlugins/signatureCache.ts`). Keep HTTP registry id vs plugin source/workspace-root path distinct (do not confuse them). boring-bash requirement/readiness state participates in reload and runtime snapshots. Registry disposes/closes on workspace eviction.
- **Tests:** CLI workspaces mode and full-app use the same runtime unit or a thin adapter; reload updates manifest + runtime context + Pi snapshot + requirement readiness; backend registry disposes on eviction; SSE load/unload/error correct after requirement-validation changes; registry-id vs root-path translation covered.
- **Acceptance:** adding boring-bash requirements does not drift CLI/full-app/workspace plugin runtimes further apart.

### BBP6-008 — [P6a] Multi-tenant full-app reload (#41) [size M]

- **Files touch:** `packages/agent/src/server/registerAgentRoutes.ts` (`/api/v1/agent/reload`, `beforeReload`, `getPluginDiagnostics`) and the full-app composition (`apps/full-app/src/server/*`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`) to resolve per request: workspace, P6-R/P7 resolved agent binding (not the BBP6-003 definition registry), plugin runtime, boring-bash requirement/readiness state, `beforeReload` hook, asset manager, backend registry, Pi/plugin snapshots.
- **Notes:** `/api/v1/agent/reload` works in full-app where enabled. Pure/headless agents reload without boring-bash unless a plugin requirement pulls it. Reload diagnostics include manifest validation, requirement validation, provisioning readiness, and plugin import/runtime errors (surface via `getPluginDiagnostics`/`plugin_diagnostics` tool). Trusted server-plugin route/tool changes are **diagnosed, not hot-registered** (no unsafe hot route registration). Missing/unauthorized workspace → stable error.
- **Post-v1 tests:** reload resolves per workspace; missing/unauthorized workspace → stable error; plugin assets reload and backend dispatch still work; a presentation-free workspace-backed surface reloads without a UI; trusted server-plugin backend changes are diagnosed, not hot-swapped; reload surfaces requirement/provisioning errors without losing a previously working UI where applicable.
- **Acceptance:** multi-tenant full-app reload works without route 404s or silent slash-command failures.

### BBP6-009 — [P6-D, v1] Versioned definition/deployment schemas + digest rules [size M]

- **Proposed v1 acceptance:** `AgentDefinition` is reusable versioned behavior
  with `instructionsRef` plus requirement/tool/skill/MCP refs only.
  `AgentDeployment` contains only `deploymentId`, `version`, `agentId`, and a
  pinned definition id/version/digest reference. Both schemas are strict and
  front-safe; both have deterministic canonical digests.
- Definition assets are strict `{ path, digest, content }` values with one
  canonical POSIX-relative path rule, verified UTF-8 content digests, duplicate
  rejection, and no producer metadata in identity.
- P6-D creates no `WorkspaceAgentsDeclaration`, environment/runtime profile,
  plugin catalog, policy resolver, deployment engine, or workspace bundle.
- **Rejected fields on `AgentDefinition`:** environment attachments,
  `runtimeProfileRef`, sandbox/governance/model/demo/pricing/exposure refs,
  host/subdomain, tenant roots, seed-source refs, and `pluginRefs`/`plugins`.
  Reject unsupported v1 fields with `AGENT_DEFINITION_UNSUPPORTED_FIELD`; do
  not reserve a silently ignored plugin field.

### Historical BBP6-009 text (2026-07-08) — SUPERSEDED; do not implement

- **Files create:** `packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` (import-free, **front-safe** declaration schema + validator — no `node:*`, no `Buffer`, no Fastify) + `__tests__/`; `packages/boring-sandbox/src/shared/runtimeProfile.ts` (**types only**, front-safe) with `ResolvedRuntimeProfile { profileId, image? }` and `RuntimeProfileCatalog` interface. **Amendment (2026-07-08):** the canonical definition schema lives in `@hachej/boring-agent`, not `boring-workspace`. Rationale: once BBP6-009 became the *canonical* authored agent definition (not a narrow workspace declaration), it is a contract consumed by non-workspace surfaces (M1/M2 MCP, S1 Slack, S2 embed, D1 tenant provisioning) that must not depend on the workspace package; `boring-agent` is the "defines all contracts, imports nothing" package and the definition is the input to the agent core resolver. Invariant compliance: the workspace/core/cli **server** composition seams value-import the validator (server-side, allowed), and the workspace **front** (S3/S4 lists) uses `import type` only (allowed under the "zero value imports from `@hachej/boring-agent` in workspace base front/shared" invariant). It sits alongside `packages/agent/src/shared/capabilities.ts`. **Amendment (2026-07-08):** the canonical schema is `WorkspaceAgentsDeclaration { agents: AgentDefinitionDeclaration[]; defaultAgentId: string; environments?: EnvironmentPoolEntry[] }`, where each `AgentDefinitionDeclaration` may carry `plugins?: PluginRef[]` (the `agents:[]` array is *workspace config that carries* the definitions; the definition *type* is agent-owned; `environments?:[]` is the project environment pool that `environmentAttachments` refs resolve against — see the pool invariant below). `AgentDefinitionDeclaration` includes:
  - `agentId`, `label?`, `description?`;
  - `instructionsRef?` and `personaRef?`;
  - capability bundles/toolset refs (`capabilityBundles?`, `tools?`, `skills?`, `mcpServers?`);
  - **Amendment (2026-07-08):** `plugins?: PluginRef[]` (plugin ids this agent ships with; requirements-only, host-resolved);
  - `environmentAttachments?` (authored requirements only; host resolves to environment facts);
  - `sandboxPolicyRef?`;
  - `runtimeProfileRef?` (host-resolved reference to a digest-pinned runtime image profile; reference only, not an inline image spec or Dockerfile);
  - `governancePolicyRef?`;
  - `modelPolicyRef?`;
  - `demoPolicyRef?`;
  - `pricingRef?`;
  - `exposure?` / exposure config (`exposureId?`, allowed surface refs, public-demo/bearer policy refs);
  - optional metadata refs needed by S3/S4 display, but no lifecycle methods and no executable code.
- **Files touch:** the composition seams that build the `AgentRegistry` (BBP6-003) per workspace — `packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — to read the (host-supplied, already-parsed) declaration and **seed the `AgentRegistry`** with one entry per declared agent, plus record the default agent. When no declaration is present, compose a **single implicit `default` agent** so single-agent workspaces are byte-identical to today (matches the T1/T2 canonical `default` agentId until this lands). These host seams also resolve `runtimeProfileRef?` through an operator-supplied `RuntimeProfileCatalog`, else resolve the validated provider-default image, and stash a unified primitive-only `SelectedRuntimeImage` in the resolved-composition / `AgentRegistry` entry when an image is selected:
  ```ts
  interface SelectedRuntimeImage {
    readonly image: { readonly ref: string; readonly digest: string }
    readonly source: 'profile' | 'provider-default'
    readonly profileId?: string
  }
  ```
- **Notes:** This is the workspace-side declaration `05` § "Workspace agent registry" calls for and that **Phase 7 (`BBP7-001`/`BBP7-002`) consumes** to resolve/validate `agentId` against the registry (`TODO-P7` "Depends on … the workspace `agents: [...]` declaration"). **Amendment (2026-07-08):** it is now the canonical authored agent definition, not a narrow `WorkspaceAgentDeclaration`. Unknown refs fail closed: unknown instruction/persona/capability bundle/tool/skill/MCP/plugin/environment/sandbox/governance/model/demo/pricing/exposure refs are validation errors, not warnings or empty defaults. The declaration is requirements-only; it does not grant power. Hosts resolve it into `ResolvedAgentComposition` using policy, provider facts, environment attachments, plugin manifests, and readiness. Keep it **child-app-free**: no `childAppId`/`workspaceKind`/`ChildApp` fields anywhere (child-app defaults *seeding* this set is P6b, layered on via `ResolvedChildAppContext` — not here). The schema/validator module is agent-owned and workspace-free: no imports from `@hachej/boring-workspace` (the definition must be readable by a standalone non-workspace surface). The declaration is host-composed already-parsed config — **no env-var reads, no file discovery** in the declaration module (P1 rule); the host reads/parses and passes it in. Default-agent composition is pure data (pick `defaultAgentId`, else the sole/implicit `default`); no lifecycle framework. Do **not** build the `agentId` request-addressing resolver here — that is P7 (`BBP7-002`); this bead only ships the declaration + registry seeding.
- **Runtime-profile amendment (BBP6-009):** `runtimeProfileRef?` is a reference string id. The declaration module only carries the structural field; the catalog resolver implementation is host code. Unknown profile refs fail closed with `AGENT_DEFINITION_UNKNOWN_REF` and `field:'runtimeProfileRef'`. A malformed declared image, or malformed provider-default image, fails closed with `RUNTIME_PROFILE_MALFORMED` when `ref` is empty or `digest` is missing/non-`sha256:`. A declared profile owns the whole resolved profile: if it has no image, there is no image-level fallback to provider default. When no `runtimeProfileRef` is declared, host `resolveProviderDefault(providerConfigImage?)` may return the provider-config image after the same ref/digest validation; otherwise no image is selected and the support check is a no-op.
- **Provider-image-support check (fail closed):** use the resolved provider id, not the requested `BashSandboxPolicy.provider` input. Resolve `resolveMode(mode)` in boring-bash, map through `MODE_TO_PROVIDER`, then read `PROVIDER_CAPABILITIES[providerId].runtimeImage`. If a `SelectedRuntimeImage` exists and `runtimeImage === false`, reuse existing `SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT` with payload discriminator `requirement:'runtimeImage'`. If `runtimeImage === 'unknown'`, reuse existing `SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY` with the same `requirement:'runtimeImage'` discriminator. `direct`/`bwrap`/`none`/`readonly` are checked at composition. `vercel-sandbox` has no handshake resolver here, so an image-pinning Vercel agent fails closed at pr2 with `SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY`. `remote-worker` is deferred to BBP6-009b because its support fact is learned only through BBP5-008. No current provider reports `runtimeImage:true`, so pinned-image agents correctly fail closed until an image-capable provider lands; the shippable win is the authoring surface, host resolution, unified stash, and safety check.
- **Multi-agent + environment scoping (invariant, Amendment 2026-07-08):** the `AgentRegistry` is **project/workspace-scoped, never a global singleton**. One workspace holds **N agents**; the same `agentId` declared in two different projects is **two independent instantiations**, each bound at `createAgent()` time to *its own project's* environments (per `09` + E1). Within one workspace, agents attach environments **by reference**: two agents referencing the same environment id **share** that filesystem (readonly = clean; readwrite = explicit concurrent access per `09` sharing semantics), two referencing different ids are **isolated**. The registry holds definitions/handles; it never owns filesystems — environments are project-scoped resources agents reference, not agent-private state.
- **Workspace environment-pool declaration (companion to `agents:[]`):** the workspace config carries an `environments: [...]` pool declaration alongside `agents: [...]` — the set of environment ids available in this project (e.g. `user`, `company_context`, `team_scratch`), each with provider/access/governance refs. `AgentDefinitionDeclaration.environmentAttachments` refs resolve **against this pool**; an attachment referencing an id absent from the pool is a fail-closed validation error (same rule as unknown policy refs). This is the environment-side counterpart of the agent declaration and, like it, is host-supplied already-parsed config (no env reads / file discovery in the declaration module). `company_context` is the reference pool entry (unchanged #416/governance provenance); the generalized pool is what lets multiple agents in one workspace share or hold distinct filesystems. `defaultAgentId` and the pool together are what a workspace host reads to *create the agents inside the project*.
- **Amendment (2026-07-08): Shared-tier declaration refs:** add optional `host`/subdomain binding and seed-source refs to `WorkspaceAgentsDeclaration` so a declaration is directly hot-loadable as a D2 shared-tier tenant, while staying child-app-free. Record D2 as a same-definition consumer beside D1; both tiers consume the same declaration and environment pool.
- **Same-definition consumers:** P7, M1/M2, S3, S4, D1, D2, and later factory flows must consume this same `AgentDefinitionDeclaration` or a lossless projection of it, including the resolved plugin set for each agent. Any temporary projection type (for example M1's `ManagedAgentVerticalConfig`) must be derived from this declaration and documented as temporary. **Amendment (2026-07-08):** S1 and S2 are relocated out of #391 active scope, but their future stories must still consume this definition or a lossless projection when they return.
- **Tests:** a declaration with two agents seeds two `AgentRegistry` entries + a resolvable default; absent declaration yields exactly one implicit `default` agent (single-agent parity); invalid declaration (duplicate `agentId`, missing `defaultAgentId` target, or unknown instruction/persona/capability/tool/skill/MCP/plugin/environment/sandbox/governance/model/demo/pricing/exposure ref) rejected with a stable code; unknown `runtimeProfileRef` rejects with `AGENT_DEFINITION_UNKNOWN_REF`; malformed declared image rejects with `RUNTIME_PROFILE_MALFORMED`; malformed provider-default image rejects with `RUNTIME_PROFILE_MALFORMED`; image-pinning on a fixed `runtimeImage:false` provider rejects with `SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT` and `requirement:'runtimeImage'` even without library requirements; image-pinning Vercel rejects at pr2 with `SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY` and `requirement:'runtimeImage'`; remote-worker + declared `runtimeProfileRef` stashes `SelectedRuntimeImage { source:'profile', profileId }` and does not fail at pr2; remote-worker + no `runtimeProfileRef` + valid provider-config image stashes `SelectedRuntimeImage { source:'provider-default' }` with no `profileId` and does not drop the image; no-image profile and no-ref/no-provider-default-image both select no image and no-op the support check; resolved provider id is derived via `MODE_TO_PROVIDER`, not requested `BashSandboxPolicy.provider`; a declaration with two plugin refs resolves both for that one agent; an unknown plugin id is rejected; a plugin ref appears in exactly one declaring agent's resolved plugin set and is absent from a sibling agent that did not declare it; **two agents referencing the same pool environment id both resolve to that id (shared), two referencing different ids resolve to distinct ids (isolated)**; an `environmentAttachments` ref to an id **absent from the `environments` pool** is rejected with a stable code; declared exposure config is preserved for M2 without hardcoding demo verticals; `runtimeProfile.ts` is type-only/front-safe; `resolveProviderDefault` and catalog implementation are host-seam only; **grep-gate**: the declaration module has zero child-app fields.
- **Acceptance:** the workspace `agents: [...]` declaration + default-agent composition exists and seeds the `AgentRegistry`; single-agent workspaces are unchanged; Phase 7 can resolve `agentId` against it; an agent can declare its own digest-pinned runtime image by `runtimeProfileRef`; the host resolves it or a validated provider-default image, stashes a unified `SelectedRuntimeImage`, and fail-closed provider-image-support-checks it; plugin refs are requirements-only, fail closed on unknown, and do not grant power until BBP6-010 resolves them; M1/M2/S1/S2/S3/S4/D1/D2 can consume the same definition or a lossless projection. **P6a grep-gate (blocking):** `! rg -n "childAppId|workspaceKind|ChildApp" packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` exits 0, and `! rg -n "@hachej/boring-workspace" packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` exits 0 (agent-owned, workspace-free).

### BBP6-009b — [P6a] Remote-worker post-handshake image-support check [size S]

- **Files touch:** the BBP5-008-created remote-worker readiness/policy-validation seam (post-P2 `@hachej/boring-sandbox/providers/remote-worker/*` plus the readiness consumer).
- **Notes:** BBP5-008 is the sole remote-worker handshake owner. After the handshake resolves `runtimeImage`, run the same provider-image-support check against the P6a `AgentRegistry`-stashed `SelectedRuntimeImage.image`, regardless of `source`. Reuse BBP5-008's `reported | unknown` fail-closed machinery and the existing `SANDBOX_PROVIDER_UNSUPPORTED_REQUIREMENT` / `SANDBOX_PROVIDER_UNKNOWN_REQUIRED_CAPABILITY` codes. Read from the P6a `AgentRegistry` entry, not the route/runtime binding; that binding has no `agentId` until P7's BBP7-001, so this PR sequences after BBP5-008 and P6a registry, not after P7.
- **Tests:** mock handshake reports `runtimeImage:true` and an image-pinning remote-worker agent readies; reports `false` or `'unknown'` and the agent fails closed with the existing code and `requirement:'runtimeImage'`; both `source:'profile'` and `source:'provider-default'` selection records are read and support-checked post-handshake; the stashed image is read from `AgentRegistry`, with no route-binding / P7 dependency.
- **Acceptance:** a remote-worker agent pinning an image through either `runtimeProfileRef` or provider default is validated after handshake, never prematurely at pr2, using the unified `SelectedRuntimeImage`.

### BBP6-011 — [P6-R, next after P1] Stateless workspace resolution (S)

- Files: add
  `packages/agent/src/server/agentDefinition/resolveAgentDeployment.ts` and
  `packages/agent/src/server/agentDefinition/__tests__/resolveAgentDeployment.test.ts`;
  export it from `packages/agent/src/server/index.ts`. Export the existing
  value-level `OpaqueRefSchema` and `Sha256DigestSchema` from
  `packages/agent/src/shared/agent-definition.ts` and `shared/index.ts`, adding
  focused max-length/Unicode/digest-shape coverage to the existing shared
  agent-definition test. Do not touch routes, runtime binding lifecycle,
  workspace packages, or create a registry.
- Input: one verified `CompiledAgentBundle`, one validated `AgentDeployment`,
  and one unknown-at-runtime host-supplied authorized binding. A module-local
  `AuthorizedAgentDeploymentBindingSchema` composes the exported existing
  `OpaqueRefSchema`/`Sha256DigestSchema` to parse `workspaceId`,
  `defaultDeploymentId`, and
  `workspaceCompositionDigest`. P6-R binds this opaque identity but cannot
  reproduce or verify the composition because current code has no canonical
  producer.
- The binding schema requires `workspaceId` and `defaultDeploymentId` to use
  the existing opaque-ref rules (non-empty, trimmed, well-formed Unicode, no
  control characters, maximum 256 characters) and `workspaceCompositionDigest` to match
  `^sha256:[a-f0-9]{64}$`. Parse failures reuse
  `AgentDeploymentValidationError` / `AGENT_DEPLOYMENT_INVALID` with exact
  fields `workspaceId`, `defaultDeploymentId`, or
  `workspaceCompositionDigest`. This validates identity shape only;
  authorization remains the host's prerequisite decision.
- Recompute/verify the definition digest; validate the deployment and compute
  its digest; require the deployment's
  definition tuple/digest to match the bundle, `agentId === 'default'`, and the
  binding's default deployment id to match. Load exactly `instructionsRef` from
  immutable assets.
- Error ownership stays deliberately small: bundle digest mismatch uses
  `AgentDefinitionValidationError` / `AGENT_DEFINITION_INVALID` / field
  `definitionDigest`; missing referenced instructions uses the same error/code
  with field `instructionsRef`. Definition-id/version/digest mismatch uses
  `AgentDeploymentValidationError` / `AGENT_DEPLOYMENT_INVALID` and the exact
  nested field (`definition.definitionId`, `definition.version`, or
  `definition.digest`); non-default agent uses field `agentId`; binding mismatch
  uses field `defaultDeploymentId`. Add no resolution error taxonomy or
  policy/readiness/plugin/environment error model.
- Return immutable definition/deployment/workspace-composition identities,
  loaded instructions content, definition/deployment/composition digests, and a
  canonical resolved digest. Same inputs produce the same result.
- D1-R0 must inventory the real composer inputs and specify the smallest
  canonical redacted composition-identity producer before D1 implementation
  claims reproducible apply/rollback. That producer does not belong in P6-R.
- Resolve one binding per call. A host obtains N bindings by N independent pure
  calls; P6-R owns no batch API, lookup, router, cache, current pointer,
  authorization decision, or registry.
- Add no deployment creation, mutable/current registry, durable generation
  store, plugin snapshot, prompt registry, attachment catalog, lifecycle/GC,
  session pinning/retirement, or multi-generation routing.
- Tests: deterministic same input; changed composition changes the returned
  composition and resolved digests while definition/deployment/instructions
  stay unchanged; every rejection above asserts the exact class, validation
  code, and field; empty/over-256/whitespace/control-character/malformed-Unicode
  binding ids and malformed
  composition digests reject before result construction; two independent calls
  share no state; shared/server import
  invariants remain valid.
- Review budget: 25-30 minutes. Any expansion beyond the resolver/test, public
  entry exports, and the existing value-level validator export/shared test
  named above requires re-planning.

### §3 Deferred / follow-up — runtime-image requirements vs facts optimization

This is an explicit follow-up, not an active bead in this amendment. It would validate an agent's required libraries against the resolved image's declared capability facts and skip reinstalling what the image ships (`overlayDelta = runtimeNeeds - imageFacts`, feeding the BBP5-009 fingerprint). It is blocked on three unmet prerequisites:

1. **An ungated raw-package requirement layer.** BBP5-001 must expose an ungated source-requirement layer carrying raw `nodePackages`/`python`/`extraLibs` package names. Today `NormalizedRequirement[]` carries source/optional/capabilities/ids/runner specs, and the `plugins[]` overlay is empty on a no-runtime provider, so there is no ungated raw-name source to validate.
2. **An imaged provider with declared facts.** At least one provider must report `runtimeImage:true` with declared `RuntimeImageCapabilityFacts` (`nodePackages`, `pythonPackages`). No provider does today; this arrives with the deferred boring-runtime-* image catalog / image-capable provider.
3. **Specifier name-normalization.** `extraLibs` are raw uv-pip specifiers (`numpy==1.26`, `pandas[perf]`, VCS/URL/path), and many `RuntimePythonSpec`s are `packageName`-less source installs. Facts matching by bare name needs a normalization rule first.

Until those prerequisites exist, do not ship `RuntimeImageCapabilityFacts`, `requirementToRuntimeNeeds`, `overlayDelta`, `RUNTIME_REQUIREMENT_UNSATISFIED`, `RUNTIME_FACTS_UNAVAILABLE`, `ResolvedRuntimeProfile.capabilityFacts`, or `allowedTiers`. `allowedTiers` also needs a real isolation-tier identity; provider id is not one.

### BBP6-010 — [post-v1, after P7] Per-agent plugin composition [size M/L]

- **Files touch:** the composition seams that build each agent's resolved capabilities and `AgentRegistry` entry (`packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`), plugin manifest/scan consumption from BBP6-002, `BoringPluginAssetManager` / runtime-plugin RPC gating, and capability fact projection.
- **Notes:** introduce `pluginRefs` in an additive post-v1 schema version and
  resolve it as requirements after P6-R. Schema v1 continues to reject the
  field with `AGENT_DEFINITION_UNSUPPORTED_FIELD`.
  Agent-scoped contributions may resolve without UI routing. Workspace-scoped
  UI/routes require P7's trusted `agentId`. Duplicate names fail closed unless
  an explicit validated override contract exists. Plugin prompt fragments are
  part of that same scoped contribution, never an independently aggregated
  string.
- **Tests:** an agent declaring plugins receives those plugins' tools, skills, MCP servers, renderers, and prompt fragments in its resolved capabilities; a sibling agent without those refs receives none of them; filtering or denying a plugin leaves no prompt residue; plugin UI panels/routes are visible/active only in sessions for declaring agents; unknown plugin ref fails closed; unsatisfiable `boring.requires` fails closed for that agent; hosted plugin constraints still fail closed via BBP6-005; duplicate tool/renderer names across environment bundle/plugin/host error unless `overrides: true`; `governancePolicyRef` denial rejects plugin activation with a stable code.
- **Acceptance:** per-agent plugin refs produce a resolved plugin set and scoped capabilities without making plugins workspace-global-only; workspace-scoped plugin surfaces are agent-gated; plugin `boring.requires` is resolved through P5; duplicate resolution reuses the environment-bundle -> plugins -> host law. **P6a grep-gate (blocking):** `! rg -n "childAppId|workspaceKind|ChildApp" <BBP6-010-created-or-touched-contract-files>` exits 0.

## Verification — exact commands verified against package.json scripts

```bash
# workspace (manifest/scan, runtime plugin context, hosted mode, shared runtime)
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants   # node ./scripts/check-plugin-invariants.mjs

# agent (AgentRegistry, reload seam)
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run lint:invariants

# child-app consumption + reload composition
pnpm --filter @hachej/boring-core run test
pnpm --filter @hachej/boring-ui-cli run test
pnpm --filter full-app run typecheck
pnpm --filter full-app run test

# repo-wide boundary + cycle guards (root package.json)
pnpm lint:invariants        # agent + boring-bash + workspace-plugin invariants
pnpm audit:imports          # tsx scripts/audit-imports.ts
pnpm typecheck              # build:packages then per-pkg typecheck
```

(Verify each `--filter` package name against its `package.json#name` before running; the scripts above are confirmed present.)

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../../../391/runtime-refactor/PR-PLAN.md) P6 rows exactly:

### V1 P6-D/P6-R
- `pr1-definition-deployment-schema` → BBP6-009.
- `pr2-definition-registry` → BBP6-003.
- `pr3-resolved-agent` → BBP6-011.

### Post-v1 plugin/runtime expansion
- `pr2b-remote-worker-image-support` → BBP6-009b.
- `pr4-manifest-requires-bash-skill-filters` → BBP6-002.
- `pr4-runtime-plugin-context` → BBP6-004.
- `pr5-hosted-fail-closed` → BBP6-005.
- `pr6-shared-workspace-runtime` → BBP6-007.
- `pr7-multitenant-reload` → BBP6-008.
- `pr8-per-agent-plugin-composition` → BBP6-010.

### P6b follow-up
- `pr9-childapp-context` → BBP6-001, HARD BLOCKED until #376 exports the shared resolved context type.
- `pr10-macro-scoping` → BBP6-006, HARD BLOCKED until BBP6-001 can consume that type.

## Review gates

- **V1/post-v1 split (blocking):** P6-D/P6-R close only against
  `P6-V1-HANDOFF.md`. The shared child-app platform code export (expected
  `ResolvedChildAppContext`, #376) is a **HARD prerequisite for P6b**
  (BBP6-001, BBP6-006); if absent, those STOP-and-report with no fallback.
  Definition, resolved-agent, manifest, and runtime-context contracts contain
  zero child-app fields/types.
- No competing child-app registry / manifest scanner / plugin route family introduced.
- `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- Import-free manifest validation proven (side-effecting plugin fixture not executed).
- Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- `/api/v1/plugins/:pluginId/*` dispatch unchanged; definition and resolved
  registries remain separate and minimal (no framework creep).
- Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.
