# TODO-P5 — Extend provisioning, readiness, secrets, services (bash track)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- `docs/issues/391/runtime-refactor/architecture/03-policy-provisioning-readiness.md` — requirement shape, "Extend existing provisioning" ownership rules, readiness model, secrets, managed services, remote-worker hardening, two-phase lifecycle, fingerprint key composition.
- `docs/issues/391/runtime-refactor/INDEX.md` — Phase 5 deliverables/exit; the v2 delta: **credential brokering rule** — brokered secrets are host-side handles consumed only by trusted-core tools and **never enter any sandboxed environment** or the model transcript; exit adds "no test can read a brokered secret from inside the sandbox".
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — invariant 6 (no silent widening), 14 (secrets brokered at the environment boundary, never in sandbox process or transcript), 15 (EU-sovereign defaults). Provisioning-ownership rule: engine + `ProvisionWorkspaceRuntimeOptions` stay agent-side over an injected adapter; boring-bash owns requirement normalization; boring-sandbox owns concrete provider adapters + capability facts.
- `docs/issues/391/runtime-refactor/INDEX.md` — dispatch protocol; **Simplicity & no-compat policy (binding)**: migrate every importer in-PR, no shims, no deprecated aliases, no abstraction without two consumers, `// TODO(remove:<bead-id>)` + deletion bead for any transitional code.
- The v1 provisioning coverage (BBA-040..047) is **superseded and non-canonical** here — every compatibility-export/shim/deprecation-window instruction is stripped. The brokering model below **replaces** the v1 "shell env injection requires explicit policy" phrasing: brokered secrets are host-side handles consumed by trusted-core tools and **never enter any sandboxed environment, full stop**. The `direct` provider is not a sandbox — it is a host process running as the developer with their own ambient environment — so nothing is "injected" there; there is no brokered-secret env-injection path in any provider.

### Dependencies

- **P3** complete (routes/tools moved to boring-bash; the host composes the plain bash bundle) — the hard prerequisite. Phase 5 does **not** gate on P4: P4-specific file-UI consumers are optional downstream integration, not a prerequisite. In linear ordering Phase 5 is still the last bash-track phase, but its dependency is P3 (parallel to P4), matching `README.md` and `../../INDEX.md`.
- **P2** `@hachej/boring-sandbox/providers` plus `ProviderCapabilities` / `providerMatrix` exported from `@hachej/boring-sandbox/shared` exist. The concrete post-P2 source file is `packages/boring-sandbox/src/shared/providerMatrix.ts` (P2 `BBP2-002`), not `providers/matrix.ts`. The normalizer validates requirements against those facts. The concrete providers live in `@hachej/boring-sandbox` (00 open decision 3 RESOLVED; 08 decision 11), not `boring-bash/providers`; `resolveMode` lives in `@hachej/boring-bash/modes`. If the boring-sandbox providers or shared provider matrix are absent, STOP and report — do not fork a second capability model.

### Already landed (do not redo, build on it)

Provisioning engine (agent-owned, keep here — do not move to boring-bash):

