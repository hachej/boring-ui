> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# TODO-P5 — Extend provisioning, readiness, secrets, services (bash track)

## Active Docker-host v1 work order (2026-07-11)

Do not dispatch P5a before the D1 tracer demonstrates a missing seam. Then
dispatch at most one of these narrow slices per assignment:

1. BBP5-007 recut: host-side secret refs/status/brokerage required by D1.
2. BBP5-003/004 recut: only a host-readiness fact D1 consumes and the existing
   composition cannot already provide.

BBP5-008 remote-worker/runsc stays with P2. D1 owns its desired-state digest,
reconciliation, and rollback; do not dispatch BBP5-009 or BBP5-011/012 merely
because they existed in the old stack.

Prerequisite: only the concrete D1/workspace/host facts consumed by these
slices. P2, P3, and E1 are not gates. BBP5-001/002 generic
normalizer/engine relocation, BBP5-005/006 services/SDK work, BBP5-010 remote
mounts, E1 lifetimes, and D2 hot tenancy are post-v1.

Requirements/readiness validate authority selected by host/workspace/D1; they
never grant or widen it. [`P5A-HANDOFF.md`](./P5A-HANDOFF.md) is the v1 closeout
authority.

## Historical broad P5 work order — non-dispatchable for v1

The remaining coordinator and beads describe the superseded P3/E1-dependent
normalizer/engine plan. Retain them only for future re-specification from a
named consumer.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- `docs/issues/391/runtime-refactor/architecture/03-policy-provisioning-readiness.md` — requirement shape, "Extend existing provisioning" ownership rules, readiness model, secrets, managed services, remote-worker hardening, two-phase lifecycle, fingerprint key composition.
- `docs/issues/391/runtime-refactor/INDEX.md` — Phase 5 deliverables/exit; the v2 delta: **credential brokering rule** — brokered secrets are host-side handles consumed only by trusted-core tools and **never enter any sandboxed environment** or the model transcript; exit adds "no test can read a brokered secret from inside the sandbox".
- `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` — invariant 6 (no silent widening), 14 (secrets brokered at the environment boundary, never in sandbox process or transcript), 15 (EU-sovereign defaults). Provisioning ownership: host orchestrates; boring-bash/server owns the extracted environment engine/runners; boring-sandbox owns provider adapters/facts; agent receives readiness facts only.
- `docs/issues/391/runtime-refactor/INDEX.md` — dispatch protocol; **Simplicity & no-compat policy (binding)**: migrate every importer in-PR, no shims, no deprecated aliases, no abstraction without two consumers, `// TODO(remove:<bead-id>)` + deletion bead for any transitional code.
- The v1 provisioning coverage (BBA-040..047) is **superseded and non-canonical** here — every compatibility-export/shim/deprecation-window instruction is stripped. The brokering model below **replaces** the v1 "shell env injection requires explicit policy" phrasing: brokered secrets are host-side handles consumed by trusted-core tools and **never enter any sandboxed environment, full stop**. The `direct` provider is not a sandbox — it is a host process running as the developer with their own ambient environment — so nothing is "injected" there; there is no brokered-secret env-injection path in any provider.

### Dependencies

- **P3 + E1** complete: the host composes the plain bash bundle and owns one
  prepared attachment lifetime. P5 does not gate on P4 presentation extraction.
- **P2** `@hachej/boring-sandbox/providers` plus `ProviderCapabilities` / `providerMatrix` exported from `@hachej/boring-sandbox/shared` exist. The concrete post-P2 source file is `packages/boring-sandbox/src/shared/providerMatrix.ts` (P2 `BBP2-002`), not `providers/matrix.ts`. The normalizer validates requirements against those facts. The concrete providers live in `@hachej/boring-sandbox` (00 open decision 3 RESOLVED; 08 decision 11), not `boring-bash/providers`; `resolveMode` lives in `@hachej/boring-bash/modes`. If the boring-sandbox providers or shared provider matrix are absent, STOP and report — do not fork a second capability model.

