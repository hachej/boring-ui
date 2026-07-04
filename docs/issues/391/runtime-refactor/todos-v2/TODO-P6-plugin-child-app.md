# TODO-P6 — Plugin and child-app integration

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/04-plugin-child-app-runtime.md` — child-app target, "Relationship to shared child-app platform plan" (consume, do not define), plugin manifest requirements, hosted external plugins (#357 fail-closed), `RuntimePluginContext`, shared per-workspace plugin runtime (#254), hot reload in full-app (#41), Macro-hosted-inside-full-app, secrets, managed-service plugins, Tests list.
- `docs/issues/391/runtime-refactor/06-migration-phases.md` — Phase 6 deliverables/exit ("as v1"). Prerequisite unchanged: **do not define a competing child-app registry here.**
- `docs/issues/391/runtime-refactor/00-global-isa.md` — invariants 6 (no silent widening), 8 (child-app/workspace-kind narrows, never widens), 11 (surfaces never own the loop), 14 (secrets brokered), 15 (EU-sovereign). North star: `AgentRegistry` delivery is deferred until Phase 6/7 (no speculative abstraction).
- `docs/issues/391/runtime-refactor/todos-v2/README.md` — dispatch protocol; **Simplicity & no-compat policy (binding)**: migrate importers in-PR, no shims/aliases/legacy paths, no abstraction without two real consumers (or one named consumer in the immediately following phase — `AgentRegistry` qualifies: Phase 7 consumes it), `// TODO(remove:<bead-id>)` + deletion bead for transitional code.
- `docs/issues/391/runtime-refactor/todos/TODO-05-plugins-child-app-runtime.md` — v1 beads BBA-050..056. **This pack supersedes them.** Coverage carries over; every compatibility-export/shim/deprecation-window instruction is stripped; secret handling follows the P5 brokering rule (host-side handles; brokered secrets never enter any sandboxed environment).

### Dependency — shared child-app platform plan (STATE PRECISELY, verify before starting)