- `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts` — `provisionWorkspaceRuntime()`; phases layout → skills → workspace-files → node → python; merges `nodePackages`/`python` from `opts.plugins[].provisioning`; returns `WorkspaceProvisioningResult { changed, env, pathEntries, skillPaths }`; telemetry `agent.runtime.provisioning.*`.
- `packages/agent/src/server/workspace/provisioning/types.ts` — `ProvisionWorkspaceRuntimeOptions` (`plugins: [{ id, skills?, provisioning? }]`, `adapter: WorkspaceProvisioningAdapter`, `runtimeLayout`, `logger`, `telemetry`, `telemetryContext`), `RuntimeProvisioningContribution` (`templateDirs`/`python`/`nodePackages`), `WorkspaceProvisioningAdapter.mode: 'direct'|'local'|'vercel-sandbox'` with `exec`/`resolveInstallSource`/`workspaceFs`/`getRuntimeCacheRoot`.
- `packages/agent/src/server/workspace/provisioning/fingerprint.ts` — `createRuntimeFingerprint`/`createNodeRuntimeFingerprint`/`createPythonRuntimeFingerprint`, `stableStringify`, `isValidFingerprint` (`sha256:<64hex>`), `shouldInstallRuntime`, atomic `writeFingerprint`.
- `packages/agent/src/server/workspace/provisioning/packArtifact.ts` — `provisioningArtifactName(kind, id, fingerprint)`, per-mode packer seam (pack-to-artifact; no host-path leakage). SDK archives build on this.
- Readiness: `packages/agent/src/server/runtime/readyStatus.ts` — `ReadyState = 'provisioning'|'ready'|'degraded'`, `CapabilityState = 'not-started'|'preparing'|'ready'|'failed'`, `CapabilityReadinessDetail` (`state`, `requirement`, `startedAt`, `completedAt`, `errorCode`, `causeCode`, `retryable`, `message`), `AgentCapabilityReadiness { chat, workspace, runtimeDependencies }` (fixed keys), `ReadyStatusTracker` (`updateCapability`, `updateRuntimeDependencies`, `markSandboxReady`, `markHarnessReady`, `markDegraded`, subscribe/emit). `RuntimeDependencyReadiness` used in `registerAgentRoutes.ts` (~line 496); `ToolReadinessRequirement` in `packages/agent/src/server/../shared/tool`.
- Readiness tags already understood by the front: `packages/agent/src/front/runtimeReadinessStatus.ts` (`runtime-dependencies`, `runtime:<id>`), `packages/agent/src/front/workspaceReadinessStatus.ts` (`workspace-fs`, `sandbox-exec`), `packages/agent/src/front/chat/chatPanelWorkspaceWarmup.ts`.
- Provisioning seam callers (the migration set): `packages/agent/src/server/registerAgentRoutes.ts` (`provisionRuntime?` option, ~lines 318–478; builds `runtimeLayout`, calls `modeAdapter.createProvisioningAdapter()`, forwards to host `provisionRuntime`); host callers `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` (~line 908 `provisionRuntime:`), `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` (~line 792 `provisionWorkspaceRuntime(`), `packages/cli/src/server/modeApps.ts` (~line 138 direct call, ~line 689 `provisionRuntime:`).
- Remote-worker provider: `packages/agent/src/server/sandbox/remote-worker/createRemoteWorkerSandbox.ts` (today: `capabilities: ['exec']` hardcoded, `init()` only calls `client.health()` — **no real handshake**), `protocol.ts`, `workerClient.ts`; mode adapter `runtime/modes/remote-worker.ts`; app-owned worker server `apps/full-app/src/server/worker/*`. (Post-P2 the provider/client/protocol live under `@hachej/boring-sandbox/providers/remote-worker/*` + `@hachej/boring-sandbox/shared/remoteWorkerProtocol.ts`, and the mode adapter under `@hachej/boring-bash/modes/remote-worker.ts` — target whichever the P2 branch produced; confirm before editing.)
- No P5-specific secret status/grant, managed-service, or SDK-archive model exists yet (`! rg -n "SecretStatus|SecretGrant|ManagedService|SdkArchive|SDKArchive" packages/agent/src packages/boring-bash/src` exits 0 today). The current repo **does** already have the pre-P5 cached binding health-check surface (`RuntimeCachedBindingHealthCheck` in `packages/agent/src/server/runtime/mode.ts`, consumed in `registerAgentRoutes.ts`); BBP5-008 adds the remote-worker capability handshake/policy validation and must extend/consume that reality rather than claiming no health-check surface exists.

## Goal / exit criteria

Runtime needs are declarative, scoped, readiness-gated, and secret-safe, **extending** the existing engine — no parallel provisioning path, no agent→bash value import. Exit (from `../../INDEX.md` Phase 5 = v1 exit in `../../architecture/03-policy-provisioning-readiness.md` "Tests", plus the v2 brokering criterion), each checkable:

- [ ] requirements merge by id; same id / conflicting spec rejects with a stable error code.
- [ ] optional requirement failure does not block unrelated tools/contributions; it surfaces as a derived `optional_failed` display state over `CapabilityState='failed'` + `optional=true` (no new breaking enum value).
- [ ] capability-vs-provider validation rejects impossible fs/exec/service/secret asks against `ProviderCapabilities` from `@hachej/boring-sandbox/shared` (P2 `providerMatrix`).
- [ ] existing readiness state compatible: `chat`/`workspace`/`runtimeDependencies` fields intact; readiness tags `runtime-dependencies`, `runtime:<id>`, `workspace-fs`, `sandbox-exec` still gate tools; existing `readyStatus` tests pass.
- [ ] health check gates dependent tools/panels until it passes.
- [ ] secret status is diagnosable (`missing`/`granted`/`denied`/`expired`) with no raw value exposure anywhere (browser/plugin/model/log/provisioning artifact/fingerprint).
- [ ] managed service starts, health-checks, exposes ports only under grant, and tears down deterministically.
- [ ] remote-worker handshake reports its capability matrix; consumers fail closed on `unknown`/unverifiable hardening.
- [ ] two-phase bootstrap/onSession: same fingerprint skips; changed requirement/source/contract re-provisions; onSession reruns without rebuilding a stable template; existing Vercel snapshot/fingerprint tests pass.
- [ ] **v2 brokering:** no test can read a brokered secret from inside the sandbox (see BBP5-007).
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