### Already landed (do not redo, build on it)

Provisioning engine (currently agent-owned; BBP5-002 extracts it atomically):

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
- [ ] v1 remote-worker handshake authenticates the worker and proves P2 runsc
      hardening facts before D1 selects it; missing/unknown/mismatched facts fail
      closed.
- [ ] post-v1 P5b: managed-service lifecycle and remote-worker attachment mount
      are accepted only when their consumers are scheduled.
- [ ] two-phase bootstrap/onSession: same fingerprint skips; changed requirement/source/contract re-provisions; onSession reruns without rebuilding a stable template; existing Vercel snapshot/fingerprint tests pass.
- [ ] **v2 brokering:** no test can read a brokered secret from inside the sandbox (see BBP5-007).
- [ ] post-v1 D2 owns hot shared-tenant provisioning; P5a does not build it.
- [ ] EU-sovereign (invariant 15): no bead introduces a US-hosted service as a default or hard dependency.

## Non-negotiables

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash` (`packages/boring-bash/scripts/check-invariants.mjs`). The normalizer,
  operational engine/runners, and their types live in boring-bash; host callers
  orchestrate them and inject only readiness facts into agent.
- Extend the existing engine/readiness/fingerprint. **Do not** create a second provisioning or readiness engine.
- Secrets are **host-side handles**, resolved and used only by trusted-core code (host tools, provider adapters). The model/browser/plugin sees status only. Raw secret values never enter `WorkspaceProvisioningResult.env`, provisioning plan files, fingerprints, logs, or the transcript.
- **Brokered secrets never enter any sandboxed environment, full stop** (00 invariant 14). There is no sandbox process-env injection path for a brokered secret. The `direct` provider is not a sandbox — it is a host process running as the developer with their own ambient environment — so nothing is "injected" there either; the distinction is sandbox vs. host process, not an injection exception.
- Remote-worker capabilities are **reported facts**, typed `reported | unknown`; consumers fail closed on `unknown` (never assume a hardening property the worker did not prove).
- No compat shims, no deprecated aliases, no old-path re-exports. Migrate every caller of the changed provisioning seam in the same PR.

## Do NOT

- Do not touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do not leave or add operational provisioning runners in agent core. BBP5-002
  owns one atomic move to boring-bash/server with importer migration and origin
  removal.
- Do not re-shape the landed #416 `packages/boring-bash/src/shared` contracts or server projection ops.
- Do not add a US-hosted provider as a default (invariant 15); vercel-sandbox stays an optional provider behind the capability matrix.
- Do not widen the `WorkspaceProvisioningAdapter.mode` union to smuggle `none`/`readonly`/`remote-worker` into provisioning — short-circuit them (they have no runtime deps to install).

## Beads

### BBP5-001 — `BashRequirement` shape + import-free normalizer in boring-bash [size L]

- **Files create/touch:** `packages/boring-bash/src/shared/bashRequirement.ts`
  (front-safe source requirement shape — no `node:*`/`Buffer`) and
  `packages/boring-bash/src/server/provisioning/types.ts` (normalized
  host-runner inputs, including health; post-v1 SDK/service types stay here),
  `resolveBashProvisioningRequirements.ts`, and its tests. Add no agent
  provisioning type.
- **Files touch:** `packages/boring-bash/src/shared/index.ts` (export `BashRequirement` + sub-types); `packages/boring-bash/src/server/index.ts` (export normalizer); `packages/boring-bash/scripts/check-invariants.mjs` (shared stays `node:*`-free).
- **Notes:** Define `BashRequirement` per `../../architecture/03-policy-provisioning-readiness.md` "Requirement shape" (`id`, `source: 'agent'|'plugin'|'app'|'child-app'|'workspace-kind'|'workspace'|'subagent'|'session'`, `optional?`, `capabilities?{ fs, exec, servicePorts, secrets }`, `provisioning?{ templateDirs, nodePackages, python, sdkArchives, env, pathEntries }`, `services?`, `readiness?{ timeoutMs, healthCheck }`). `resolveBashProvisioningRequirements(input) -> { plan: NormalizedProvisioningPlan; requirements: NormalizedRequirement[] }` collects sources, merges by id, validates provider capabilities, and emits boring-bash-owned immutable runner inputs plus readiness facts. It imports no agent provisioning contracts. The normalizer consumes already-parsed manifest/config records — it must **not** import or execute plugin code. Reject requirement ids containing raw secrets or host-private paths.
- **Amendment (2026-07-08):** plugin `boring.requires` is resolved per agent through this normalizer as an effective per-agent requirement source; unsatisfied or unknown required facts fail closed for that agent without activating the plugin.
- **Tests:** merge-by-id order across all source layers; conflict rejection with stable code; capability-vs-provider rejection (e.g. `exec:true` against a `none` provider); import-free proof (side-effecting fixture manifest is not executed); unsafe/duplicate id rejection; output matches expected `ProvisionWorkspaceRuntimeOptions` for templateDirs/nodePackages/python/env/pathEntries; no raw secret in normalized records.
- **Acceptance:** requirement normalization is reusable by core/full-app/CLI composition; no agent→bash cycle; agent import-scan green.

### BBP5-002 — Re-point provisioning callers through the normalizer [size M]

- **Files move:** `packages/agent/src/server/workspace/provisioning/*` to
  `packages/boring-bash/src/server/provisioning/*`, preserving history where
  practical. Migrate `createCoreWorkspaceAgentServer`,
  `createWorkspaceAgentServer`, CLI mode callers, and other importers; remove
  agent origins/exports in the same PR with no compatibility re-export.
- **Notes:** Each host collects requirement sources, runs the normalizer, then
  invokes the boring-bash server engine with a provider adapter from
  boring-sandbox. Host owns orchestration/cancellation/lifetime and reports
  methodless readiness updates through the existing agent injection seam. No
  behavior change for no-requirement workspaces.
- **Tests:** existing `createCoreWorkspaceAgentServer.provisioning.test.ts`, `createWorkspaceAgentServer.test.ts`, `macroRuntimeProvisioning.test.ts` pass unchanged in behavior; a new fixture proves a plugin `bash.nodePackages` requirement reaches `provisionWorkspaceRuntime` through the normalizer.
- **Acceptance:** all composition layers provision via one host-owned call path;
  no operational provisioning runner/type remains exported from agent.

### BBP5-003 — Per-requirement readiness + `optional_failed` derived state [size M]

- **Files touch:** `packages/agent/src/server/runtime/readyStatus.ts` (extend/wrap `AgentCapabilityReadiness` to carry N requirement details without dropping `chat`/`workspace`/`runtimeDependencies`); `packages/agent/src/server/runtime/modeReadiness.ts`; `packages/agent/src/server/http/routes/readyStatus.ts`; `packages/agent/src/server/registerAgentRoutes.ts` (map normalized requirements → `runtime:<id>` capability details); front consumers `packages/agent/src/front/runtimeReadinessStatus.ts` (already knows `runtime:<id>`) — extend copy for `optional_failed` display only.
- **Notes:** Keep aggregate `ReadyState` unchanged. Reuse `CapabilityReadinessDetail` — do not invent a parallel detail bag. Represent optional failures as a **derived display concept** over `state='failed'` + `optional=true`; do not add a `CapabilityState` enum value. Preserve `mergeTools({ checkReadiness })` gating and the four existing readiness tags.
- **Tests:** existing `readyStatus.test.ts` + `http/routes/__tests__/readyStatus.test.ts` pass; a failed required requirement blocks only its dependent tools; a failed optional requirement leaves unrelated tools ready and shows `optional_failed`; readiness SSE carries per-requirement detail without breaking old consumers; `retryable`/`errorCode`/`causeCode`/`message` populate.
- **Acceptance:** per-requirement diagnostics are visible and actionable; existing readiness consumers keep working.

### BBP5-004 — Health-check gating [size S]

- **Files create:** `packages/boring-bash/src/server/provisioning/healthCheck.ts`
  over the boring-bash-owned `ProvisioningHealthCheckSpec` plus tests.
- **Files touch:** host readiness adapter and the agent readiness injection seam.
- **Notes:** Host executes the runner and injects redacted methodless status into
  agent. Health check fields follow `../03` (command/http probe, `timeoutMs`,
  retry/backoff). Health failure gates the dependent tool/panel; agent never
  executes the command/http probe.
- **Tests:** health pass flips requirement to ready; failure gates the dependent tool with a stable diagnostic; timeout is `retryable`.
- **Acceptance:** readiness gates on real health, not just install completion.

### BBP5-005 — SDK-archive provisioning [size M]

- **Files create:** `packages/boring-bash/src/server/provisioning/sdkArchive.ts` — the post-v1 SDK-archive runner/installer over the boring-bash-owned normalized input + tests.
- **Files touch:** `provisioning/types.ts` (`RuntimeProvisioningContribution.sdkArchives: ProvisioningSdkArchiveSpec[]`), `provisionWorkspaceRuntime.ts` (add an `sdk archives` phase between node and python, following the `runPhase` pattern), `fingerprint.ts` (fold archive id + content hash into the fingerprint).
- **Notes:** The boring-bash source requirement maps to its server-owned
  `ProvisioningSdkArchiveSpec`; the boring-bash runner executes under host
  orchestration. Reuse the moved `packArtifact.ts` — archives enter the runtime
  as packed/copied artifacts, never ad-hoc host paths.
- **Tests:** archive installs and is fingerprint-skipped on repeat; archive spec change re-provisions; no host path leaks into the runtime (extend the existing leakage assertions); env/path rewritten to runtime-visible paths.
- **Acceptance:** SDK archives provision through the same engine, fingerprinted and leak-safe.

### BBP5-006 — Managed service requirements [size L]

- **Files create:** `packages/boring-bash/src/server/provisioning/managedService.ts` — the post-v1 managed-service supervisor/runner over the boring-bash-owned normalized input + tests.
- **Files touch:** `provisioning/types.ts` (`ProvisioningManagedServiceRequirement`), `registerAgentRoutes.ts` (surface service status `not-started|starting|ready|failed` into readiness; gate dependent tools/panels), the host callers (BBP5-002) to pass service requirements through.
- **Notes:** The boring-bash source requirement maps to its server-owned
  `ProvisioningManagedServiceRequirement`; the boring-bash supervisor executes
  under host orchestration. The normalized shape follows `../03` (`id`,
  `command`, `cwd?`, ports, health check, teardown). Services require `exec` +
  `servicePorts`; deny otherwise. Teardown on host/workspace/plugin disposal is
  deterministic. Managed services receive only status/handles, never raw
  brokered secrets. Capture truncated/redacted logs by requirement id.
- **Tests:** start → health pass → port grant surfaces; health failure gates panel with stable diagnostic; teardown kills the process tree; denied `exec`/`servicePorts` blocks start; **no raw secret is ever present in a managed-service env** — even with a BBP5-007 grant configured, a command reading the service's environment cannot observe any brokered secret value (the service sees only status/handles).
- **Acceptance:** trusted-plugin services are supervised, policy-gated, readiness-surfaced, and cleanly torn down.

### BBP5-007 — Secret status/grant model + credential brokering rule [size L]

- **Files create:** `packages/boring-bash/src/server/secrets/secretStatus.ts`
  (host-injected status/grant-handle broker boundary) plus tests and
  `brokerNoSandboxLeak.test.ts`. Agent receives only redacted methodless status.
- **Files touch:** `provisioning/types.ts` (secret **names/grant ids/status** only — never values), `resolveBashProvisioningRequirements.ts`, `registerAgentRoutes.ts` / readiness (surface secret status), and the provider-adapter env boundary (`WorkspaceProvisioningAdapter` / sandbox exec env) — confirm no brokered secret is ever placed on a sandbox env there.
- **Authority rule:** provider facts, host policy, workspace/tenant policy, and
  deployment policy establish maximum secret authority; authenticated grants
  and session scope establish active authority. `capabilities.secrets` is only
  a post-resolution requirement check for named secret status/availability. A
  requirement never grants, widens, or narrows secret authority.
- **Notes:** Secrets are **host-side handles**. The status API returns status without values; the model/browser/plugin see status + names only. A brokered secret is consumed only by trusted-core code (a host tool or a provider adapter running on the trusted core side). **A grant authorizes a trusted-core tool's *use* of a secret — it is never an env-injection authorization**; there is no grant, anywhere, that places a raw secret onto a managed-service or sandbox env (managed services get only non-secret status/handles, BBP5-006). **Brokered secrets never enter any sandboxed environment** — there is no process-env injection path for them. The `direct` provider is not a sandbox (a host process running as the developer with their own ambient environment), so nothing is "injected" there either. Raw values never enter `WorkspaceProvisioningResult.env`, provisioning plan files, fingerprints, logs, or the transcript. Fingerprints/plans may carry secret names/grant ids/status only.
- **Tests:** declaring a secret requirement without an authenticated grant does
  not grant access and fails readiness; an allowed grant cannot exceed maximum
  authority; status is visible without value; raw value never serializes to
  browser/plugin/model/readiness/provisioning-artifact/log payloads; missing
  secret blocks only its dependent requirement; denied/expired produce stable
  codes; **no** brokered secret is ever placed on a sandbox env (there is no
  injection path). **Brokering negative test:** provision + exec a sandbox with
  a brokered secret configured for host-side use; assert a command reading the
  environment inside the sandbox (`env`, `printenv`, `/proc/self/environ`)
  cannot observe the secret value, and a known fake value appears in no captured
  log/prompt/artifact.
- **Acceptance:** secret availability is diagnosable without exposure; no sandbox-side read of a brokered secret (no injection path exists).

### BBP5-008 — [P5a v1] Authenticated remote-worker hardening handshake [size M]

- **Files touch:** the remote-worker provider (`.../remote-worker/createRemoteWorkerSandbox.ts` + `protocol.ts` + `workerClient.ts`, at their post-P2 location under `@hachej/boring-sandbox/providers/remote-worker/*` + `@hachej/boring-sandbox/shared/remoteWorkerProtocol.ts`); the app-owned worker server `apps/full-app/src/server/worker/*` (report side); readiness/policy validation (consume the handshake).
- **Notes:** **This bead is the SOLE owner of the remote-worker handshake.** `TODO-P2` BBP2-006 only *moved* the protocol/client/adapter code and left the worker-dependent capability facts `'unknown'`; it added no handshake and no fail-closed validation. Here we replace the hardcoded `capabilities: ['exec']` + bare `client.health()` with a real handshake. The existing `x-boring-internal-token` authenticates the host request **to the worker only**; it is not evidence of worker identity. Production worker URLs therefore require HTTPS with a server identity pinned by the host profile (private CA plus hostname, mTLS server identity, or pinned SPKI fingerprint). Redirects to an unpinned origin, plaintext HTTP, disabled certificate validation, wrong hostname/CA/fingerprint, and development self-signed bypasses all fail closed for D1. The nonce-bound response is trusted only inside that authenticated TLS channel; it carries worker id, audience, contract version, and bounded freshness timestamp. Never log credentials/cert private material. The worker **reports** typed capability facts compatible with the P2 matrix: exact runsc version/platform (`systrap`), seccomp posture, per-workspace network namespace/firewall, metadata/private-CIDR egress policy, same-host cross-workspace boundary, cgroup/pid/CPU/memory limits, filesystem persistence model, pinned-image support, real bash/binaries, and provider contract version. Every worker-dependent field is typed `reported | unknown`. Consumers fail closed on `unknown` and on any required property the worker did not prove; distinguish TLS/identity/auth/unavailable from authenticated-but-insufficiently-hardened with stable codes. Reject stale, replayed, unknown/missing contract responses. No silent downgrade.
- **Tests:** plaintext, wrong CA/hostname/SPKI, redirect, disabled verification,
  unauthenticated request, wrong audience/worker, stale response, and replayed
  nonce reject before capability use; valid pinned TLS plus valid caller token
  succeeds. Mock capability claims/denials and malformed/bad-contract responses
  fail closed as appropriate. In addition, run against the preconfigured EU
  worker used by BBP2-010 and compare reported facts to provider probes; mocks
  alone do not close v1.
- **Acceptance:** remote-worker facts are authenticated, fresh, explicit, and match the real runsc target; policy fails closed when unproven; `apps/full-app/src/server/worker/*` imports only shared protocol, never agent core.

### BBP5-009 — Two-phase bootstrap/onSession + fingerprint key composition [size M]

- **Files touch:** the moved boring-bash/server `provisionWorkspaceRuntime.ts`
  and `fingerprint.ts`, host session orchestration (call onSession
  reconciliation), and Vercel provider snapshot code.
- **Notes:** Bootstrap installs common deps / seeds templates / creates the provider snapshot; onSession applies session grants, env, managed services, per-session readiness. Fingerprint key includes provider, optional runtime image `ref` + pinned `digest` sourced from the resolved `runtimeProfileRef` when present, else the validated provider-default image (the digest is the base provisioning fingerprint), workspace/child-app/agent ids, requirement ids/content (the runtime overlay on top of the image), seed content hash, source graph hash, provider contract version, revalidation key — and secret **names/grant ids/status** but never raw values. Different child-app/agent requirement sets must not reuse an incompatible template. On resume, stale/missing provider state is surfaced explicitly (session durability ≠ file/service durability, invariant 5), never silently treated as durable. BBP6-011 reqs-vs-image-facts validation is not required for this fingerprint fold.
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
- `pr7-authenticated-worker-handshake` → BBP5-008 (P5a v1).
- `pr7b-remote-worker-attachment-mount` → BBP5-010 (post-v1 P5b).
- `pr8-two-phase-fingerprint` → BBP5-009.
- `pr9-governance-550-hardening` → BBP5-011 + BBP5-012 (Amendment 2026-07-06; #550 gaps 2 + 7).

## Review gates

- P2 provider matrix/runsc, P3 bash bundle/routes, and E1 auth-gated attachment
  lifetime preconditions confirmed (or STOP+report). P5 may run in parallel with
  post-v1 P4, but not with E1.
- `pnpm lint:invariants` + `pnpm audit:imports` green; zero agent→bash value
  imports; engine/runners live in boring-bash/server and no agent origin/export remains.
- Provisioning behavior unchanged for no-requirement workspaces; existing provisioning/readiness/Vercel-snapshot tests pass.
- Optional-failure isolation, health gating, service lifecycle, SDK-archive leak-safety all covered by tests.
- Brokering negative test present and green: no sandbox-side read of a brokered secret; no brokered secret is ever placed on a sandbox env (there is no injection path — the `direct` provider is a host process, not a sandbox).
- Remote-worker handshake reports typed `reported|unknown` facts and fails closed on `unknown`.
- Two-phase fingerprint composition includes all listed keys and no raw secret.
- EU-sovereign: no US-hosted default/hard dependency introduced (invariant 15).
- Zero `// TODO(remove:*)` markers left dangling; any transitional code has a deletion bead in this file.
