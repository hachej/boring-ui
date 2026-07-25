> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-05 — Plugins, child apps, hosted runtime

## Purpose

Safely connect boring-bash requirements to plugins and child apps, especially Macro hosted inside full-app, without redefining the shared child-app platform plan.

This TODO is the bridge between three existing/desired systems:

- the existing `@hachej/boring-workspace` plugin model, where trusted app/internal plugins may contribute routes, tools, prompts, Pi resources, and provisioning at boot;
- hosted external plugin mode, where untrusted/remote-safe plugin UI runs in constrained iframes and must fail closed for backend/bash/secrets;
- the shared child-app platform (#376), where one full-app deployment hosts multiple product surfaces such as generic Seneca and Macro, selected by hostname/workspace kind, with isolated prompts/tools/provisioning.

Non-negotiables for this file:

- Do not define a competing `ChildAppDefinition`, workspace-kind schema, billing model, or host registry. Consume resolved child-app context from `docs/plans/shared-child-app-platform.md`.
- Do not create a parallel plugin manifest scanner. Extend the existing plugin manifest reader and trust tiers.
- Do not add a competing runtime plugin route family. Preserve `/api/v1/plugins/:pluginId/*`.
- Do not leak Macro tools/prompts/provisioning into generic workspaces.
- Do not leak raw secrets to browser plugins, model prompts, logs, issue comments, or provisioning artifacts.
- Hosted/untrusted plugin mode remains deliberately constrained unless host policy promotes a plugin to a trusted tier.

## Beads / tasks

### BBA-050 — Consume resolved child-app context

**Depends on:** BBA-041 and the shared child-app platform plan (#376).

**Why:** Macro hosted inside full-app needs child-app/workspace-kind scoping, but this boring-bash plan must not own the product registry, billing, hostname resolution, or workspace-kind schema. It should consume the resolved context and intersect it with plugin/agent/bash requirements.

**Scope:**

- Consume, but do not define, resolved child-app context from core/app composition:
  - `childAppId` (for example `seneca` or `macro`);
  - `workspaceKind` (for example `generic` or `macro`);
  - resolved default agent set from the child-app platform;
  - resolved default/trusted plugin ids/packages;
  - resolved prompt/system-prompt contributions;
  - resolved bash/provisioning requirements;
  - resolved frontend shell/branding only as metadata for diagnostics, not as boring-bash ownership;
  - billing/product context only as core-owned metadata for smoke/proof logs, never as boring-bash logic.
- Apply the effective policy stack: app defaults < resolved childApp/workspaceKind policy < workspace policy < agent policy < session/user grants < plugin/tool requirements.
- Ensure Macro requirements are scoped only to Macro workspaces.
- Ensure generic Seneca workspaces do not see Macro prompts/tools/provisioning/default panels.
- Preserve the child-app plan’s non-goal: trusted Macro domain routes such as `/api/macro/*` may remain trusted app/internal plugin APIs and do not need to be replaced by generic RPC for purity.

**Unit/integration tests:**

- Generic workspace does not see Macro tools, prompts, provisioning contributions, default plugins, or Macro-specific panels.
- Macro workspace sees Macro defaults and requirements.
- Child-app policy narrows but never widens workspace max policy.
- Billing/product context is passed through diagnostics/proof only and is not consumed by boring-bash.
- A missing or unknown `childAppId`/`workspaceKind` produces a stable diagnostic/error and does not silently fall back to Macro behavior.

**E2E/smoke logging:**

- Smoke resolves a generic host and a Macro host.
- Logs: request host, workspace id, `childAppId`, `workspaceKind`, resolved plugin ids, resolved agent ids, resolved bash requirement ids, policy decision, and billing product id/name if provided by core.
- Logs must not include secrets, raw env values, or credentials.

**Acceptance:** The boring-bash/runtime layer can consume child-app context and scope requirements without owning or duplicating the child-app platform.

### BBA-051 — Extend existing plugin manifest validation import-free

**Depends on:** BBA-040.

**Why:** Plugins must be able to declare boring-bash needs before host code imports or executes plugin modules. This protects hosted/remote modes and prevents malicious or accidental code execution during capability validation.

**Scope:**

- Extend the existing plugin manifest reader; do not create a second manifest scanner or second plugin id system.
- Validate these fields before executing plugin code:
  - existing `boring.front` / hosted iframe manifest fields;
  - existing trusted `boring.server` shape;
  - new `boring.requires` entries such as `boring-bash`;
  - new `bash.capabilities` such as readonly fs, readwrite fs, exec, services, secrets;
  - new `bash` provisioning fields such as node packages, Python specs, template dirs, SDK archives, env/path entries, and managed services.
- Keep plugin id derived from the existing plugin package identity rules; do not add `boring.id`.
- Validate safe relative paths and containment for any manifest file references.
- Reject raw secret values in manifest; allow secret names/grant refs only.
- Preserve hosted iframe manifest fields and current local/trusted plugin behavior.
- Surface stable diagnostics for invalid fields, unsupported requirements, trust-tier mismatch, missing boring-bash, and optional requirement degradation.

**Unit tests:**

- Manifest requiring bash is skipped/diagnosed when bash is disabled.
- Invalid `bash` block rejected before importing plugin code.
- Fixture with side-effecting `boring.server`/`boring.front` proves validation happens import-free.
- Existing trusted plugins still load.
- Hosted iframe fields still validate.
- Raw secret value in manifest is rejected with stable error code.
- Optional requirement failure degrades with diagnostic instead of blocking unrelated plugin features.
- Plugin id derivation remains existing behavior; `boring.id` remains rejected if current spec rejects it.

**E2E/smoke logging:**

- Plugin validation smoke logs plugin id, source path, trust tier, manifest revision/signature, declared requirements, optional/required split, validation decision, diagnostic ids/error codes, and whether code import was avoided.
- Logs must include enough detail to debug why a plugin was skipped, without printing raw manifest secrets/env values.

**Acceptance:** Hosts can determine whether a plugin is allowed/ready without executing untrusted plugin code.

### BBA-052 — Preserve hosted external plugin safety

**Depends on:** BBA-051.

**Why:** Hosted external plugin mode intentionally loses local trusted powers for remote sandbox safety. The boring-bash abstraction must not accidentally re-open host route, backend, filesystem, or network powers to hosted iframe plugins.

**Scope:**

- Hosted remote mode fails closed for unsupported front/server/tool/bash/service/secret requirements.
- Preserve iframe safety constraints:
  - constrained iframe sandbox, normally `allow-scripts` only;
  - no `allow-same-origin`, forms, popups, or top navigation unless a future explicit policy says otherwise;
  - strict CSP, including no arbitrary network access by default;
  - bounded diagnostics bridge only, with messages such as ready/log/error;
  - manifest/document size limits;
  - safe relative entry validation;
  - no-follow file metadata checks for plugin assets where supported;
  - symlinks/special files rejected before read;
  - remote worker fails closed when required safe file metadata APIs are unavailable.
- Hosted plugin may declare readonly visibility/diagnostics requests only when host policy and provider capability allow it.
- Hosted plugin does not get `boring.server`, host routes, plugin-owned agent tools, runtime backend code, raw filesystem access, generic fetch proxy, or raw secrets.
- If a plugin needs backend code, bash, services, or secrets, it must be promoted to a trusted plugin tier by app/child-app policy.

**Unit tests:**

- Hosted plugin cannot request server route/tool/backend runtime.
- Hosted plugin with unsupported bash/service/secret requirement fails closed before code execution.
- Hosted plugin with readonly diagnostic requirement succeeds only when policy allows readonly fs.
- Iframe sandbox/CSP attributes match constraints.
- Diagnostic bridge enforces message size/type limits.
- Symlink/special file fixtures are rejected.
- Missing safe metadata support causes fail-closed behavior.

**E2E/smoke logging:**

- Hosted-plugin smoke logs plugin id, trust tier, source path, requested requirements, fail-closed decision, iframe sandbox mode, CSP summary, diagnostics count, and rejection error code.
- Logs must not include plugin source contents beyond bounded diagnostic snippets.

**Acceptance:** Remote-safe hosted plugin mode remains safer after boring-bash integration than local/trusted plugin mode, not accidentally equivalent to it.

### BBA-053 — Add runtime plugin context features

**Depends on:** BBA-051, BBA-043, BBA-044, BBA-045.

**Why:** Runtime plugin backends need to know which features are available without guessing from routes or probing unsafe capabilities. Context must be explicit and scoped by workspace, agent, child app, and trust tier.

**Scope:**

- Extend runtime plugin context for `/api/v1/plugins/:pluginId/*` dispatch. Do not add a competing route family.
- Context includes:
  - `pluginId`;
  - `workspaceId`;
  - `agentId` if request is agent-scoped;
  - `childAppId` and `workspaceKind` when resolved;
  - bash environment summary, if boring-bash is active;
  - UI bridge availability;
  - secret statuses only (`missing`, `granted`, `denied`, `expired`), never raw values;
  - managed service statuses (`not-started`, `starting`, `ready`, `failed`);
  - readiness diagnostic ids for unmet requirements.
- Preserve current runtime backend gateway semantics and hot reload behavior.
- Missing required feature produces clear diagnostic response; optional missing feature is visible but non-fatal.
- Context must be derived from resolved policy/readiness, not from plugin-controlled input.

**Unit tests:**

- Runtime backend receives feature context for trusted plugin.
- Missing required feature returns stable diagnostic and does not execute unsafe backend action.
- Secret context includes status only, no raw value.
- Service status is visible and updates with readiness.
- Existing runtime plugin RPC still works through `/api/v1/plugins/:pluginId/*`.
- Plugin cannot spoof `workspaceId`, `agentId`, `childAppId`, or feature availability through request params/body.

**E2E/smoke logging:**

- Runtime RPC smoke logs plugin id, workspace id, agent id, childAppId/workspaceKind, available feature keys, readiness states, response status, diagnostic ids, and reload generation.
- No raw secrets or credentials in logs.

**Acceptance:** Runtime plugin backends get enough context to degrade safely without route proliferation or unsafe probing.

### BBA-054 — Shared per-workspace plugin runtime compatibility (#254)

**Depends on:** BBA-053.

**Why:** Workspaces mode and full-app should not maintain divergent plugin runtime maps and route copies. Boring-bash plugin requirements should flow through one shared per-workspace runtime unit.

**Scope:**

- Compose with shared per-workspace plugin runtime unit:
  - asset manager;
  - backend registry;
  - reload;
  - Pi/plugin snapshots;
  - lifecycle bus/event stream;
  - dispose/eviction;
  - runtime backend gateway resolver.
- Avoid duplicate maps in CLI/full-app/workspace modes.
- Runtime backend gateway and plugin routes use resolver pattern for multi-tenant dispatch.
- Preserve plugin SSE/load/unload/error behavior and revision/signature cache busting.
- Handle workspace id semantics explicitly: HTTP registry id vs plugin source/workspace root path must not be confused.
- Ensure boring-bash requirement/readiness state participates in reload and runtime snapshots.

**Unit/integration tests:**

- CLI workspaces mode and full-app use the same runtime unit or a thin adapter over it.
- Plugin reload updates manifest, runtime context, Pi snapshot, and requirement readiness.
- Runtime backend registry closes/disposes on workspace eviction.
- SSE load/unload/error events remain correct after requirement validation changes.
- Workspace id/root translation tests prevent registry-id vs root-path confusion.

**E2E/smoke logging:**

- Shared-runtime smoke logs host mode, HTTP workspace id, workspace root hash, runtime cache key, plugin ids, backend registry status, reload generation, Pi snapshot generation, and readiness generation.

**Acceptance:** Adding boring-bash requirements does not make CLI/full-app/workspace plugin runtimes drift further apart.

### BBA-055 — Full-app reload/plugin runtime integration (#41)

**Depends on:** BBA-054.

**Why:** Production full-app currently needs per-request workspace/plugin/harness resolution for reload. The new runtime-free composition must keep `/reload` and plugin reload working in multi-tenant deployments.

**Scope:**

- Multi-tenant reload resolves per request:
  - workspace;
  - agent binding;
  - plugin runtime;
  - boring-bash requirement/readiness state;
  - beforeReload hook;
  - asset manager;
  - runtime backend registry;
  - Pi/plugin snapshots.
- `/api/v1/agent/reload` and `/reload` slash command/route work in full-app where enabled.
- Reload does not require boring-bash in pure/headless agents unless plugin requirements do.
- Reload diagnostics include manifest validation, requirement validation, provisioning readiness, and plugin import/runtime errors.
- Preserve behavior where trusted server plugin route/tool changes require restart/redeploy; reload diagnoses drift but does not hot-register unsafe server routes.

**Unit/integration tests:**

- Full-app reload route resolves per workspace.
- Missing/unauthorized workspace returns stable error.
- Plugin assets reload and runtime backend dispatch still work.
- Pure/headless agent reload works without boring-bash.
- Trusted server plugin backend changes are diagnosed, not hot-swapped unsafely.
- Reload surfaces requirement/provisioning errors without losing previous working UI where applicable.

**E2E/smoke logging:**

- Reload smoke logs request id, workspace id, agent id, childAppId/workspaceKind, plugin ids, asset revision, runtime backend generation, beforeReload duration, provisioning readiness state, diagnostic ids, and final reload decision.

**Acceptance:** Full-app users can reload plugins/runtime diagnostics in multi-tenant production paths without route 404s or silent slash-command failures.

### BBA-056 — Macro hosted inside full-app smoke

**Depends on:** BBA-050, BBA-053, BBA-055.

**Why:** Macro is the proving case for one deployed app hosting multiple product surfaces. This smoke must prove the abstraction supports the product goal without leaking Macro capabilities into generic Seneca workspaces.

**Scope:**

- Use resolved child-app context for Macro; do not hardcode Macro behavior in boring-bash.
- Exercise generic Seneca and Macro host/workspace resolution in the same deployed app/server composition.
- Verify Macro tools/prompts/provisioning/default panels visible only for Macro workspace kind.
- Verify generic Seneca and Macro share deployment/auth/DB/billing infrastructure but not runtime requirements.
- Verify Macro trusted domain routes remain valid app/internal plugin APIs where the child-app plan says they should.
- Verify boring-bash receives only resolved policy/requirements and never billing secrets or raw child-app registry internals.

**Unit/integration tests:**

- Macro context resolution fixture produces Macro plugin/prompt/provisioning requirements.
- Generic context fixture excludes Macro requirements.
- Macro trusted routes are present only in Macro context when registered by trusted plugin/app policy.
- Billing/product metadata is available to core smoke/proof but not to boring-bash provider logic.

**E2E/smoke logging:**

- Smoke hits generic and Macro hosts.
- Logs request host, childAppId, workspaceKind, workspace id, active plugin ids, agent ids, bash requirement ids, runtime provider, readiness states, Macro route availability, and billing product context without secrets.
- Logs assertion summary: no Macro leakage into generic workspace; Macro requirements ready or diagnosed; plugin/runtime gateway works.

**Acceptance:** Macro-in-full-app platform is supported by the abstraction without leaking capabilities, secrets, prompts, tools, or provisioning across child-app/workspace-kind boundaries.
