# TODO-P6 — Plugin and child-app integration

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/architecture/04-plugin-child-app-runtime.md` — child-app target, "Relationship to shared child-app platform plan" (consume, do not define), plugin manifest requirements, hosted external plugins (#357 fail-closed), `RuntimePluginContext`, shared per-workspace plugin runtime (#254), hot reload in full-app (#41), Macro-hosted-inside-full-app, secrets, managed-service plugins, Tests list.
- `docs/issues/391/runtime-refactor/INDEX.md` — Phase 6 deliverables/exit ("as v1"). Prerequisite unchanged: **do not define a competing child-app registry here.**
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — invariants 6 (no silent widening), 8 (child-app/workspace-kind narrows, never widens), 11 (surfaces never own the loop), 14 (secrets brokered), 15 (EU-sovereign). North star: `AgentRegistry` delivery is deferred until Phase 6/7 (no speculative abstraction).
- `docs/issues/391/runtime-refactor/INDEX.md` — dispatch protocol; **Simplicity & no-compat policy (binding)**: migrate importers in-PR, no shims/aliases/legacy paths, no abstraction without two real consumers (or one named consumer in the immediately following phase — `AgentRegistry` qualifies: Phase 7 consumes it), `// TODO(remove:<bead-id>)` + deletion bead for transitional code.
- The v1 child-app/plugin coverage (BBA-050..056) is **superseded and non-canonical** here — every compatibility-export/shim/deprecation-window instruction is stripped; secret handling follows the P5 brokering rule (host-side handles; brokered secrets never enter any sandboxed environment).

### Dependency — shared child-app platform plan (STATE PRECISELY, verify before starting)