`04` and `06` reference the child-app product/registry/billing/workspace-kind design as owned by **`docs/plans/shared-child-app-platform.md`** (+ issue #376). **That file does not exist in this repo** (grep-verified). The nearest artifacts are `docs/plans/archive/google-signup-child-app-plan.md` (archived) and `docs/plans/google-signup-child-app-plan.html`. Furthermore, **`childAppId` / `workspaceKind` appear nowhere in `packages/**` or `apps/**` source** (grep-verified: zero matches) — there is no resolved child-app context type in code yet.

Consequence, binding:

- This TODO **consumes** resolved child-app context; it must **not** define the product registry, billing model, hostname resolver, or `workspaceKind` schema (invariant, `04` "Relationship" section).
- The shared child-app platform plan/type (`docs/plans/shared-child-app-platform.md` → `ResolvedChildAppContext`, issue #376) is a **HARD prerequisite** for P6's child-app-**scoping** beads (BBP6-001 and anything consuming `childAppId`/`workspaceKind`). It is **not** optional and there is **no local fallback shape**: if the shared plan/type has not landed, those beads are **BLOCKED — STOP and report**. Do **not** invent a `ResolvedChildAppContext` here (a forked shape would duplicate the platform contract). When it lands, import the type **type-only** and reconcile; do not invent product/billing fields. Beads that do **not** need child-app context — manifest validation (BBP6-002), plugin runtime context, `AgentRegistry` — proceed independently of this prerequisite.

### Dependencies (phase order)

- **P6a ← P5**: P6a (BBP6-002/003/004/005/007/008) dispatches once **P5** is complete (normalizer + effective requirement resolution feeding `provisionWorkspaceRuntime()`; secret status/grant + brokering rule). It needs nothing from the child-app platform plan.
- **P6b ← P6a + child-app platform type**: P6b (BBP6-001, BBP6-006) additionally requires the shared child-app platform type (`ResolvedChildAppContext`, #376) — HARD BLOCKED / STOP-and-report until it lands (no local fallback shape). Child-app requirements intersect through the P5 normalizer once the resolved context exists.
- **P7 ← P6a + E1 + T2**: the `AgentRegistry` (BBP6-003) **and** the workspace `agents: [...]` declaration / default-agent composition (BBP6-009, a **P6a** bead) are introduced here and **consumed by Phase 7** — that is their second/immediately-following consumer, satisfying the no-speculative-abstraction rule. Keep them minimal. P7 needs P6a's `AgentRegistry` + `agents: [...]` declaration (**not** P6b's child-app scoping), plus **E1** (environment attachments) and **T2** (the `sessionId`-only transport + platform-addressing guard its surface `agentId` binding rides). (P7 explicitly STOPs and reports if the P6a pieces are absent — see `TODO-P7-multi-agent-inspection.md` "Depends on".)

### Already landed (do not redo, build on it)

- Plugin manifest reader (import-free, browser-safe): `packages/workspace/src/shared/plugins/manifest.ts` — `validateBoringPluginManifest(raw)`, `BoringPluginPackageJson` (`name`, `version`, `boring{ id, front, server, label }`, `pi{ extensions, skills, packages, systemPrompt }`), `isValidBoringPluginId`, `isSafePluginRelativePath`, `BoringPluginManifestErrorCode`, `REMOVED_BORING_UI_FIELDS`. **No `boring.requires` and no `bash` block exist yet** — extend this validator, do not add a second one.
- Plugin scan (import-free, executes no plugin code): `packages/workspace/src/server/agentPlugins/scan.ts` — `scanBoringPlugins`, `preflightBoringPlugins`, `readBoringPlugins`, `BoringPluginPreflightIssue`, `pluginIdFromPackageJson` (id derivation: `boring.id` else normalized `name` — no `boring.id` addition beyond existing). Plugin source trust kinds: `BoringPluginSource.kind = 'internal' | 'external'` (in `agentPlugins/types.ts`).
- Runtime plugin RPC (do not add a competing route family): `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts` — mounts `/api/v1/plugins/:pluginId` and `/api/v1/plugins/:pluginId/*`; `RuntimeBackendDispatcher` facade routes by `request.workspaceId`. `runtimeBackendRegistry.ts` — `RuntimeBackendRegistry` (`reloadFromLoadedPlugins`, `close`, dispose snapshots, `RuntimeBackendReloadResult`), `RuntimeBackendDispatchRequest { pluginId, method, path, query, headers, signal, body, logger, workspaceId? }`, `RuntimeBackendDispatchResponse`.
- Per-workspace plugin runtime unit: `packages/workspace/src/server/agentPlugins/manager.ts` — `BoringPluginAssetManager` (asset reload, `/reload` pickup, `LoadBoringAssetsResult`, `LoadedBoringPluginInspection`, `LoadedBoringPluginPiSnapshot`, non-hot-reloadable-surface reporting). Composition uses it in `packages/cli/src/server/modeApps.ts` (`BoringPluginAssetManager` + `RuntimeBackendRegistry` per workspace, dispatcher facade) and `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`. Core consumes plugins **statically** (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — `hotReload?: false`).
- Front plugin trust union (the seam hosted/iframe extends): `packages/workspace/src/shared/plugins/runtimePluginTypes.ts` — `BoringPluginNativeFrontTargetTrust = "local-trusted-native"`, `BoringPluginFrontTarget` union (comment: iframe/artifact kinds extend it without breaking).
- Reload route: `POST /api/v1/agent/reload` in `packages/agent/src/server/registerAgentRoutes.ts` (~line 998) + `http/routes/reload.ts`; `beforeReload` hook (ctx `{ workspaceId, workspaceRoot, request }`); plugin diagnostics tool `packages/agent/src/server/tools/pluginDiagnostics.ts`; `getPluginDiagnostics` option.
- Macro reference fixture: `packages/workspace/src/app/server/__tests__/macroRuntimeProvisioning.test.ts` (grounds child-app-scoped provisioning without hardcoding Macro in the runtime layer).
- **`AgentRegistry` does not exist** (grep-verified: zero matches) — BBP6-003 introduces it.

## Goal / exit criteria

Plugins and child apps declare runtime needs safely; one full-app deployment hosts multiple product shells (generic Seneca + Macro) without leaking tools/prompts/provisioning into generic workspaces. Exit (from `../06-migration-phases.md` Phase 6 = v1 exit = `../04-plugin-child-app-runtime.md` "Tests"), each checkable:

- [ ] import-free manifest validation runs **before** any plugin code executes.
- [ ] hosted plugin fails closed in remote mode for unsupported front/server/tool/bash/service/secret requirements.
- [ ] child-app-scoped default plugins/prompts/provisioning apply only in the matching workspace kind.
- [ ] Macro requirements do not leak into a generic workspace.
- [ ] a plugin requiring bash is skipped/diagnosed when bash is disabled.
- [ ] a plugin requiring secrets receives status only (P5 brokering; no raw values).
- [ ] trusted service plugin lifecycle works (via P5 managed services).
- [ ] runtime backend RPC still dispatches after bash extraction (`/api/v1/plugins/:pluginId/*` unchanged).
- [ ] full-app reload route resolves per workspace/agent/plugin runtime.
- [ ] child-app policy narrows but never widens workspace max policy (invariant 8); unknown `childAppId`/`workspaceKind` → stable diagnostic, never a silent fallback to Macro.
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

## Sub-parts — P6a (dispatchable) and P6b (hard-blocked)

Pass-3 split (binding): P6 is **two explicitly-labeled sub-parts** with different readiness. Dispatch them independently — do not let P6b's hard block hold P6a hostage, and do not let P6a smuggle child-app scoping forward.

**P6a — child-app-independent (dispatchable after P5).** Beads: **BBP6-002** (manifest validation for `boring.requires`/`bash`), **BBP6-003** (`AgentRegistry`), **BBP6-009** (workspace `agents: [...]` declaration + default-agent composition that seeds the `AgentRegistry`), **BBP6-004** (plugin runtime context) — plus the child-app-independent infra beads **BBP6-005** (hosted plugin fail-closed), **BBP6-007** (shared per-workspace plugin runtime), **BBP6-008** (multi-tenant reload). None of these needs anything from the shared child-app platform plan. **Grep-gated guarantee (blocking — in the acceptance of each of the named beads BBP6-002/003/004/009): these contracts contain ZERO child-app fields/types.** `grep -rn "childAppId\|workspaceKind\|ChildApp" <the file(s) each bead creates>` returns **no matches**. Child-app scoping is layered on only in P6b.

**P6b — child-app scoping (HARD BLOCKED; a tracked follow-up OUTSIDE the epic exit).** Beads: **BBP6-001** (consume resolved child-app/workspace-kind context) and **BBP6-006** (Macro requirement scoping). These are **BLOCKED — STOP and report** until the shared child-app platform type (`docs/plans/shared-child-app-platform.md` → `ResolvedChildAppContext`, #376) exists. **No local provisional shape** — a forked type would duplicate the platform contract. When it lands, import it **type-only** and reconcile. **P6b is NOT an epic exit gate: it does not gate P7 (P7 consumes P6a only) and it does not gate P8.** The #391 epic ships without P6b; P8 only verifies the P6b follow-up issue is filed (it never waits on P6b landing), so P6b's hard block can never deadlock the epic's exit.

Dispatch: **P6a ← P5**; **P6b ← P6a + child-app platform type**; **P7 ← P6a + E1 + T2** (P7 consumes the `AgentRegistry` from P6a, *not* the child-app scoping of P6b).

## Non-negotiables

- Do **not** define a competing `ChildAppDefinition`, `workspaceKind` schema, billing model, or hostname registry. Consume resolved context only (see the dependency section).
- Do **not** create a second plugin manifest scanner or second plugin id system — extend `validateBoringPluginManifest` / `scanBoringPlugins`.
- Do **not** add a competing runtime plugin route family — keep `/api/v1/plugins/:pluginId/*` and the `RuntimeBackendDispatcher` facade.
- Do **not** leak Macro tools/prompts/provisioning/panels into generic workspaces.
- Secrets follow the P5 brokering rule: plugin/browser/model contexts see status only (`missing|granted|denied|expired`); no raw values in manifests, logs, transcripts, or provisioning artifacts.
- Hosted/untrusted plugin mode stays deliberately constrained (fail-closed) unless host policy promotes the plugin to a trusted tier.
- `AgentRegistry` is a **minimal Map-backed** data structure — no lifecycle framework, no plugin system, no speculative parameters. Phase 7 is its consumer.
- `@hachej/boring-agent` keeps zero value imports from `@hachej/boring-bash`; surfaces never own the loop (invariant 11).

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work only in this worktree. Do not commit.
- Do not build the child-app product registry/billing/hostname resolver.
- Do not re-shape the landed #416 `packages/boring-bash/src/shared` contracts.
- Do not add a US-hosted provider as a default (invariant 15).
- Do not hot-register unsafe server routes on reload — reload diagnoses drift; trusted server-plugin route/tool changes still require restart/redeploy.

## Beads

### BBP6-001 — [P6b · HARD BLOCKED] Consume resolved child-app/workspace-kind context [size M]

- **Files create:** `packages/workspace/src/server/childApp/resolvedChildAppContext.ts` (the **consumption seam** type + intersection helper) + `__tests__/`.
- **Files touch:** `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` and `packages/cli/src/server/modeApps.ts` (thread an optional host-supplied `ResolvedChildAppContext` into requirement/plugin/prompt resolution — do not source it here); the P5 normalizer call sites (child-app requirements become one requirement source).
- **Notes:** **Hard-prerequisite check first:** `ResolvedChildAppContext` is owned by the shared child-app platform plan (`docs/plans/shared-child-app-platform.md` / #376). Import it **type-only**. **If that plan/type has not landed, this bead is BLOCKED — STOP and report; do NOT define a local shape** (no fallback, no `// TODO(remove:BBP6-001)` stub — a forked shape would duplicate the platform contract). Once it has landed, apply the effective policy stack (`app defaults < resolved childApp/workspaceKind < workspace < agent < session grants < plugin/tool requirement`); child-app narrows, never widens (invariant 8). Billing/product ids are core-owned metadata for diagnostics only — never consumed by boring-bash logic. Unknown `childAppId`/`workspaceKind` → stable diagnostic, no silent Macro fallback.
- **Tests:** generic workspace excludes child-app-scoped plugins/prompts/provisioning; matching kind includes them; child-app policy narrows but cannot widen workspace max; unknown id → stable error; billing/product metadata reaches diagnostics only.
- **Acceptance:** the runtime layer consumes child-app context and scopes requirements without owning or duplicating the child-app platform.

### BBP6-002 — [P6a] Extend plugin manifest validation import-free for `boring.requires` + `bash` [size M]

- **Files touch:** `packages/workspace/src/shared/plugins/manifest.ts` (add `boring.requires?: string[]` and a `bash?` block validation: `capabilities{ fs:'readonly'|'readwrite', exec, services, secrets }`, `nodePackages`, `python`, `templateDirs`, `sdkArchives`, `env`/`pathEntries`, `services`); `packages/workspace/src/server/agentPlugins/scan.ts` (surface new fields on `BoringServerPluginManifest`, preflight-validate before code import); `agentPlugins/types.ts`.
- **Notes:** Extend the existing validator — no second scanner, no new plugin id system, keep `boring.id` behavior. Validate `boring.requires` entries (e.g. `"boring-bash"`) and the `bash` block **before** executing plugin code. Validate safe relative paths/containment for any manifest file references (reuse `isSafePluginRelativePath`/`resolveContainedPluginPath`). Reject raw secret **values** in the manifest — allow secret **names/grant refs** only (P5). Add stable `BoringPluginManifestErrorCode` entries for unsupported requirement, trust-tier mismatch, missing `boring-bash`. Optional requirement failure degrades with a diagnostic, does not block unrelated plugin features. Reuse the `bash` requirement shape from P5 (`@hachej/boring-bash/shared` `BashRequirement` sub-types) — type-only import into the browser-safe manifest module (data shapes only, no `node:*`).
- **Tests:** manifest requiring bash is skipped/diagnosed when bash is disabled; invalid `bash` block rejected before import; side-effecting `boring.server`/`boring.front` fixture proves validation is import-free; existing trusted plugins still load; hosted iframe fields still validate; raw secret value in manifest rejected with stable code; optional requirement failure degrades; `boring.id` behavior unchanged.
- **Acceptance:** hosts determine whether a plugin is allowed/ready without executing untrusted plugin code. **P6a grep-gate (blocking):** the manifest validator carries ZERO child-app fields/types — `grep -rn "childAppId\|workspaceKind\|ChildApp" packages/workspace/src/shared/plugins/manifest.ts packages/workspace/src/server/agentPlugins/scan.ts packages/workspace/src/server/agentPlugins/types.ts` returns no matches (child-app scoping of manifests is P6b, layered elsewhere).

### BBP6-003 — [P6a] Introduce `AgentRegistry` (minimal, Map-backed) [size S]

- **Files create:** `packages/agent/src/server/agents/AgentRegistry.ts` (Map-backed registry keyed by `agentId`) + `__tests__/`.
- **Files touch:** `packages/agent/src/server/index.ts` (export the type + class).
- **Notes:** Minimal: `register(agentId, entry)`, `get(agentId)`, `list()`, `has(agentId)`, `delete(agentId)` over a `Map`. `entry` holds only what Phase 6/7 need now: resolved agent id, default tool/plugin set reference, readiness handle. **It carries NO child-app fields** (`childAppId`/`workspaceKind`) — child-app scoping of an agent is layered on in **P6b**, never in this P6a contract. **No lifecycle framework, no event bus, no dispose orchestration** beyond `delete`. This is the data structure Phase 7 (`agentId`-scoped routes, per-agent catalog/readiness, agent inspection endpoint) consumes — do not build those consumers here. No env-var reads (P1 rule).
- **Tests:** register/get/list/has/delete round-trip; duplicate id policy (last-write or reject — pick one, test it); type-only shape carries `agentId` and no child-app field.
- **Acceptance:** a minimal registry exists for Phase 6a wiring and Phase 7 consumption; no framework creep. **P6a grep-gate (blocking):** `grep -rn "childAppId\|workspaceKind\|ChildApp" packages/agent/src/server/agents/AgentRegistry.ts` returns no matches.

### BBP6-004 — [P6a] Runtime plugin context (`RuntimePluginContext`) on the gateway [size M]

- **Files create:** `packages/workspace/src/server/runtimeBackend/runtimePluginContext.ts` (`RuntimePluginContext` per `../04`) + `__tests__/`.
- **Files touch:** `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts` / `runtimeBackendRegistry.ts` (`RuntimeBackendDispatchRequest` → derive and attach context); composition (core/cli/workspace) to supply the feature/readiness/secret-status sources.
- **Notes:** Do not add a competing route family. The **P6a** context carries **no child-app fields**: `RuntimePluginContext { pluginId, workspaceId?, availableFeatures{ bash?: BashEnvironmentSummary, uiBridge?: boolean, secrets?: Record<string,'missing'|'granted'|'denied'|'expired'>, services?: Record<string,'not-started'|'starting'|'ready'|'failed'> } }`. **`childAppId`/`workspaceKind` are NOT part of this contract** — child-app scoping of the plugin context is layered on in **P6b** (BBP6-001), which extends the derived context once `ResolvedChildAppContext` exists. Context is **derived from resolved policy/readiness** (P5), never from plugin-controlled request params/body — plugin cannot spoof `workspaceId`/`agentId`/feature availability. Secret entries are status only (P5 brokering). Missing required feature → clear diagnostic response, no unsafe backend action; missing optional feature → visible, non-fatal.
- **Tests:** trusted plugin backend receives context; missing required feature → stable diagnostic, no unsafe action; secret context is status-only; service status updates with readiness; existing `/api/v1/plugins/:pluginId/*` dispatch still works; plugin cannot spoof context via params/body.
- **Acceptance:** runtime plugin backends degrade safely with explicit scoped context; no route proliferation. **P6a grep-gate (blocking):** `grep -rn "childAppId\|workspaceKind\|ChildApp" packages/workspace/src/server/runtimeBackend/runtimePluginContext.ts` returns no matches (child-app scoping is P6b).

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

- **Files touch:** `packages/agent/src/server/registerAgentRoutes.ts` (`/api/v1/agent/reload`, `beforeReload`, `getPluginDiagnostics`) and the full-app composition (`apps/full-app/src/server/*`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`) to resolve per request: workspace, agent binding (BBP6-003 `AgentRegistry`), plugin runtime, boring-bash requirement/readiness state, `beforeReload` hook, asset manager, backend registry, Pi/plugin snapshots.
- **Notes:** `/api/v1/agent/reload` works in full-app where enabled. Pure/headless agents reload without boring-bash unless a plugin requirement pulls it. Reload diagnostics include manifest validation, requirement validation, provisioning readiness, and plugin import/runtime errors (surface via `getPluginDiagnostics`/`plugin_diagnostics` tool). Trusted server-plugin route/tool changes are **diagnosed, not hot-registered** (no unsafe hot route registration). Missing/unauthorized workspace → stable error.
- **Tests:** reload resolves per workspace; missing/unauthorized workspace → stable error; plugin assets reload and backend dispatch still work; pure/headless reload works without boring-bash; trusted server-plugin backend changes diagnosed not hot-swapped; reload surfaces requirement/provisioning errors without losing a previously working UI where applicable.
- **Acceptance:** multi-tenant full-app reload works without route 404s or silent slash-command failures.

### BBP6-009 — [P6a] Workspace `agents: [...]` declaration + default-agent composition (seeds `AgentRegistry`) [size S]

- **Files create:** `packages/workspace/src/shared/agents/workspaceAgentsDeclaration.ts` (the minimal import-free declaration schema `WorkspaceAgentsDeclaration { agents: WorkspaceAgentDeclaration[]; defaultAgentId: string }`, `WorkspaceAgentDeclaration { agentId; label?; toolset?; environments? }`, a `validateWorkspaceAgentsDeclaration(raw)` + `resolveDefaultAgentId(decl)` helper) + `__tests__/`.
- **Files touch:** the composition seams that build the `AgentRegistry` (BBP6-003) per workspace — `packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — to read the (host-supplied, already-parsed) declaration and **seed the `AgentRegistry`** with one entry per declared agent, plus record the default agent. When no declaration is present, compose a **single implicit `default` agent** so single-agent workspaces are byte-identical to today (matches the T1/T2 canonical `default` agentId until this lands).
- **Notes:** This is the workspace-side declaration `05` § "Workspace agent registry" calls for and that **Phase 7 (`BBP7-001`/`BBP7-002`) consumes** to resolve/validate `agentId` against the registry (`TODO-P7` "Depends on … the workspace `agents: [...]` declaration"). Keep it **minimal and child-app-free**: no `childAppId`/`workspaceKind`/`ChildApp` fields anywhere (child-app defaults *seeding* this set is P6b, layered on via `ResolvedChildAppContext` — not here). The declaration is host-composed already-parsed config — **no env-var reads, no file discovery** in the declaration module (P1 rule); the host reads/parses and passes it in. Default-agent composition is pure data (pick `defaultAgentId`, else the sole/implicit `default`); no lifecycle framework. Do **not** build the `agentId` request-addressing resolver here — that is P7 (`BBP7-002`); this bead only ships the declaration + registry seeding.
- **Tests:** a declaration with two agents seeds two `AgentRegistry` entries + a resolvable default; absent declaration yields exactly one implicit `default` agent (single-agent parity); invalid declaration (duplicate `agentId`, missing `defaultAgentId` target) rejected with a stable code; **grep-gate**: the declaration module has zero child-app fields.
- **Acceptance:** the workspace `agents: [...]` declaration + default-agent composition exists and seeds the `AgentRegistry`; single-agent workspaces are unchanged; Phase 7 can resolve `agentId` against it. **P6a grep-gate (blocking):** `grep -rn "childAppId\|workspaceKind\|ChildApp" packages/workspace/src/shared/agents/workspaceAgentsDeclaration.ts` returns no matches.

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

## Review gates

- **P6a/P6b split (blocking):** P5 precondition confirmed for **P6a** (or STOP+report). The shared child-app platform type (`ResolvedChildAppContext`, #376) is a **HARD prerequisite for P6b** (BBP6-001, BBP6-006): if absent, those **STOP-and-report with no local fallback shape**. **P6a** (BBP6-002 manifest validation, BBP6-003 `AgentRegistry`, BBP6-009 workspace `agents: [...]` declaration, BBP6-004 plugin runtime context, plus BBP6-005/007/008) proceeds independently. **P6a grep-gate (blocking):** each named P6a contract contains ZERO child-app fields/types — `grep -rn "childAppId\|workspaceKind\|ChildApp"` on each created file (manifest validator, `AgentRegistry.ts`, `workspaceAgentsDeclaration.ts`, `runtimePluginContext.ts`) returns no matches.
- No competing child-app registry / manifest scanner / plugin route family introduced.
- `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- Import-free manifest validation proven (side-effecting plugin fixture not executed).
- Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- Macro requirements do not leak into a generic workspace; child-app policy narrows, never widens; unknown id → stable diagnostic.
- Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- `/api/v1/plugins/:pluginId/*` dispatch unchanged; `AgentRegistry` minimal and Map-backed (no framework creep).
- Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.
