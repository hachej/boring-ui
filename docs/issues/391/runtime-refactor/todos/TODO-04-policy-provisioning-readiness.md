> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-04 — Policy, provisioning, readiness, secrets, services

## Purpose

Make runtime needs declarative and scoped while extending existing provisioning/readiness instead of building a parallel system.

This TODO file is self-contained for future beads. The core idea is:

```txt
@hachej/boring-bash owns requirement normalization + concrete provider adapters.
@hachej/boring-agent owns the existing provisioning engine over injected adapters.
host/core/CLI composition wires them together.
```

No task in this file may introduce a value import from `@hachej/boring-agent` to `@hachej/boring-bash`, leak raw secrets into logs/prompts/browser contexts, or create a second provisioning/readiness engine.

## Contract excerpts to embed in future beads

### Effective policy stack

Power is an intersection, never a union:

```txt
effective = backend capabilities
          ∩ app defaults
          ∩ resolved childApp/workspaceKind policy
          ∩ workspace max policy
          ∩ agent policy
          ∩ subagent policy
          ∩ session/user grants
          ∩ plugin/tool requirements
```

Resolution order:

```txt
app defaults < childApp/workspaceKind < workspace < agent < subagent < session/user grants < plugin/tool requirement
```

The resolver must reject impossible merges instead of silently widening access. Every denial should have a stable error code and enough diagnostic context for a user/admin to understand which policy layer blocked the request.

### BashSandboxPolicy

```ts
interface BashSandboxPolicy {
  provider: 'none' | 'direct' | 'bwrap' | 'vercel-sandbox' | 'remote-worker' | string
  volume: BashVolumeView
  exec?: {
    enabled: boolean
    rawBash?: boolean
    predefinedTools?: string[]
    commandPolicy?: BashCommandPolicy
    timeoutMs?: number
  }
  network?: 'disabled' | 'allowlisted' | 'allow-all'
  env?: Record<string, string>
  secrets?: string[] // names/grants only; never raw values
  services?: BashManagedServiceRequirement[]
  provision?: BashRequirement['provisioning']
}
```

### BashRequirement

```ts
interface BashRequirement {
  id: string
  source: 'app' | 'child-app' | 'workspace-kind' | 'workspace' | 'agent' | 'subagent' | 'plugin' | 'session'
  optional?: boolean
  capabilities?: {
    fs?: 'readonly' | 'readwrite'
    exec?: boolean
    servicePorts?: boolean
    secrets?: string[]
  }
  provisioning?: {
    templateDirs?: RuntimeTemplateContribution[]
    nodePackages?: RuntimeNodePackageSpec[]
    python?: RuntimePythonSpec[]
    sdkArchives?: BashSdkArchiveSpec[]
    env?: Record<string, string>
    pathEntries?: string[]
  }
  services?: BashManagedServiceRequirement[]
  readiness?: {
    timeoutMs?: number
    healthCheck?: BashHealthCheckSpec
  }
}
```

Requirement ids must be stable, human-readable, source-qualified where needed, and safe for logs/diagnostics. They must not contain raw secrets, host-private paths, or model-supplied arbitrary text.

### Readiness model to preserve

Current code has a two-tier model:

- aggregate `ReadyState`: `provisioning | ready | degraded`;
- per-capability `CapabilityState`: `not-started | preparing | ready | failed`;
- `CapabilityReadinessDetail` already carries `requirement`, `errorCode`, `causeCode`, `retryable`, `message`, `startedAt`, `completedAt`;
- `AgentCapabilityReadiness` is currently fixed to `chat`, `workspace`, and `runtimeDependencies`.

Future work must extend or wrap this model; it must not break existing readiness enum values or tool-gating contracts.

## Beads / tasks

### BBA-040 — Implement BashRequirement types and normalizer outside agent

**Depends on:** BBA-020, BBA-011, BBA-006.

**Why:** The platform needs one declarative shape for app/child-app/workspace/agent/plugin/session runtime needs, but the agent package must not import concrete bash code.

**Scope:**