[`../../architecture/04-plugin-child-app-runtime.md`](../../architecture/04-plugin-child-app-runtime.md) and [`../../architecture/05-multi-agent-sessions-hooks.md`](../../architecture/05-multi-agent-sessions-hooks.md) reference the child-app product/registry/billing/workspace-kind design as owned by the **real plan `docs/issues/376/plan.md`** (issue #376). Verified reality: that plan exists and describes `resolveChildAppContext`, `childAppId`, and `workspaceKind`, but the current repo has **no code export** named `ResolvedChildAppContext`; `! rg -n "ResolvedChildAppContext|childAppId|workspaceKind|ChildApp" packages apps` exits 0 today. P6b consumes the owner-approved exported resolved context type from #376 (expected name: `ResolvedChildAppContext`) — it does not define product/registry/billing/workspace-kind here. Until that code export exists, P6b's child-app-scoping beads stay **BLOCKED**.

Consequence, binding:

- This TODO **consumes** resolved child-app context; it must **not** define the product registry, billing model, hostname resolver, or `workspaceKind` schema (invariant, `04` "Relationship" section).
- The shared child-app platform implementation/type (issue #376; expected export `ResolvedChildAppContext`) is a **HARD prerequisite** for P6's child-app-**scoping** beads (BBP6-001 and anything consuming `childAppId`/`workspaceKind`). It is **not** optional and there is **no local fallback shape**: if the shared type has not landed in code, those beads are **BLOCKED — STOP and report**. Do **not** invent a `ResolvedChildAppContext` here (a forked shape would duplicate the platform contract). When it lands, import the type **type-only** and reconcile to the owner-approved export; do not invent product/billing fields. Beads that do **not** need child-app context — manifest validation (BBP6-002), plugin runtime context, `AgentRegistry` — proceed independently of this prerequisite.

### Dependencies (phase order)

- **P6a ← P5**: P6a (BBP6-002/003/004/005/007/008) dispatches once **P5** is complete (normalizer + effective requirement resolution feeding `provisionWorkspaceRuntime()`; secret status/grant + brokering rule). It needs nothing from the child-app platform plan.
- **P6b ← P6a + child-app platform type**: P6b (BBP6-001, BBP6-006) additionally requires the shared child-app platform code export (expected `ResolvedChildAppContext`, #376) — HARD BLOCKED / STOP-and-report until it lands (no local fallback shape). Child-app requirements intersect through the P5 normalizer once the resolved context exists.
- **P7 ← P6a + E1 + T2**: the `AgentRegistry` (BBP6-003) **and** the workspace `agents: [...]` `AgentDefinitionDeclaration` / default-agent composition (BBP6-009, a **P6a** bead) are introduced here and **consumed by Phase 7** — that is their second/immediately-following consumer, satisfying the no-speculative-abstraction rule. Keep the registry minimal; the definition schema is the canonical authored declaration. P7 needs P6a's `AgentRegistry` + definition declaration (**not** P6b's child-app scoping), plus **E1** (environment attachments/facts) and **T2** (the `sessionId`-only transport + platform-addressing guard its surface `agentId` binding rides). (P7 explicitly STOPs and reports if the P6a pieces are absent — see [`../P7-multi-agent-inspection/TODO.md`](../P7-multi-agent-inspection/TODO.md) "Depends on".)

### Already landed (do not redo, build on it)

- Plugin manifest reader (import-free, browser-safe): `packages/workspace/src/shared/plugins/manifest.ts` — `validateBoringPluginManifest(raw)`, `BoringPluginPackageJson` (`name`, `version`, `boring{ id, front, server, label }`, `pi{ extensions, skills, packages, systemPrompt }`), `isValidBoringPluginId`, `isSafePluginRelativePath`, `BoringPluginManifestErrorCode`, `REMOVED_BORING_UI_FIELDS`. **No `boring.requires` and no `bash` block exist yet** — extend this validator, do not add a second one.
- Plugin scan (import-free, executes no plugin code): `packages/workspace/src/server/agentPlugins/scan.ts` — `scanBoringPlugins`, `preflightBoringPlugins`, `readBoringPlugins`, `BoringPluginPreflightIssue`, `pluginIdFromPackageJson` (id derivation: `boring.id` else normalized `name` — no `boring.id` addition beyond existing). Plugin source trust kinds: `BoringPluginSource.kind = 'internal' | 'external'` (in `agentPlugins/types.ts`).
- Runtime plugin RPC (do not add a competing route family): `packages/workspace/src/server/runtimeBackend/runtimeBackendGateway.ts` — mounts `/api/v1/plugins/:pluginId` and `/api/v1/plugins/:pluginId/*`; `RuntimeBackendDispatcher` facade routes by `request.workspaceId`. `runtimeBackendRegistry.ts` — `RuntimeBackendRegistry` (`reloadFromLoadedPlugins`, `close`, dispose snapshots, `RuntimeBackendReloadResult`), `RuntimeBackendDispatchRequest { pluginId, method, path, query, headers, signal, body, logger, workspaceId? }`, `RuntimeBackendDispatchResponse`.
- Per-workspace plugin runtime unit: `packages/workspace/src/server/agentPlugins/manager.ts` — `BoringPluginAssetManager` (asset reload, `/reload` pickup, `LoadBoringAssetsResult`, `LoadedBoringPluginInspection`, `LoadedBoringPluginPiSnapshot`, non-hot-reloadable-surface reporting). Composition uses it in `packages/cli/src/server/modeApps.ts` (`BoringPluginAssetManager` + `RuntimeBackendRegistry` per workspace, dispatcher facade) and `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`. Core consumes plugins **statically** (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — `hotReload?: false`).
- Front plugin trust union (the seam hosted/iframe extends): `packages/workspace/src/shared/plugins/runtimePluginTypes.ts` — `BoringPluginNativeFrontTargetTrust = "local-trusted-native"`, `BoringPluginFrontTarget` union (comment: iframe/artifact kinds extend it without breaking).
- Reload route: `POST /api/v1/agent/reload` in `packages/agent/src/server/registerAgentRoutes.ts` (~line 998) + `http/routes/reload.ts`; `beforeReload` hook (ctx `{ workspaceId, workspaceRoot, request }`); plugin diagnostics tool `packages/agent/src/server/tools/pluginDiagnostics.ts`; `getPluginDiagnostics` option.
- Macro reference fixture: `packages/workspace/src/app/server/__tests__/macroRuntimeProvisioning.test.ts` (grounds child-app-scoped provisioning without hardcoding Macro in the runtime layer).
- **`AgentRegistry` does not exist** in `packages/agent/src` or `packages/workspace/src` (`! rg -n "AgentRegistry" packages/agent/src packages/workspace/src` exits 0 today) — BBP6-003 introduces it.

## Goal / exit criteria

Plugins and child apps declare runtime needs safely. P6 is split into a dispatchable **P6a epic gate** and a **P6b blocked follow-up** exactly as in [`HANDOFF.md`](./HANDOFF.md) and [`../../INDEX.md`](../../INDEX.md): P6a ships the child-app-independent plugin/agent-registry core that P7/P8 consume; P6b later consumes the shared child-app platform type for Macro/workspace-kind scoping and is outside the epic exit.

### P6a epic gate (dispatchable after P5; P7/P8 depend on this)

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

**P6a — child-app-independent (dispatchable after P5).** Beads: **BBP6-002** (manifest validation for `boring.requires`/`bash` plus skill filters over resolved environment facts), **BBP6-003** (`AgentRegistry`), **BBP6-009** (workspace `agents: [...]` `AgentDefinitionDeclaration` + default-agent composition that seeds the `AgentRegistry`), **BBP6-004** (plugin runtime context) — plus the child-app-independent infra beads **BBP6-005** (hosted plugin fail-closed), **BBP6-007** (shared per-workspace plugin runtime), **BBP6-008** (multi-tenant reload). None of these needs anything from the shared child-app platform plan. **Grep-gated guarantee (blocking — in the acceptance of each of the named beads BBP6-002/003/004/009): these contracts contain ZERO child-app fields/types.** `! rg -n "childAppId|workspaceKind|ChildApp" <the file(s) each bead creates>` exits 0. Child-app scoping is layered on only in P6b.

**P6b — child-app scoping (HARD BLOCKED; a tracked follow-up OUTSIDE the epic exit).** Beads: **BBP6-001** (consume resolved child-app/workspace-kind context) and **BBP6-006** (Macro requirement scoping). These are **BLOCKED — STOP and report** until the shared child-app platform code export (expected `ResolvedChildAppContext`, #376) exists. **No local provisional shape** — a forked type would duplicate the platform contract. When it lands, import it **type-only** and reconcile to the owner-approved export. **P6b is NOT an epic exit gate: it does not gate P7 (P7 consumes P6a only) and it does not gate P8.** The #391 epic ships without P6b; P8 only verifies the P6b follow-up plus M2/D1/S4 follow-up or status tracking (it never waits on P6b landing), so P6b's hard block can never deadlock the epic's exit.

Dispatch: **P6a ← P5**; **P6b ← P6a + child-app platform type**; **P7 ← P6a + E1 + T2** (P7 consumes the `AgentRegistry` from P6a, *not* the child-app scoping of P6b).

## Non-negotiables

- Do **not** define a competing `ChildAppDefinition`, `workspaceKind` schema, billing model, or hostname registry. Consume resolved context only (see the dependency section).
- Do **not** create a second plugin manifest scanner or second plugin id system — extend `validateBoringPluginManifest` / `scanBoringPlugins`.
- Do **not** add a competing runtime plugin route family — keep `/api/v1/plugins/:pluginId/*` and the `RuntimeBackendDispatcher` facade.
- Do **not** leak Macro tools/prompts/provisioning/panels into generic workspaces.
- Secrets follow the P5 brokering rule: plugin/browser/model contexts see status only (`missing|granted|denied|expired`); no raw values in manifests, logs, transcripts, or provisioning artifacts.
- Hosted/untrusted plugin mode stays deliberately constrained (fail-closed) unless host policy promotes the plugin to a trusted tier.
- `AgentRegistry` is a **minimal Map-backed** data structure — no lifecycle framework, no plugin system, no speculative parameters. Phase 7 is its consumer.
- `AgentDefinitionDeclaration` is the canonical authored agent definition shape. P7, M1/M2, S1, S2, S3, S4, and later factory/provisioning work consume this same definition or a lossless projection. Unknown instruction/persona/capability/environment/sandbox/governance/model/demo/pricing/exposure refs fail closed.
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
- **Notes:** **Hard-prerequisite check first:** the resolved child-app context type is owned by the shared child-app platform implementation (#376; expected export `ResolvedChildAppContext`). Import it **type-only**. **If that code export has not landed, this bead is BLOCKED — STOP and report; do NOT define a local shape** (no fallback, no `// TODO(remove:BBP6-001)` stub — a forked shape would duplicate the platform contract). Once it has landed, apply the effective policy stack (`app defaults < resolved childApp/workspaceKind < workspace < agent < session grants < plugin/tool requirement`); child-app narrows, never widens (invariant 8). Billing/product ids are core-owned metadata for diagnostics only — never consumed by boring-bash logic. Unknown `childAppId`/`workspaceKind` → stable diagnostic, no silent Macro fallback.
- **Tests:** generic workspace excludes child-app-scoped plugins/prompts/provisioning; matching kind includes them; child-app policy narrows but cannot widen workspace max; unknown id → stable error; billing/product metadata reaches diagnostics only.
- **Acceptance:** the runtime layer consumes child-app context and scopes requirements without owning or duplicating the child-app platform.

### BBP6-002 — [P6a] Extend plugin manifest validation import-free for `boring.requires` + `bash`; reserve skill filters over resolved environment facts [size M]

- **Files touch:** `packages/workspace/src/shared/plugins/manifest.ts` (add `boring.requires?: string[]` and a `bash?` block validation: `capabilities{ fs:'readonly'|'readwrite', exec, services, secrets }`, `nodePackages`, `python`, `templateDirs`, `sdkArchives`, `env`/`pathEntries`, `services`); `packages/workspace/src/server/agentPlugins/scan.ts` (surface new fields on `BoringServerPluginManifest`, preflight-validate before code import); `agentPlugins/types.ts`; the skill-loading boundary files that already assemble skill availability (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`, `packages/agent/src/server/http/routes/skills.ts`, and workspace/plugin skill mirroring call sites) for a lightweight requirement filter.
- **Notes:** Extend the existing validator — no second scanner, no new plugin id system, keep `boring.id` behavior. Validate `boring.requires` entries (legacy strings such as `"boring-bash"` may remain as manifest shorthand) and the `bash` block **before** executing plugin code, then lower them into requirements over resolved environment facts: filesystem access, exec/bash tools, services, secrets, provider facts, and unknown/reported status. Validate safe relative paths/containment for any manifest file references (reuse `isSafePluginRelativePath`/`resolveContainedPluginPath`). Reject raw secret **values** in the manifest — allow secret **names/grant refs** only (P5). Add stable `BoringPluginManifestErrorCode` entries for unsupported requirement, trust-tier mismatch, missing required environment fact, and unknown required fact. Optional requirement failure degrades with a diagnostic, does not block unrelated plugin features. Reuse the `bash` requirement shape from P5 (`@hachej/boring-bash/shared` `BashRequirement` sub-types) — type-only import into the browser-safe manifest module (data shapes only, no `node:*`).
- **Skill capability reservation:** Skills may declare capability requirements in a boring-style metadata field (spelling can be `boring.requires` or an equivalent frontmatter key chosen during implementation, but it must be documented once and kept lightweight). The owner is the skill-loading boundary, not model prompt assembly after the fact: hosts filter skills by the active agent's resolved environment facts before passing skills to Pi, before returning `/api/v1/agent/skills`, and before registering slash-command suggestions from skills. The prompt-visible skills index is generated from this filtered set; per-skill `SKILL.md` content still loads on demand. A filesystem/bash-required skill is absent when no resolved environment fact satisfies that requirement. This is a reservation-level filter only; do not build a rich skill policy language.
- **Tests:** manifest requiring bash/exec/filesystem facts is skipped/diagnosed when the resolved facts are missing or unknown; invalid `bash` block rejected before import; side-effecting `boring.server`/`boring.front` fixture proves validation is import-free; existing trusted plugins still load; hosted iframe fields still validate; raw secret value in manifest rejected with stable code; optional requirement failure degrades; `boring.id` behavior unchanged; a skill declaring filesystem/bash requirements is filtered from Pi resources, `/api/v1/agent/skills`, slash suggestions, and the generated skills-index prompt fragment when no resolved environment fact satisfies it but visible when the fact is present.
- **Acceptance:** hosts determine whether a plugin is allowed/ready without executing untrusted plugin code, and skill availability is filtered by resolved environment facts where skills are loaded. The generated skills-index prompt fragment is downstream of the same filter and never advertises a skill whose requirements are unsatisfied. **P6a grep-gate (blocking):** the manifest validator carries ZERO child-app fields/types — `! rg -n "childAppId|workspaceKind|ChildApp" packages/workspace/src/shared/plugins/manifest.ts packages/workspace/src/server/agentPlugins/scan.ts packages/workspace/src/server/agentPlugins/types.ts` exits 0 (child-app scoping of manifests is P6b, layered elsewhere).

### BBP6-003 — [P6a] Introduce `AgentRegistry` (minimal, Map-backed) [size S]

- **Files create:** `packages/agent/src/server/agents/AgentRegistry.ts` (Map-backed registry keyed by `agentId`) + `__tests__/`.
- **Files touch:** `packages/agent/src/server/index.ts` (export the type + class).
- **Notes:** Minimal: `register(agentId, entry)`, `get(agentId)`, `list()`, `has(agentId)`, `delete(agentId)` over a `Map`. `entry` holds only what Phase 6/7 need now: resolved agent id, default tool/plugin set reference, readiness handle. **It carries NO child-app fields** (`childAppId`/`workspaceKind`) — child-app scoping of an agent is layered on in **P6b**, never in this P6a contract. **No lifecycle framework, no event bus, no dispose orchestration** beyond `delete`. This is the data structure Phase 7 (`agentId`-scoped routes, per-agent catalog/readiness, agent inspection endpoint) consumes — do not build those consumers here. No env-var reads (P1 rule).
- **Tests:** register/get/list/has/delete round-trip; duplicate registration fails closed with stable `AGENT_ALREADY_EXISTS` (never last-write replacement); type-only shape carries `agentId` and no child-app field.
- **Acceptance:** a minimal registry exists for Phase 6a wiring and Phase 7 consumption; no framework creep. **P6a grep-gate (blocking):** `! rg -n "childAppId|workspaceKind|ChildApp" packages/agent/src/server/agents/AgentRegistry.ts` exits 0.

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

- **Files touch:** `packages/agent/src/server/registerAgentRoutes.ts` (`/api/v1/agent/reload`, `beforeReload`, `getPluginDiagnostics`) and the full-app composition (`apps/full-app/src/server/*`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`) to resolve per request: workspace, agent binding (BBP6-003 `AgentRegistry`), plugin runtime, boring-bash requirement/readiness state, `beforeReload` hook, asset manager, backend registry, Pi/plugin snapshots.
- **Notes:** `/api/v1/agent/reload` works in full-app where enabled. Pure/headless agents reload without boring-bash unless a plugin requirement pulls it. Reload diagnostics include manifest validation, requirement validation, provisioning readiness, and plugin import/runtime errors (surface via `getPluginDiagnostics`/`plugin_diagnostics` tool). Trusted server-plugin route/tool changes are **diagnosed, not hot-registered** (no unsafe hot route registration). Missing/unauthorized workspace → stable error.
- **Tests:** reload resolves per workspace; missing/unauthorized workspace → stable error; plugin assets reload and backend dispatch still work; pure/headless reload works without boring-bash; trusted server-plugin backend changes diagnosed not hot-swapped; reload surfaces requirement/provisioning errors without losing a previously working UI where applicable.
- **Acceptance:** multi-tenant full-app reload works without route 404s or silent slash-command failures.

### BBP6-009 — [P6a] Workspace `agents: [...]` `AgentDefinitionDeclaration` + default-agent composition (seeds `AgentRegistry`) [size M]

- **Files create:** `packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` (import-free, **front-safe** declaration schema + validator — no `node:*`, no `Buffer`, no Fastify) + `__tests__/`. **Amendment (2026-07-08): the canonical definition schema lives in `@hachej/boring-agent`, not `boring-workspace`.** Rationale: once BBP6-009 became the *canonical* authored agent definition (not a narrow workspace declaration), it is a contract consumed by non-workspace surfaces (M1/M2 MCP, S1 Slack, S2 embed, D1 tenant provisioning) that must not depend on the workspace package; `boring-agent` is the "defines all contracts, imports nothing" package and the definition is the input to the agent core resolver. Invariant compliance: the workspace/core/cli **server** composition seams value-import the validator (server-side, allowed), and the workspace **front** (S3/S4 lists) uses `import type` only (allowed under the "zero value imports from `@hachej/boring-agent` in workspace base front/shared" invariant). It sits alongside `packages/agent/src/shared/capabilities.ts`. The canonical schema is `WorkspaceAgentsDeclaration { agents: AgentDefinitionDeclaration[]; defaultAgentId: string; environments?: EnvironmentPoolEntry[] }` (the `agents:[]` array is *workspace config that carries* the definitions; the definition *type* is agent-owned; `environments?:[]` is the project environment pool that `environmentAttachments` refs resolve against — see the pool invariant below). `AgentDefinitionDeclaration` includes:
  - `agentId`, `label?`, `description?`;
  - `instructionsRef?` and `personaRef?`;
  - capability bundles/toolset refs (`capabilityBundles?`, `tools?`, `skills?`, `mcpServers?`);
  - `environmentAttachments?` (authored requirements only; host resolves to environment facts);
  - `sandboxPolicyRef?`;
  - `governancePolicyRef?`;
  - `modelPolicyRef?`;
  - `demoPolicyRef?`;
  - `pricingRef?`;
  - `exposure?` / exposure config (`exposureId?`, allowed surface refs, public-demo/bearer policy refs);
  - optional metadata refs needed by S3/S4 display, but no lifecycle methods and no executable code.
- **Files touch:** the composition seams that build the `AgentRegistry` (BBP6-003) per workspace — `packages/cli/src/server/modeApps.ts`, `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — to read the (host-supplied, already-parsed) declaration and **seed the `AgentRegistry`** with one entry per declared agent, plus record the default agent. When no declaration is present, compose a **single implicit `default` agent** so single-agent workspaces are byte-identical to today (matches the T1/T2 canonical `default` agentId until this lands).
- **Notes:** This is the workspace-side declaration `05` § "Workspace agent registry" calls for and that **Phase 7 (`BBP7-001`/`BBP7-002`) consumes** to resolve/validate `agentId` against the registry (`TODO-P7` "Depends on … the workspace `agents: [...]` declaration"). **Amendment (2026-07-08):** it is now the canonical authored agent definition, not a narrow `WorkspaceAgentDeclaration`. Unknown refs fail closed: unknown instruction/persona/capability bundle/environment/sandbox/governance/model/demo/pricing/exposure refs are validation errors, not warnings or empty defaults. The declaration is requirements-only; it does not grant power. Hosts resolve it into `ResolvedAgentComposition` using policy, provider facts, environment attachments, and readiness. Keep it **child-app-free**: no `childAppId`/`workspaceKind`/`ChildApp` fields anywhere (child-app defaults *seeding* this set is P6b, layered on via `ResolvedChildAppContext` — not here). The schema/validator module is agent-owned and workspace-free: no imports from `@hachej/boring-workspace` (the definition must be readable by a standalone non-workspace surface). The declaration is host-composed already-parsed config — **no env-var reads, no file discovery** in the declaration module (P1 rule); the host reads/parses and passes it in. Default-agent composition is pure data (pick `defaultAgentId`, else the sole/implicit `default`); no lifecycle framework. Do **not** build the `agentId` request-addressing resolver here — that is P7 (`BBP7-002`); this bead only ships the declaration + registry seeding.
- **Multi-agent + environment scoping (invariant, Amendment 2026-07-08):** the `AgentRegistry` is **project/workspace-scoped, never a global singleton**. One workspace holds **N agents**; the same `agentId` declared in two different projects is **two independent instantiations**, each bound at `createAgent()` time to *its own project's* environments (per `09` + E1). Within one workspace, agents attach environments **by reference**: two agents referencing the same environment id **share** that filesystem (readonly = clean; readwrite = explicit concurrent access per `09` sharing semantics), two referencing different ids are **isolated**. The registry holds definitions/handles; it never owns filesystems — environments are project-scoped resources agents reference, not agent-private state.
- **Workspace environment-pool declaration (companion to `agents:[]`):** the workspace config carries an `environments: [...]` pool declaration alongside `agents: [...]` — the set of environment ids available in this project (e.g. `user`, `company_context`, `team_scratch`), each with provider/access/governance refs. `AgentDefinitionDeclaration.environmentAttachments` refs resolve **against this pool**; an attachment referencing an id absent from the pool is a fail-closed validation error (same rule as unknown policy refs). This is the environment-side counterpart of the agent declaration and, like it, is host-supplied already-parsed config (no env reads / file discovery in the declaration module). `company_context` is the reference pool entry (unchanged #416/governance provenance); the generalized pool is what lets multiple agents in one workspace share or hold distinct filesystems. `defaultAgentId` and the pool together are what a workspace host reads to *create the agents inside the project*.
- **Amendment (2026-07-08): Shared-tier declaration refs:** add optional `host`/subdomain binding and seed-source refs to `WorkspaceAgentsDeclaration` so a declaration is directly hot-loadable as a D2 shared-tier tenant, while staying child-app-free. Record D2 as a same-definition consumer beside D1; both tiers consume the same declaration and environment pool.
- **Same-definition consumers:** P7, M1/M2, S3, S4, D1, D2, and later factory flows must consume this same `AgentDefinitionDeclaration` or a lossless projection of it. Any temporary projection type (for example M1's `ManagedAgentVerticalConfig`) must be derived from this declaration and documented as temporary. **Amendment (2026-07-08):** S1 and S2 are relocated out of #391 active scope, but their future stories must still consume this definition or a lossless projection when they return.
- **Tests:** a declaration with two agents seeds two `AgentRegistry` entries + a resolvable default; absent declaration yields exactly one implicit `default` agent (single-agent parity); invalid declaration (duplicate `agentId`, missing `defaultAgentId` target, or unknown instruction/persona/capability/environment/sandbox/governance/model/demo/pricing/exposure ref) rejected with a stable code; **two agents referencing the same pool environment id both resolve to that id (shared), two referencing different ids resolve to distinct ids (isolated)**; an `environmentAttachments` ref to an id **absent from the `environments` pool** is rejected with a stable code; declared exposure config is preserved for M2 without hardcoding demo verticals; **grep-gate**: the declaration module has zero child-app fields.
- **Acceptance:** the workspace `agents: [...]` declaration + default-agent composition exists and seeds the `AgentRegistry`; single-agent workspaces are unchanged; Phase 7 can resolve `agentId` against it; M1/M2/S1/S2/S3/S4/D1 can consume the same definition or a lossless projection. **P6a grep-gate (blocking):** `! rg -n "childAppId|workspaceKind|ChildApp" packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` exits 0, and `! rg -n "@hachej/boring-workspace" packages/agent/src/shared/agents/agentDefinitionDeclaration.ts` exits 0 (agent-owned, workspace-free).

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

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) P6 rows exactly:

### P6a
- `pr1-agent-registry` → BBP6-003.
- `pr2-agents-declaration` → BBP6-009.
- `pr3-manifest-requires-bash-skill-filters` → BBP6-002.
- `pr4-runtime-plugin-context` → BBP6-004.
- `pr5-hosted-fail-closed` → BBP6-005.
- `pr6-shared-workspace-runtime` → BBP6-007.
- `pr7-multitenant-reload` → BBP6-008.

### P6b follow-up
- `pr8-childapp-context` → BBP6-001, HARD BLOCKED until #376 exports the shared resolved context type.
- `pr9-macro-scoping` → BBP6-006, HARD BLOCKED until BBP6-001 can consume that type.

## Review gates

- **P6a/P6b split (blocking):** P5 precondition confirmed for **P6a** (or STOP+report). The shared child-app platform code export (expected `ResolvedChildAppContext`, #376) is a **HARD prerequisite for P6b** (BBP6-001, BBP6-006): if absent, those **STOP-and-report with no local fallback shape**. **P6a** (BBP6-002 manifest validation, BBP6-003 `AgentRegistry`, BBP6-009 `AgentDefinitionDeclaration`, BBP6-004 plugin runtime context, plus BBP6-005/007/008) proceeds independently. **P6a grep-gate (blocking):** each named P6a contract contains ZERO child-app fields/types — `! rg -n "childAppId|workspaceKind|ChildApp"` on each created file (manifest validator, `AgentRegistry.ts`, `agentDefinitionDeclaration.ts`, `runtimePluginContext.ts`) exits 0.
- No competing child-app registry / manifest scanner / plugin route family introduced.
- `pnpm lint:invariants` + `pnpm audit:imports` + `lint:plugin-invariants` green; zero agent→bash value imports.
- Import-free manifest validation proven (side-effecting plugin fixture not executed).
- Hosted plugin fail-closed covered; iframe sandbox/CSP constraints asserted.
- Secrets are status-only in every plugin/browser/model context (P5 brokering); no raw values in manifests/logs/transcripts/artifacts.
- `/api/v1/plugins/:pluginId/*` dispatch unchanged; `AgentRegistry` minimal and Map-backed (no framework creep).
- Full-app reload resolves per workspace/agent/plugin runtime; trusted server routes diagnosed not hot-registered.
- EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.