## Non-negotiables

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash` (`packages/boring-bash/scripts/check-invariants.mjs`). The normalizer + `BashRequirement` shape live in boring-bash; the engine stays agent-side; the host wires them. boring-bash imports agent provisioning **types type-only**.
- Extend the existing engine/readiness/fingerprint. **Do not** create a second provisioning or readiness engine.
- Secrets are **host-side handles**, resolved and used only by trusted-core code (host tools, provider adapters). The model/browser/plugin sees status only. Raw secret values never enter `WorkspaceProvisioningResult.env`, provisioning plan files, fingerprints, logs, or the transcript.
- **Brokered secrets never enter any sandboxed environment, full stop** (00 invariant 14). There is no sandbox process-env injection path for a brokered secret. The `direct` provider is not a sandbox — it is a host process running as the developer with their own ambient environment — so nothing is "injected" there either; the distinction is sandbox vs. host process, not an injection exception.
- Remote-worker capabilities are **reported facts**, typed `reported | unknown`; consumers fail closed on `unknown` (never assume a hardening property the worker did not prove).
- No compat shims, no deprecated aliases, no old-path re-exports. Migrate every caller of the changed provisioning seam in the same PR.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do not move the provisioning engine into boring-bash (00 ownership rule).
- Do not re-shape the landed #416 `packages/boring-bash/src/shared` contracts or server projection ops.
- Do not add a US-hosted provider as a default (invariant 15); vercel-sandbox stays an optional provider behind the capability matrix.
- Do not widen the `WorkspaceProvisioningAdapter.mode` union to smuggle `none`/`readonly`/`remote-worker` into provisioning — short-circuit them (they have no runtime deps to install).

## Beads

### BBP5-001 — `BashRequirement` shape + import-free normalizer in boring-bash [size L]

- **Files create/touch:** `packages/agent/src/server/workspace/provisioning/types.ts` (extend the agent-owned provisioning contracts with normalized runner inputs: `ProvisioningHealthCheckSpec`, `ProvisioningSdkArchiveSpec`, `ProvisioningManagedServiceRequirement`, and their sub-types). `packages/boring-bash/src/shared/bashRequirement.ts` (front-safe source requirement shape — no `node:*`/`Buffer`; owns the app/plugin-facing `BashRequirement` input only, not the agent runner contracts). `packages/boring-bash/src/server/provisioning/resolveBashProvisioningRequirements.ts` (the normalizer; server-scoped, may use `node:*`); `packages/boring-bash/src/server/provisioning/__tests__/resolveBashProvisioningRequirements.test.ts`.
- **Files touch:** `packages/boring-bash/src/shared/index.ts` (export `BashRequirement` + sub-types); `packages/boring-bash/src/server/index.ts` (export normalizer); `packages/boring-bash/scripts/check-invariants.mjs` (shared stays `node:*`-free).
- **Notes:** Define `BashRequirement` per `../../architecture/03-policy-provisioning-readiness.md` "Requirement shape" (`id`, `source: 'agent'|'plugin'|'app'|'child-app'|'workspace-kind'|'workspace'|'subagent'|'session'`, `optional?`, `capabilities?{ fs, exec, servicePorts, secrets }`, `provisioning?{ templateDirs, nodePackages, python, sdkArchives, env, pathEntries }`, `services?`, `readiness?{ timeoutMs, healthCheck }`). `resolveBashProvisioningRequirements(input) -> { options: ProvisionWorkspaceRuntimeOptions; requirements: NormalizedRequirement[] }` — collects app/child-app/workspace-kind/workspace/agent/plugin/session requirements, merges by `id` (reject conflicting spec, same id → stable error code), validates capabilities against `ProviderCapabilities` exported from `@hachej/boring-sandbox/shared` (P2 concrete file: `packages/boring-sandbox/src/shared/providerMatrix.ts`), and emits the existing `ProvisionWorkspaceRuntimeOptions.plugins[]` mapping (`nodePackages`/`python`/`templateDirs`/`skills`) plus a sidecar `NormalizedRequirement[]` carrying `source`, `optional`, requested capabilities, stable requirement ids for readiness/diagnostics, and agent-owned normalized runner specs. Import `ProvisionWorkspaceRuntimeOptions`/`RuntimeProvisioningContribution` and the normalized runner spec types **type-only** from `@hachej/boring-agent/server`; this is the allowed boring-bash→agent type edge. The normalizer consumes already-parsed manifest/config records — it must **not** import or execute plugin code. Reject requirement ids containing raw secrets or host-private paths (validate id charset, mirror `isValidBoringPluginId` style).
- **Tests:** merge-by-id order across all source layers; conflict rejection with stable code; capability-vs-provider rejection (e.g. `exec:true` against a `none` provider); import-free proof (side-effecting fixture manifest is not executed); unsafe/duplicate id rejection; output matches expected `ProvisionWorkspaceRuntimeOptions` for templateDirs/nodePackages/python/env/pathEntries; no raw secret in normalized records.
- **Acceptance:** requirement normalization is reusable by core/full-app/CLI composition; no agent→bash cycle; agent import-scan green.

### BBP5-002 — Re-point provisioning callers through the normalizer [size M]

- **Files touch:** `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` (the `provisionRuntime:` callback), `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` (provisioning path), `packages/cli/src/server/modeApps.ts` (both call sites). These are host/composition/CLI layers → they may value-import `@hachej/boring-bash/server`.
- **Notes:** Each caller collects its requirement sources (app defaults, resolved child-app/workspace-kind context when present — consumed, not owned; workspace; agent; plugin `bash` blocks; session grants), runs `resolveBashProvisioningRequirements`, and passes the returned `ProvisionWorkspaceRuntimeOptions` into the agent-owned `provisionWorkspaceRuntime()`. Keep the existing `runtimePlugins`/`RuntimeProvisioningContribution` inputs flowing (they become one requirement source). No behavior change for workspaces with no bash requirements. Delete any now-dead ad-hoc merging in the callers in the same PR.
- **Tests:** existing `createCoreWorkspaceAgentServer.provisioning.test.ts`, `createWorkspaceAgentServer.test.ts`, `macroRuntimeProvisioning.test.ts` pass unchanged in behavior; a new fixture proves a plugin `bash.nodePackages` requirement reaches `provisionWorkspaceRuntime` through the normalizer.
- **Acceptance:** all three composition layers provision via one normalizer; no parallel provisioning path remains.

### BBP5-003 — Per-requirement readiness + `optional_failed` derived state [size M]

- **Files touch:** `packages/agent/src/server/runtime/readyStatus.ts` (extend/wrap `AgentCapabilityReadiness` to carry N requirement details without dropping `chat`/`workspace`/`runtimeDependencies`); `packages/agent/src/server/runtime/modeReadiness.ts`; `packages/agent/src/server/http/routes/readyStatus.ts`; `packages/agent/src/server/registerAgentRoutes.ts` (map normalized requirements → `runtime:<id>` capability details); front consumers `packages/agent/src/front/runtimeReadinessStatus.ts` (already knows `runtime:<id>`) — extend copy for `optional_failed` display only.
- **Notes:** Keep aggregate `ReadyState` unchanged. Reuse `CapabilityReadinessDetail` — do not invent a parallel detail bag. Represent optional failures as a **derived display concept** over `state='failed'` + `optional=true`; do not add a `CapabilityState` enum value. Preserve `mergeTools({ checkReadiness })` gating and the four existing readiness tags.
- **Tests:** existing `readyStatus.test.ts` + `http/routes/__tests__/readyStatus.test.ts` pass; a failed required requirement blocks only its dependent tools; a failed optional requirement leaves unrelated tools ready and shows `optional_failed`; readiness SSE carries per-requirement detail without breaking old consumers; `retryable`/`errorCode`/`causeCode`/`message` populate.
- **Acceptance:** per-requirement diagnostics are visible and actionable; existing readiness consumers keep working.

### BBP5-004 — Health-check gating [size S]

- **Files create:** `packages/agent/src/server/workspace/provisioning/healthCheck.ts` — the health-check runner over the agent-owned normalized `ProvisioningHealthCheckSpec` input + `__tests__/`.
- **Files touch:** `provisioning/types.ts` (add `readiness?.healthCheck: ProvisioningHealthCheckSpec`), `registerAgentRoutes.ts` (gate `runtime:<id>` ready on health pass).
- **Notes:** The boring-bash `BashRequirement.readiness.healthCheck` source shape is mapped by BBP5-001 into `ProvisioningHealthCheckSpec`; the agent runner consumes only that normalized contract and never imports `@hachej/boring-bash`. Health check fields follow `../03` (command/http probe, `timeoutMs`, retry/backoff). Health failure → `CapabilityState='failed'` with a stable `errorCode`, retryable where appropriate; it gates the dependent tool/panel, never the aggregate unless required. Redact any secret-shaped values from health output before logging.
- **Tests:** health pass flips requirement to ready; failure gates the dependent tool with a stable diagnostic; timeout is `retryable`.
- **Acceptance:** readiness gates on real health, not just install completion.

### BBP5-005 — SDK-archive provisioning [size M]

- **Files create:** `packages/agent/src/server/workspace/provisioning/sdkArchive.ts` — the SDK-archive runner/installer over the agent-owned normalized `ProvisioningSdkArchiveSpec` input + `__tests__/`.
- **Files touch:** `provisioning/types.ts` (`RuntimeProvisioningContribution.sdkArchives: ProvisioningSdkArchiveSpec[]`), `provisionWorkspaceRuntime.ts` (add an `sdk archives` phase between node and python, following the `runPhase` pattern), `fingerprint.ts` (fold archive id + content hash into the fingerprint).
- **Notes:** The boring-bash source requirement is mapped by BBP5-001 into `ProvisioningSdkArchiveSpec`; the agent runner consumes only that normalized contract and never imports `@hachej/boring-bash`. Reuse `packArtifact.ts` — archives enter the runtime as packed/copied artifacts via `adapter.resolveInstallSource`/`copyFromHost`, **never** as ad-hoc host paths. Rewrite any resulting env/path entries to sandbox-visible paths. Preserve Vercel pack-artifact no-host-leak rules.
- **Tests:** archive installs and is fingerprint-skipped on repeat; archive spec change re-provisions; no host path leaks into the runtime (extend the existing leakage assertions); env/path rewritten to runtime-visible paths.
- **Acceptance:** SDK archives provision through the same engine, fingerprinted and leak-safe.

### BBP5-006 — Managed service requirements [size L]

- **Files create:** `packages/agent/src/server/workspace/provisioning/managedService.ts` — the managed-service supervisor/runner (start/health/port-grant/teardown) over the agent-owned normalized `ProvisioningManagedServiceRequirement` input + `__tests__/`.
- **Files touch:** `provisioning/types.ts` (`ProvisioningManagedServiceRequirement`), `registerAgentRoutes.ts` (surface service status `not-started|starting|ready|failed` into readiness; gate dependent tools/panels), the host callers (BBP5-002) to pass service requirements through.
- **Notes:** The boring-bash source requirement is mapped by BBP5-001 into `ProvisioningManagedServiceRequirement`; the agent supervisor consumes only that normalized contract and never imports `@hachej/boring-bash`. The normalized shape follows `../03` (`id`, `command`, `cwd?`, `ports[{port, purpose:'iframe'|'api'|'preview', public?}]`, `healthCheck?`, `teardown:'kill-process-tree'|'provider-default'`). Services require `exec` + `servicePorts` capability; deny otherwise with a stable code. No public exposure without an explicit port/proxy/iframe grant. Services run inside the selected source-of-truth/runtime view. Teardown on workspace/plugin dispose is deterministic. **Managed services receive only non-secret status/handles** (service status, port/proxy handles, grant ids) — a managed service is a sandboxed environment, so **no raw brokered secret ever enters its env**, grant or no grant. Raw brokered secrets are consumed **only by trusted-core tools running outside any sandboxed environment** (BBP5-007); a BBP5-007 grant authorizes such a trusted-core tool's *use* of a secret, it never opens an env-injection path into a service. Capture service logs with truncation/redaction, linked to the requirement id.
- **Tests:** start → health pass → port grant surfaces; health failure gates panel with stable diagnostic; teardown kills the process tree; denied `exec`/`servicePorts` blocks start; **no raw secret is ever present in a managed-service env** — even with a BBP5-007 grant configured, a command reading the service's environment cannot observe any brokered secret value (the service sees only status/handles).
- **Acceptance:** trusted-plugin services are supervised, policy-gated, readiness-surfaced, and cleanly torn down.

### BBP5-007 — Secret status/grant model + credential brokering rule [size L]

- **Files create:** `packages/agent/src/server/secrets/secretStatus.ts` (host-owned status API: `missing|granted|denied|expired`, grant-handle model) + `__tests__/`; `packages/agent/src/server/secrets/__tests__/brokerNoSandboxLeak.test.ts` (the negative test).
- **Files touch:** `provisioning/types.ts` (secret **names/grant ids/status** only — never values), `resolveBashProvisioningRequirements.ts` (BBP5-001: `capabilities.secrets` participate in policy intersection and readiness), `registerAgentRoutes.ts` / readiness (surface secret status), the provider-adapter env boundary (`WorkspaceProvisioningAdapter` / sandbox exec env) — confirm no brokered secret is ever placed on a sandbox env there.
- **Notes:** Secrets are **host-side handles**. The status API returns status without values; the model/browser/plugin see status + names only. A brokered secret is consumed only by trusted-core code (a host tool or a provider adapter running on the trusted core side). **A grant authorizes a trusted-core tool's *use* of a secret — it is never an env-injection authorization**; there is no grant, anywhere, that places a raw secret onto a managed-service or sandbox env (managed services get only non-secret status/handles, BBP5-006). **Brokered secrets never enter any sandboxed environment** — there is no process-env injection path for them. The `direct` provider is not a sandbox (a host process running as the developer with their own ambient environment), so nothing is "injected" there either. Raw values never enter `WorkspaceProvisioningResult.env`, provisioning plan files, fingerprints, logs, or the transcript. Fingerprints/plans may carry secret names/grant ids/status only.
- **Tests:** status visible without value; raw value never serialized to browser/plugin/model/readiness/provisioning-artifact/log payloads; missing secret blocks only its dependent requirement; denied/expired → stable codes; **no** brokered secret is ever placed on a sandbox env (there is no injection path). **Brokering negative test:** provision + exec a sandbox with a brokered secret configured for host-side use; assert a command reading the environment inside the sandbox (`env`, `printenv`, `/proc/self/environ`) cannot observe the secret value, and a known fake value appears in no captured log/prompt/artifact.
- **Acceptance:** secret availability is diagnosable without exposure; no sandbox-side read of a brokered secret (no injection path exists).

### BBP5-008 — Remote-worker capability handshake (reported | unknown, fail-closed) [size M]

- **Files touch:** the remote-worker provider (`.../remote-worker/createRemoteWorkerSandbox.ts` + `protocol.ts` + `workerClient.ts`, at their post-P2 location under `@hachej/boring-sandbox/providers/remote-worker/*` + `@hachej/boring-sandbox/shared/remoteWorkerProtocol.ts`); the app-owned worker server `apps/full-app/src/server/worker/*` (report side); readiness/policy validation (consume the handshake).
- **Notes:** **This bead is the SOLE owner of the remote-worker handshake.** `TODO-P2` BBP2-006 only *moved* the protocol/client/adapter code and left the worker-dependent capability facts `'unknown'` (carrying the hardcoded `client.health()`/`capabilities:['exec']` behavior over unchanged); it added no handshake and no fail-closed validation. Here we replace that hardcoded `capabilities: ['exec']` + bare `client.health()` with a real handshake. The worker **reports** typed capability facts compatible with the P2 `remote-worker` row in `@hachej/boring-sandbox/shared` `providerMatrix` + hardening facts: gVisor/seccomp, per-workspace network namespace/firewall, metadata/private-CIDR egress policy, same-host cross-workspace boundary, filesystem persistence model, real bash/binaries, provider contract version. Every worker-dependent field is typed `reported | unknown`. Consumers **fail closed on `unknown`** and on any policy-required property the worker did not prove; distinguish "provider unavailable" from "available but insufficiently hardened" with distinct stable codes. Reject unknown/missing contract version. No silent downgrade to direct/local behavior.
- **Tests:** mock worker claims/denies capabilities; required gVisor/network-isolation `unknown` or missing → reject with stable code; malformed/partial handshake → reject; bad contract version → reject; handshake facts appear in diagnostics; no silent downgrade. **Owns the fail-closed-on-`'unknown'` policy test (relocated from `TODO-P2` BBP2-002):** a policy requiring a worker-dependent capability that is still `'unknown'` (no handshake yet, or handshake did not prove it) is rejected, not assumed satisfied — this is the sole home for that assertion.
- **Acceptance:** remote-worker capabilities are explicit reported facts; policy fails closed when unproven; `apps/full-app/src/server/worker/*` imports only shared protocol, never agent core.

### BBP5-009 — Two-phase bootstrap/onSession + fingerprint key composition [size M]

- **Files touch:** `provisionWorkspaceRuntime.ts` (split reusable template/bootstrap from session/onSession where the provider supports it; keep the current single-phase path working), `fingerprint.ts` (compose the key), `registerAgentRoutes.ts` (call onSession reconciliation per session), Vercel provider snapshot code (post-P2 under `providers/vercel-sandbox/*` — preserve packaging/snapshot behavior).
- **Notes:** Bootstrap installs common deps / seeds templates / creates the provider snapshot; onSession applies session grants, env, managed services, per-session readiness. Fingerprint key includes provider, optional runtime image `ref` + pinned `digest` (the digest is the base provisioning fingerprint), workspace/child-app/agent ids, requirement ids/content (the runtime overlay on top of the image), seed content hash, source graph hash, provider contract version, revalidation key — and secret **names/grant ids/status** but never raw values. Different child-app/agent requirement sets must not reuse an incompatible template. On resume, stale/missing provider state is surfaced explicitly (session durability ≠ file/service durability, invariant 5), never silently treated as durable.
- **Tests:** same fingerprint skips; changed image digest, requirement id/content, source graph, or provider contract re-provisions; different agent/child-app requirements do not share a snapshot; onSession reruns without rebuilding the template; secret value change never alters fingerprint/logs while grant/status change affects per-session readiness; existing Vercel packaging/snapshot tests pass.
- **Acceptance:** template reuse is safe, observable, and scoped by the same policy/provisioning facts that determine runtime powers.

### BBP5-010 — Remote-worker no-leak conformance mount (the deferred remote-worker env mount) [size S]

- **Files create:** `packages/boring-bash/src/server/testing/__tests__/remoteWorkerProjectionConformance.test.ts` — a subject adapter that drives `checkReadonlyProjectionConformance` against a **remote-worker (provider) attachment**, added as the remote-worker mount of the one env/no-leak suite (`09` / `07` §3c "one suite, N mounts").
- **Notes:** This is the **deferred remote-worker mount** named in `09-environments-attachable.md` and `07-tests-review-acceptance.md` §3c: the delivered mounts are in-process, scoped-view+symlink (E1), and MCP (E2); the remote-worker mount is **gated on the remote-worker handshake (BBP5-008)** because the provider attachment's capability facts come only from the handshake. Remote-worker stays a **provider** in this epic (P2/P5) — the mount is the provider attachment, not a reclassification of remote-worker as an environment transport (that reclassification is deferred to a post-E2 P8 follow-up per `09`). Reuse the existing fixture seeds and the same expected visible-path set as the in-process mount; assert denied files are physically absent and no brokered secret is reachable (BBP5-007). No new suite — a mount only.
- **Tests:** the file is the test — remote-worker mount `passed: true`, identical visible-path set to the in-process mount, denied sentinel absent, no brokered secret in any client-reachable payload.
- **Acceptance:** the env/no-leak conformance suite runs its remote-worker (provider attachment) mount green, gated on the BBP5-008 handshake; it is the owning bead the pack names for that mount.

### BBP5-011 — Louder readiness signal for a missing governance policy source (#550 gap 2) [size S] — **Amendment (2026-07-06)**

- **Files touch:** `plugins/boring-governance/src/server/*` (policy-source load path), the governance readiness/diagnostics surface (ride the BBP5-003 per-requirement readiness detail — do not invent a parallel signal), `plugins/boring-governance` admin view copy if a banner is chosen.
- **Notes:** Missing policy YAML silently disables governance today (safe fail-closed default, decided — keep it). Add a **louder operational signal** on top: surface "governance: disabled — no policy source" through a readiness/health detail (and/or an admin banner), not only the existing startup log. No behavior change to the disable itself; diagnosability only.
- **Tests:** with no policy source configured, the readiness/diagnostics payload (or admin surface) reports governance disabled with a stable code; with a policy source present, no such signal; governance still fails closed either way.
- **Acceptance:** ops can see "governance disabled — no policy source" without reading boot logs; the safe default is unchanged.

### BBP5-012 — Forbid the `process.cwd()` company-context root fallback outside dev (#550 gap 7) [size S] — **Amendment (2026-07-06)**

- **Files touch:** the default company-context root resolver in `plugins/boring-governance` server config (+ its tests).
- **Notes:** Explicit `BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT` is the intended prod path; the cwd-relative default is a dev convenience that can surprise in odd deployments. Require the env var outside dev: in non-dev environments a missing `BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT` is a fail-closed configuration error with a stable code, never a silent `process.cwd()` fallback. Keep the cwd fallback for dev only.
- **Tests:** non-dev + unset env var → stable configuration error (no cwd fallback); dev + unset → cwd fallback preserved; set env var → used verbatim in both.
- **Acceptance:** no production deployment can silently resolve the company-context root from `process.cwd()`.

## Verification — exact commands verified against package.json scripts

```bash
# boring-bash (normalizer + requirement shape)
pnpm --filter @hachej/boring-bash run build
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-bash run test

# agent (engine/readiness/secrets/services/handshake extensions)
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run lint:invariants     # bash ../../scripts/check-invariants.sh .
pnpm --filter @hachej/boring-agent run check:isolation
pnpm --filter @hachej/boring-agent run smoke:capability-readiness   # tsx ./scripts/smoke-capability-readiness.mts

# host callers still build/test after re-point
pnpm --filter @hachej/boring-core run test
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-ui-cli run test
pnpm --filter full-app run typecheck
pnpm --filter full-app run smoke:remote-worker      # node scripts/remote-worker-smoke.mjs (handshake)

# repo-wide boundary + cycle guards (root package.json)
pnpm lint:invariants        # agent + boring-bash + workspace-plugin invariants
pnpm audit:imports          # tsx scripts/audit-imports.ts
pnpm typecheck              # build:packages then per-pkg typecheck
```

(Verify each `--filter` package name against its `package.json#name` before running; the scripts above are confirmed present.)

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) P5 rows exactly:

- `pr1-bash-requirement-normalizer` → BBP5-001.
- `pr2-repoint-callers` → BBP5-002.
- `pr3-readiness-health` → BBP5-003 + BBP5-004.
- `pr4-sdk-archive` → BBP5-005.
- `pr5-managed-service` → BBP5-006, split as pr5a/pr5b only if the declared >2k cap is hit.
- `pr6-secret-brokering` → BBP5-007.
- `pr7-remote-worker-handshake` → BBP5-008 + BBP5-010 (remote-worker no-leak conformance mount rides the handshake PR).
- `pr8-two-phase-fingerprint` → BBP5-009.
- `pr9-governance-550-hardening` → BBP5-011 + BBP5-012 (Amendment 2026-07-06; #550 gaps 2 + 7).

## Review gates

- P3 + P2 `@hachej/boring-sandbox/shared` `providerMatrix` precondition confirmed (or STOP+report). (P5 dispatches off P3 in parallel with P4/E1 — it does NOT depend on P4.)
- `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value imports; engine still agent-owned, normalizer boring-bash-owned.
- Provisioning behavior unchanged for no-requirement workspaces; existing provisioning/readiness/Vercel-snapshot tests pass.
- Optional-failure isolation, health gating, service lifecycle, SDK-archive leak-safety all covered by tests.
- Brokering negative test present and green: no sandbox-side read of a brokered secret; no brokered secret is ever placed on a sandbox env (there is no injection path — the `direct` provider is a host process, not a sandbox).
- Remote-worker handshake reports typed `reported|unknown` facts and fails closed on `unknown`.
- Two-phase fingerprint composition includes all listed keys and no raw secret.
- EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.