- Define `BashRequirement` and supporting types in boring-bash/shared or a composition-owned type surface that does not pull server/provider values into shared/front code.
- Include source types: app, child-app, workspace-kind, workspace, agent, subagent, plugin, session.
- Implement an import-free normalizer that consumes manifest/config data without executing plugin/agent code.
- Normalizer lives in boring-bash/core composition, not agent.
- Normalizer outputs existing `ProvisionWorkspaceRuntimeOptions` plus sidecar metadata needed for diagnostics/readiness.
- Agent engine remains adapter-injected and does not import boring-bash.
- Preserve stable requirement ids, optional/required semantics, source attribution, and conflict metadata.
- Ensure no raw secrets or host-private paths are stored in normalized requirement records.

**Unit tests:**

- Import-direction test: agent has no value import from boring-bash normalizer/provider code.
- Requirement collection order test across app, child-app, workspace-kind, workspace, agent, subagent, session, plugin.
- Import-free manifest/config test proves plugin code is not executed while collecting requirements.
- Stable-id validation rejects unsafe ids and duplicate conflicting ids.
- Optional vs required metadata survives normalization.
- Output matches expected existing `ProvisionWorkspaceRuntimeOptions` for template dirs, node packages, Python packages, env, path entries, and source metadata.

**E2E/smoke logging:**

- Normalizer fixture smoke logs source layer, requirement id, optional flag, requested capabilities, and normalized contribution ids.
- Logs must redact host paths and prove no raw secret values are emitted.

**Acceptance:** Requirement normalization is reusable by core/full-app/CLI composition and cannot create an agent→bash package cycle.

### BBA-041 — Implement effective policy intersection

**Depends on:** BBA-040, BBA-021, BBA-006.

**Why:** Agents/plugins/child apps should only receive the intersection of allowed powers. A plugin or session grant must never silently widen workspace or child-app policy.

**Scope:**

- Implement the effective policy stack exactly as documented above.
- Validate requested fs/exec/network/secrets/services/provisioning capabilities against provider capabilities and workspace maximum policy.
- Reject impossible merges with stable error codes and actionable diagnostics.
- Never silently widen access.
- Include provider fallback policy: fallback only when allowed by policy and capability requirements; never silently downgrade isolation or functionality.
- Explain denials by policy layer (backend, app, child-app/workspace-kind, workspace, agent, subagent, session/user grant, plugin/tool requirement).
- Keep child-app/workspace-kind policy as a consumed resolved context from the shared child-app platform plan; do not define child-app registry here.

**Unit tests:**

- Child app narrows generic policy.
- Plugin cannot widen workspace policy.
- Session grant can approve only within workspace max.
- Subagent can narrow parent policy but cannot widen it without explicit approved grant.
- Impossible exec/fs/provider combinations fail with stable code.
- Provider fallback rejects less-isolated/lower-capability provider unless policy explicitly allows it.
- Denial diagnostics identify the blocking policy layer.

**E2E/smoke logging:**

- Policy smoke logs each policy layer, requested capability, effective decision, denial reason, workspace id, childAppId, agent id, plugin id, provider id, and stable error code.
- Logs must not include secret values or host-private paths.

**Acceptance:** Effective policy is deterministic, explainable, and cannot widen capability by accident.

### BBA-042 — Extend provisioning without duplicating engine

**Depends on:** BBA-040, BBA-041.

**Why:** Existing `provisionWorkspaceRuntime()` already handles contribution merge, fingerprint skip, and provider adapters. We should extend it rather than creating a parallel provisioning path.

**Scope:**

- Feed normalized requirements into `provisionWorkspaceRuntime()` through host/core/CLI composition.
- Preserve merge-by-id, conflict detection, fingerprint skip, `WorkspaceProvisioningResult.changed`, telemetry, and existing provisioning logger behavior.
- Add SDK archives, health checks, requirement source metadata, and readiness hints as compatible extensions.
- Preserve Vercel packaging/snapshot behavior.
- Preserve pack-artifact rules: local npm/Python packages and SDK archives enter the runtime as packed/copied artifacts, not ad-hoc host paths.
- Rewrite runtime env/path entries to sandbox-visible paths where needed.
- Keep current provisioning adapter mode constraints explicit; `none`, `readonly`, and `remote-worker` must either short-circuit or use widened adapter support from provider work.
- Ensure all provisioning failures produce stable codes and useful source requirement diagnostics.

