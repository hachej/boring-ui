# 03 — Policy, provisioning, readiness

## Goal

Make bash/files/service capabilities declarative, scoped, and readiness-gated without replacing the provisioning system that already exists.

## Effective policy stack

Power is an intersection, not a union:

```txt
effective = backend capabilities
          ∩ app defaults
          ∩ childApp/workspaceKind policy
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

The resolver rejects impossible merges instead of silently widening access.

## Policy inputs

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
  secrets?: string[]
  services?: BashManagedServiceRequirement[]
  provision?: BashRequirement['provisioning']
}
```

Child app and workspace kind are first-class because of #376: Macro and generic Seneca can share deployment/auth/DB while having different default tools/prompts/provisioning.

## Requirement shape

```ts
interface BashRequirement {
  id: string
  source: 'agent' | 'plugin' | 'app' | 'child-app' | 'workspace-kind'
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

## Extend existing provisioning

Do **not** create a parallel provisioning engine.

Package ownership:

- `@hachej/boring-agent` keeps the provisioning engine/types/orchestration (`provisionWorkspaceRuntime()`, `ProvisionWorkspaceRuntimeOptions`) over injected adapters.
- `@hachej/boring-bash` owns `BashRequirement`, requirement normalization, provider capability validation, and concrete provisioning adapters.
- host/core/CLI composition calls the boring-bash normalizer, then passes normalized `ProvisionWorkspaceRuntimeOptions` into the agent-owned engine.
- agent must not value-import boring-bash normalizers/providers.

Current seams to extend:

- `provisionWorkspaceRuntime()`;
- `ProvisionWorkspaceRuntimeOptions`;
- `RuntimeProvisioningContribution`;
- merge-by-`id`;
- fingerprint skip / `WorkspaceProvisioningResult.changed`;
- existing per-binding `RuntimeDependencyReadiness`;
- `ReadyStatusTracker`;
- `mergeTools({ checkReadiness })`.

Add a thin normalizer in boring-bash/core composition:

```ts
resolveBashProvisioningRequirements(input) -> ProvisionWorkspaceRuntimeOptions
```

It collects app, child-app, workspace-kind, workspace, agent, plugin, and session requirements, validates them against provider capabilities, and feeds the existing provisioning function via host composition.

## Readiness model

Use the real current two-tier model:

- aggregate `ReadyState`: `provisioning | ready | degraded`;
- per-capability `CapabilityState`: `not-started | preparing | ready | failed`;
- `CapabilityReadinessDetail` already carries `requirement`, `errorCode`, `causeCode`, `retryable`, `message`, `startedAt`, `completedAt`;
- `AgentCapabilityReadiness` is currently fixed to `chat`, `workspace`, and `runtimeDependencies`.

Extension target:

- keep aggregate `ReadyState` unchanged;
- extend or wrap `AgentCapabilityReadiness` so N bash requirements can be reported without losing current `chat/workspace/runtimeDependencies` fields;
- reuse `CapabilityReadinessDetail` instead of inventing a parallel metadata bag;
- represent optional failures as a derived/display concept over `CapabilityState='failed'` + `optional=true`, not a breaking enum value.

Existing readiness tags must continue to work:

- `runtime-dependencies`
- `runtime:<id>`
- `workspace-fs`
- `sandbox-exec`

## Secrets (#181)

Secrets are names/grants, never raw values in plans or browser contexts.

Required contracts:

- host-owned secret store/status API;
- browser/plugin sees only status: missing, granted, denied, expired;
- model sees only names and availability unless a typed tool deliberately uses the secret in host code;
- shell env injection requires explicit policy and audit logging;
- secrets never get written into provisioning plan files or logs.

## Managed services (#328, #258)

Some plugins need long-lived processes, not one-shot `bash`:

```ts
interface BashManagedServiceRequirement {
  id: string
  command: string | string[]
  cwd?: string
  ports?: Array<{ port: number; purpose: 'iframe' | 'api' | 'preview'; public?: boolean }>
  healthCheck?: BashHealthCheckSpec
  teardown?: 'kill-process-tree' | 'provider-default'
}
```

Use cases: Remotion Studio, browser-use, local preview servers.

Requirements:

- explicit trusted plugin/service requirement;
- process supervision;
- health check;
- port proxy/iframe grants;
- teardown;
- no automatic exposure to public internet;
- readiness gates before tools/panels activate.

## Remote-worker hardening (#307)

`remote-worker` must report its actual isolation capabilities in handshake:

- gVisor/seccomp status;
- per-workspace network namespace/firewall;
- metadata/private CIDR egress policy;
- same-host cross-workspace boundary;
- filesystem persistence model;
- real bash/binaries availability.

If a policy requires a hardening property that the worker cannot prove, fail closed.

## Two-phase sandbox lifecycle

Adopt eve’s useful split while preserving existing Vercel packaging/snapshot code:

- **template/bootstrap phase**: install common deps, seed template files, create provider snapshot;
- **session/onSession phase**: apply session grants, env, services, per-session readiness.

Fingerprint keys should include:

- provider;
- workspace/child-app/agent ids;
- requirement ids;
- seed content hash;
- source graph hash;
- provider contract version;
- revalidation key.

## Tests

- requirements merge by id;
- conflict rejection;
- optional requirement failure does not block unrelated tools;
- capability-vs-provider validation;
- existing readiness state compatibility;
- health check gating;
- secret status without raw value exposure;
- service start/health/port/teardown;
- remote-worker handshake fail-closed;
- child-app/workspace-kind policy narrows but never widens;
- Vercel pack-artifact rules still prevent host path leakage.
