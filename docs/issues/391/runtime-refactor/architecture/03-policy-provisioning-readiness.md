# 03 — Policy, provisioning, readiness

> **Binding owner-order supersession (2026-07-11).** P5a is conditional support
> discovered by D1-R0, not a P6-R or D1 prerequisite. Add only an exact missing
> host-readiness or secret-reference seam; zero P5a code is valid. P2 provider
> extraction/runsc proof and X1 mounts merge last. The authority algebra below
> remains binding, but runsc-first/P5a-v1 statements are non-dispatchable where
> they conflict with [`INDEX.md`](../INDEX.md).

> **Workspace-first v1 scope (2026-07-10).** The authority algebra below remains
> binding. Historical P5a scope described D1-consumed runsc readiness/health,
> authenticated worker facts, redacted fingerprinting, secret brokerage, and
> non-dev fail-closed configuration. The generic `BashRequirement` normalizer,
> provisioning-engine relocation, P3/E1 dependency, services, SDKs, and remote
> mounts below are post-v1 design and non-dispatchable until a named consumer
> re-specifies them.

## Goal

Make bash/files/service capabilities declarative, scoped, and readiness-gated without replacing the provisioning system that already exists.

## Authority and requirements

Authority, grants, and requirements are different inputs. Requirements never
grant or narrow authority:

```txt
maximumAuthority = providerFacts
                 ∩ hostPolicy
                 ∩ tenantOrWorkspacePolicy
                 ∩ agentDeploymentPolicy

activeAuthority  = maximumAuthority
                 ∩ approvedGrantSet
                 ∩ subagentOrSessionScope

resolution       = validate(agent/plugin/tool requirements, activeAuthority)
```

Unknown provider facts fail validation. Grants are authenticated, scoped, and
cannot exceed `maximumAuthority`. A missing optional requirement yields a
diagnostic and omission; a missing required requirement makes the resolved
agent unready. Requirements are never included as an operand in the authority
intersection.

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

`BashSandboxPolicy.provider` is a requested policy input. Capability validation
that depends on the concrete sandbox provider, including the BBP6-009
provider-`runtimeImage` support check, must use the resolved provider id:
boring-bash `resolveMode(mode)` -> `MODE_TO_PROVIDER` -> boring-sandbox
`PROVIDER_CAPABILITIES[providerId]`.

Child app and workspace kind are first-class because of #376: Macro and generic Seneca can share deployment/auth/DB while having different default tools/prompts/provisioning.

## Requirement shape

```ts
interface BashRequirement {
  id: string
  source: 'agent' | 'plugin' | 'app' | 'child-app' | 'workspace-kind' | 'workspace' | 'subagent' | 'session'
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

The `Bash*` names above are bash-side source requirement shapes. Normalized
runner contracts (`ProvisioningHealthCheckSpec` and later SDK/service specs)
remain boring-bash/server-owned with `NormalizedProvisioningPlan`. Host
composition executes them and sends methodless readiness facts to agent. Agent
code never imports a `Bash*` shape or operational runner.

## Extend existing provisioning

Do **not** create a parallel provisioning engine.

Package ownership:

- host/core/CLI composition owns orchestration, cancellation, and prepared
  resource lifetime.
- `@hachej/boring-bash/shared` owns declarative `BashRequirement` data;
  `@hachej/boring-bash/server` owns normalization, the extracted existing
  provisioning engine/types/fingerprints/health runner, and later SDK/service
  environment runners. BBP5-002 moves the current agent implementation,
  migrates importers, and removes the origin atomically.
- `@hachej/boring-sandbox` owns the concrete provider adapters and the authoritative `ProviderCapabilities` facts/matrix.
- `@hachej/boring-agent` receives only methodless readiness/capability facts;
  it owns no operational provisioning runner and value-imports no
  boring-bash/sandbox implementation.

Current seams to move and extend without reimplementation:

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

It collects app, child-app, workspace-kind, workspace, agent, plugin, and
session requirements, validates them against provider capabilities, and feeds
the existing function after BBP5-002 moves that function to boring-bash/server;
host composition remains the caller.

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

Secrets are names/grants, never raw values in plans or browser contexts. Align with 00 invariant 14 and the 08 trust boundary: **brokered secrets are host-side handles that live on the trusted core side and are consumed only by trusted-core tools** (the tool uses the secret in host code); the raw value is never handed to the model or the sandbox.

Required contracts:

- host-owned secret store/status API;
- browser/plugin sees only status: missing, granted, denied, expired;
- model sees only names and availability unless a typed tool deliberately uses the brokered secret in host code;
- **brokered secrets never enter any sandboxed environment, full stop**: there is no raw-env exposure path into a sandbox; the `direct` provider is not a sandbox (a host process running as the developer with their own ambient environment), so nothing is "injected" there either — the distinction is sandbox vs. host process, not an exception clause;
- secrets never get written into provisioning plan files or logs, and never enter the model transcript.

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
- runtime image support (`runtimeImage`) when an agent/provider-default selected
  a runtime image.

If a policy requires a hardening property that the worker cannot prove, fail
closed. BBP6-009b consumes BBP5-008's handshake result to validate the
P6a-stashed `SelectedRuntimeImage` after the handshake; it reuses the existing
`SANDBOX_PROVIDER_*` fail-closed codes.

## Two-phase sandbox lifecycle

Adopt eve’s useful split while preserving existing Vercel packaging/snapshot code:

- **template/bootstrap phase**: install common deps, seed template files, create provider snapshot;
- **session/onSession phase**: apply session grants, env, services, per-session readiness.

Fingerprint keys should include:

- provider;
- resolved runtime image ref + digest, from `runtimeProfileRef` when present
  else the validated provider-default image;
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