**Unit tests:**

- Fingerprint skip still works.
- Conflict same id/different spec rejects with stable code.
- SDK archive does not leak host path.
- Env/path entries are rewritten to runtime-visible paths.
- Optional failed requirement does not block unrelated required contributions.
- Existing direct/local/vercel provisioning tests still pass.
- `none`/`readonly` short-circuit behavior does not call unsupported provisioning adapter paths.

**E2E/smoke logging:**

- Provision smoke logs requirement ids, source layers, fingerprint, changed/skipped, provider, elapsed, health result, generated path entries, and stable error code when failed.
- Logs must include enough detail to debug merge/fingerprint decisions without revealing secrets or host-private paths.

**Acceptance:** Existing provisioning behavior remains intact while new requirement metadata flows through the same engine.

### BBA-043 — Extend readiness using real two-tier model

**Depends on:** BBA-042, BBA-041.

**Why:** Tool/UI readiness must become per-requirement without breaking existing readiness SSE, tool gates, or current enum values.

**Scope:**

- Preserve aggregate `ReadyState`: provisioning/ready/degraded.
- Preserve per-capability `CapabilityState`: not-started/preparing/ready/failed.
- Reuse `CapabilityReadinessDetail` fields instead of inventing a parallel detail bag.
- Extend/wrap fixed `AgentCapabilityReadiness` so N requirement details can be reported without losing current `chat`, `workspace`, and `runtimeDependencies` fields.
- Optional failures are derived display state over `failed + optional=true`, not a new breaking enum value.
- Preserve existing readiness tags: `runtime-dependencies`, `runtime:<id>`, `workspace-fs`, `sandbox-exec`.
- Preserve `mergeTools({ checkReadiness })` semantics.
- Make readiness diagnostics useful for UI, plugin manager, and agent tool catalog.

**Unit tests:**

- Existing readyStatus tests pass.
- Existing tool readiness tags still gate tools.
- Optional failure does not block unrelated tool.
- Failed required requirement degrades or blocks only the correct tools/panels.
- Readiness SSE includes requirement detail without breaking old consumers.
- Retryable vs terminal failures are represented with existing `retryable`, `errorCode`, `causeCode`, and `message` fields.

**E2E/smoke logging:**

- Readiness smoke logs state transitions with timestamps, requirement ids, readiness tags, blocking tool names, retryable flag, and final aggregate state.

**Acceptance:** Existing readiness consumers keep working while per-requirement diagnostics become visible and actionable.

### BBA-044 — Implement secret status/grant model

**Depends on:** BBA-041.

**Why:** Plugins/agents need to know whether named secrets are available, but raw secret values must never leak into browser contexts, prompts, provisioning artifacts, issue comments, or logs.

**Scope:**

- Host-owned secret status API.
- Browser/plugin sees status only: missing/granted/denied/expired.
- Model sees names/availability only unless a typed host tool uses the secret internally.
- Shell env injection requires explicit policy, grant id, audit logging, and readiness dependency.
- Secret requirements participate in policy intersection and readiness diagnostics.
- Provisioning plans/fingerprints may include secret names/grant ids/status, never raw values.
- Health checks and managed services must not echo secret values into logs.

**Unit tests:**

- Secret status visible without value.
- Raw value never serialized to browser/plugin/model/readiness/provisioning artifacts/log payloads.
- Missing secret blocks only dependent requirement.
- Denied/expired grants produce stable error codes.
- Shell env injection requires explicit policy and grant.

**E2E/smoke logging:**

- Secret smoke logs secret name hash/id, status, grant id, dependent requirement id, and no raw value.
- Add a negative assertion that known fake secret values do not appear in captured logs/prompts/artifacts.

**Acceptance:** Secret availability is diagnosable without exposing secrets.

### BBA-045 — Implement managed service requirements

**Depends on:** BBA-042, BBA-043, BBA-044, BBA-041.

**Why:** Some trusted plugins need long-lived runtime processes, not one-shot shell commands. Examples include Remotion Studio, browser-use, local preview servers, and app-specific developer previews.

**Scope:**

- Define/implement managed service declarations with command, cwd, env, ports, purpose, health check, teardown, and secret grant references.
- Trusted plugins can request services only when policy allows service ports and exec.
- No public exposure without explicit port/proxy/iframe grant.
- Readiness gates dependent panels/tools until health passes.
- Teardown is deterministic: kill process tree or provider-specific cleanup.
- Services run inside the same selected source-of-truth/runtime view as file/bash operations.
- Service logs must be captured with truncation/redaction and linked to requirement ids.

**Unit tests:**

- Service starts, health passes, port grant surfaces.
- Health failure gates panel/tool with stable diagnostic.
- Teardown kills process tree or calls provider cleanup.
- Service cannot start when exec/servicePorts policy is denied.
- Service env never includes raw secrets unless explicit shell env grant exists.
- Port/iframe grant respects child-app/workspace/plugin policy.

**E2E/smoke logging:**

- Service smoke logs service id, requirement id, process id/provider handle id, port, purpose, health URL/result, readiness transition, teardown result, and redaction count.

**Acceptance:** Trusted plugin services are supervised, diagnosable, policy-gated, and cleanly torn down.

### BBA-046 — Remote-worker hardening handshake

**Depends on:** BBA-024, BBA-041.

**Why:** Remote-worker is only safe if the worker can prove the isolation/network/filesystem properties that policy requires.

**Scope:**

- Handshake reports gVisor/seccomp, per-workspace network isolation, metadata/private CIDR egress policy, cross-workspace boundary, filesystem persistence model, real bash/binaries, provider version, and supported provisioning mode.
- Policy requiring missing or unverifiable hardening fails closed.
- Handshake claims are included in provider capability validation and readiness diagnostics.
- Partial/forged/malformed handshakes produce stable errors.
- Diagnostics must distinguish "provider unavailable" from "provider available but insufficiently hardened".

**Unit tests:**

- Mock worker claims/denies capabilities.
- Required gVisor/network isolation missing rejects.
- Partial or malformed handshake rejects with stable code.
- Handshake info appears in diagnostics and policy logs.
- Provider cannot silently downgrade to direct/local behavior.

**E2E/smoke logging:**

- Worker smoke logs worker version, isolation claims, policy decision, failure reason if blocked, workspace id, agent id, provider id, and network-hardening result.

**Acceptance:** Remote-worker capabilities are explicit, verified, and fail closed when they do not satisfy policy.

### BBA-047 — Add two-phase sandbox lifecycle and fingerprint key composition

**Depends on:** BBA-042, BBA-043, BBA-044, BBA-045.

**Why:** Provisioning must distinguish reusable template/bootstrap work from per-session grants/services/readiness. Otherwise durable sessions can resume against the wrong file/service state or rebuild expensive templates unnecessarily.

**Scope:**

- Split provisioning/runtime setup into template/bootstrap phase and session/onSession phase where providers support it.
- Preserve existing single-phase paths while adding no-regression tests for Vercel snapshot/fingerprint skip.
- Fingerprint keys include provider, workspace id, childAppId/workspaceKind, agent id, requirement ids, seed content hash, source graph hash, provider contract version, and revalidation key.
- Fingerprints may include secret names/grant ids/status but never raw secret values.
- Session/onSession applies session grants, env, managed services, and per-session readiness without rebuilding stable templates unnecessarily.
- Different child apps/agents with different requirements must not reuse incompatible templates.
- On recovery/resume, stale or missing provider state must be surfaced explicitly instead of silently pretending file/service state is durable.

**Unit tests:**

- Same fingerprint skips provisioning.
- Changed requirement id/content/source graph/provider contract re-provisions.
- Different agent/child app requirements do not share incompatible snapshot.
- Secret value changes do not leak into fingerprint/logs; grant/status changes affect per-session readiness appropriately.
- Session/onSession can rerun without rebuilding template.
- Existing Vercel packaging/snapshot tests still pass.

**E2E/smoke logging:**

- Provision smoke logs phase (`bootstrap`/`onSession`), fingerprint inputs, changed/skipped, template/snapshot id, session id, requirement ids, service ids, readiness result, and recovery/resume decision.

**Acceptance:** Template reuse is safe, observable, and scoped by the same policy/provisioning facts that determine runtime powers.
