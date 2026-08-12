---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: ready-for-agent
updated: 2026-08-12
flag: not-needed
---

# Plan: Blaxel sandbox provider adapter

## Outcome and effort verdict

A Blaxel provider is implementable against `@blaxel/core@0.3.11`, but a
production-ready adapter is not a one- or two-day change. A thin spike can map
create/exec/read/write/list/delete in that time. The Boring contracts additionally
require exact metadata, rename, recursive mkdir, cancellation, a shared output
budget, stable error translation, one shared watcher, provisioning, mode wiring,
and durable handle isolation. Several of those are shims over Blaxel process APIs,
and Blaxel exposes no provider-side output cap.

Estimate **8-12 focused engineer-days** for a merge-ready first version with a
persistent Volume, provisioning, conformance tests, a credential-gated live smoke,
and documented output/cancellation limitations. Estimate **3-4 days** for a
deliberately non-production prototype without durable Volume recovery, native
watch, or provisioning. The “day or two” claim is therefore refuted for the scope
of issue 1081.

The recommended initial support boundary is:

- use stable sandbox names plus `SandboxInstance.get()` for standby reconnect;
- attach one persistent Volume at `/workspace` when durable mode is configured;
- use native filesystem calls where their signatures satisfy `Workspace`;
- use carefully quoted guest commands for `stat`, rename, and recursive mkdir;
- implement process cancellation with a named process plus `process.kill()`;
- build the returned result from terminal stdout/stderr and enforce Boring's
  retained byte cap locally, while documenting that SDK 0.3.11 cannot cap bytes
  retained/returned by Blaxel or preserve byte-exact incremental callbacks;
- ship snapshots/forking and Agent Drive as out of scope because both are private
  preview, and the existing spike received `403` for Drive.

No live API request was made for this investigation. Static SDK inspection and
official documentation were cross-checked against the existing
[`BLAXEL-SPIKE.md`](../../../BLAXEL-SPIKE.md) lifecycle evidence.

## Evidence boundary

This plan is pinned to the dependency actually installed in this worktree:
`@blaxel/core` **0.3.11** (`package.json` and
`node_modules/@blaxel/core/package.json:1`). Installed declarations and runtime
source are authoritative when current documentation differs.

That distinction matters already: the current overview shows `storageMb` in a
sandbox create example, but `SandboxCreateConfiguration` in 0.3.11 has no
`storageMb`. The adapter must not compile against a documentation-only field. It
must use the installed Volume API for persistent `/workspace` storage.

Repository evidence was read at commit `4f2d8e587` on branch
`spike/blaxel-sandbox`. The prompt contains three stale assumptions which this
plan intentionally corrects:

1. The Vercel reference adapter now lives under
   `packages/boring-sandbox/src/providers/vercel-sandbox/`, not
   `packages/agent/src/server/workspace/`.
2. `packages/agent/src/server/runtime/resolveMode.ts` is 41 lines and contains no
   durable-handle implementation. Handle behavior is split across the shared
   store, agent host, provider, and core store adapter.
3. `providers/runsc` is not a `SandboxProviderV1`, provider ID, or runtime mode.
   It is qualification/preflight/evidence and lower-level runtime machinery. It
   is a rigor model, not a provider implementation to copy.

Official cross-checks:

- [Sandbox overview](https://docs.blaxel.ai/Sandboxes/Overview)
- [Filesystem](https://docs.blaxel.ai/Sandboxes/Filesystem)
- [Processes](https://docs.blaxel.ai/Sandboxes/Processes)
- [Volumes](https://docs.blaxel.ai/Sandboxes/Volumes)
- [Regions](https://docs.blaxel.ai/Infrastructure/Regions)
- [Snapshots and forking](https://docs.blaxel.ai/Sandboxes/Fork)

## The exact Boring contract

### Provider identity and capability report

[`providerMatrix.ts`](../../../packages/boring-sandbox/src/shared/providerMatrix.ts)
defines the version and closed IDs:

```ts
export const PROVIDER_CONTRACT_VERSION = "boring-sandbox.provider.v1";

export type SandboxProviderId =
  "none" | "readonly" | "direct" | "bwrap" | "vercel-sandbox" | "remote-worker";

export type RuntimeModeId =
  "pure" | "readonly" | "direct" | "local" | "vercel-sandbox" | "remote-worker";
```

`PROVIDER_CAPABILITIES` is an exhaustive
`Record<SandboxProviderId, ProviderCapabilities>`, and `MODE_TO_PROVIDER` is an
exhaustive `Record<RuntimeModeId, SandboxProviderId>`. Adding only a provider ID
will therefore fail type checking and would still leave mode resolution
incomplete.

[`capability.ts`](../../../packages/boring-sandbox/src/shared/capability.ts)
defines the exact report:

```ts
export type ProviderFilesystemCapability = "none" | "readonly" | "readwrite";
export type ProviderNetworkIsolation =
  "none" | "process" | "container" | "microvm" | "provider";
export type ProviderSourceOfTruth = "sandbox-primary" | "storage-primary";
export type ProviderHardening =
  "none" | "process" | "container" | "microvm" | "provider";
export type ProviderFilesystemPersistence =
  "none" | "ephemeral" | "session" | "durable" | "provider";
export type ReportedProviderCapability<T> = T | "unknown";

export interface ProviderCapabilities {
  fs: ProviderFilesystemCapability;
  exec: boolean;
  realBash?: ReportedProviderCapability<boolean>;
  realBinaries?: ReportedProviderCapability<boolean>;
  networkIsolation?: ReportedProviderCapability<ProviderNetworkIsolation>;
  watch: boolean;
  search: boolean;
  sourceOfTruth: ProviderSourceOfTruth;
  provisioningSupport: boolean;
  providerContractVersion: string;
  runtimeImage: ReportedProviderCapability<boolean>;
  hardening?: ReportedProviderCapability<ProviderHardening>;
  filesystemPersistence?: ReportedProviderCapability<ProviderFilesystemPersistence>;
}
```

Recommended entry after all planned slices land:

```ts
blaxel: {
  fs: "readwrite",
  exec: true,
  realBash: "unknown", // image-dependent; adapter preflight requires sh, not bash
  realBinaries: true,
  networkIsolation: "provider",
  watch: true,
  search: true,
  sourceOfTruth: "sandbox-primary",
  provisioningSupport: true,
  providerContractVersion: PROVIDER_CONTRACT_VERSION,
  runtimeImage: true,
  hardening: "provider",
  filesystemPersistence: "provider",
}
```

Do not claim `microvm` from the spike's KVM evidence. The enum value is a Boring
hardening assertion; without a qualification policy equivalent to runsc's
evidence pipeline, the honest value is provider-managed. Persistence is also
provider-dependent because an unattached base filesystem is not durable across
deletion; only the configured Volume is. `realBash` remains unknown because the
configured image may contain Bash, but the SDK and default-image contract do not
guarantee it; preflight for this adapter needs real `sh` and binaries, not a
hard-coded Bash claim.

### Provider v1 shape

[`providerV1.ts`](../../../packages/boring-sandbox/src/shared/providerV1.ts)
contains additional closed unions which must all gain `"blaxel"`:

```ts
export type ExtractedSandboxProviderIdV1 =
  "direct" | "bwrap" | "vercel-sandbox" | "remote-worker";

export type SandboxRuntimeModeIdV1 =
  "direct" | "local" | "vercel-sandbox" | "remote-worker";

export type SandboxProvisioningRuntimeModeIdV1 = Exclude<
  SandboxRuntimeModeIdV1,
  "remote-worker"
>;
```

Creation context and returned pair are exactly:

```ts
export interface SandboxProviderCreateContextV1 {
  workspaceRoot: string;
  sessionId: string;
  workspaceId?: string;
  templatePath?: string;
  requestId?: string;
  telemetry?: TelemetrySink;
}

export type SandboxPairHealthV1 =
  | Readonly<{ state: "ok" }>
  | Readonly<{ state: "recreate"; message?: string; error?: Error }>;

export type WorkspaceSandboxPairV1 = Readonly<{
  workspace: Workspace;
  sandbox: Sandbox;
  provisioning?: SandboxProvisioningOperationsV1;
  checkHealth?(): Promise<SandboxPairHealthV1>;
  dispose(): Promise<void>;
}>;

export interface SandboxProviderV1 {
  readonly contractVersion: typeof PROVIDER_CONTRACT_VERSION;
  readonly providerId: ExtractedSandboxProviderIdV1;
  readonly capabilities: ProviderCapabilities;
  resolveRuntimeRoot(context: SandboxProviderCreateContextV1): string;
  create(
    context: SandboxProviderCreateContextV1,
  ): Promise<WorkspaceSandboxPairV1>;
  invalidate?(context: { workspaceId: string }): Promise<void> | void;
  close?(): Promise<void>;
}
```

If `provisioningSupport` is true, the pair must expose this exact behavior:

```ts
export interface SandboxProvisioningWorkspaceFsV1 {
  exists(path: string): Promise<boolean>;
  rm(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeText(path: string, content: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  copyFromHost(hostSourcePath: string | URL, target: string): Promise<void>;
}

export interface SandboxProvisioningOperationsV1 {
  readonly mode: SandboxProvisioningRuntimeModeIdV1;
  exec(
    command: string,
    args: string[],
    opts?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<{ stdout?: string; stderr?: string } | void>;
  resolveInstallSource(
    source: string | URL,
    opts: { kind: "node" | "python"; id: string; fingerprint: string },
  ): Promise<string>;
  readonly workspaceFs: SandboxProvisioningWorkspaceFsV1;
  getRuntimeCacheRoot(): string;
}
```

`SandboxProviderError` accepts an existing stable agent `ErrorCode`; the
implementation must add deliberate Blaxel auth/config/API/expired error codes to
`packages/agent/src/shared/error-codes.ts` or reuse a truly provider-neutral code.
Relabeling a Vercel error as Blaxel would violate the stable-error invariant.

### Workspace and watcher

The canonical contract is
[`packages/agent/src/shared/workspace.ts`](../../../packages/agent/src/shared/workspace.ts),
not the stale server path in the prompt:

```ts
export interface WorkspaceRuntimeContext {
  readonly runtimeCwd: string;
}

export interface Workspace {
  readonly root: string;
  readonly runtimeContext: WorkspaceRuntimeContext;
  readFile(relPath: string): Promise<string>;
  readBinaryFile?(relPath: string): Promise<Uint8Array>;
  writeFile(relPath: string, data: string): Promise<void>;
  writeBinaryFile?(relPath: string, data: Uint8Array): Promise<void>;
  readFileWithStat?(relPath: string): Promise<{ content: string; stat: Stat }>;
  writeFileWithStat?(relPath: string, data: string): Promise<Stat>;
  writeBinaryFileWithStat?(relPath: string, data: Uint8Array): Promise<Stat>;
  unlink(relPath: string): Promise<void>;
  readdir(relPath: string): Promise<Entry[]>;
  stat(relPath: string): Promise<Stat>;
  mkdir(relPath: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(fromRelPath: string, toRelPath: string): Promise<void>;
  watch?(): WorkspaceWatcher;
  notifyExternalChange?(event: WorkspaceWatchControlEvent): void;
  readonly fsCapability?: "none" | "best-effort" | "strong";
}

export interface Entry {
  name: string;
  kind: "file" | "dir";
}

export interface Stat {
  size: number;
  mtimeMs: number;
  kind: "file" | "dir";
}

export interface WorkspaceChangeEvent {
  op: "write" | "unlink" | "rename" | "mkdir";
  path: string;
  oldPath?: string;
  mtimeMs?: number;
}

export type WorkspaceWatcherReadiness =
  { ok: true } | { ok: false; reason: string; message?: string };

export interface WorkspaceWatchControlEvent {
  type: "resync-required";
  reason: string;
}

export interface WorkspaceWatchSubscribeOptions {
  onControlEvent?: (event: WorkspaceWatchControlEvent) => void;
}

export interface WorkspaceWatcher {
  subscribe(
    listener: (event: WorkspaceChangeEvent) => void,
    options?: WorkspaceWatchSubscribeOptions,
  ): () => void;
  whenReady?(): Promise<WorkspaceWatcherReadiness>;
  close(): void;
}
```

Required semantics are as important as the signatures:

- `root === runtimeContext.runtimeCwd`, and the paired Sandbox has the same
  runtime context.
- Every public path is workspace-relative. The adapter owns path validation and
  must reject NUL, absolute Unix/Windows/UNC paths, decoded traversal,
  backslash traversal, CR/LF, and lexical escapes.
- `watch` is optional, but if supplied every call on one Workspace shares one
  underlying observation source. Listener unsubscribe does not close the source.
  `close()` is idempotent, and subscriptions after close are no-ops.
- A rename event sets `oldPath`; Blaxel's native event cannot provide that, so a
  native rename observation must request resync instead of inventing data.
- `fsCapability` is advisory, not an authorization boundary.

`WorkspaceChangeEvent` and watcher types are not currently re-exported from
`@hachej/boring-agent/shared`; the Vercel adapter uses `ReturnType`/`Parameters`
inference. Either preserve that pattern or deliberately expand the public export.

### Sandbox execution

Execution is not a Workspace `runCommand`; it is the paired
[`Sandbox`](../../../packages/agent/src/shared/sandbox.ts):

```ts
export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onHeartbeat?: (elapsedMs: number) => void;
  onStdout?: (chunk: Uint8Array) => void;
  onStderr?: (chunk: Uint8Array) => void;
}

export interface ExecResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  stdoutEncoding?: "utf-8" | "binary";
  stderrEncoding?: "utf-8" | "binary";
}

export interface Sandbox {
  readonly id: string;
  readonly placement: "server" | "remote" | "browser";
  readonly provider: string;
  readonly capabilities: readonly SandboxCapability[];
  readonly runtimeContext: WorkspaceRuntimeContext;
  init?(ctx: { workspace: Workspace; sessionId: string }): Promise<void>;
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  executeIsolatedCode?(input: IsolatedCodeInput): Promise<IsolatedCodeOutput>;
  dispose?(): Promise<void>;
}
```

`Sandbox.exec` normatively must honor the external signal, timeout, and one
combined stdout/stderr `maxOutputBytes`; it must set `truncated` and stream only
retained incremental bytes to callbacks. Timeout returns exit code 124 in the
conformance suite. Heartbeats are also tested.

### What runsc does and does not establish

`providers/runsc` exports no `SandboxProviderV1`. Its preflight command boundary
is:

```ts
export interface RunscHostCommand {
  file: string;
  args: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RunscHostCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunscHostCommandRunner {
  run(command: RunscHostCommand): Promise<unknown>;
}

export async function preflightRunsc(
  input: unknown,
  runner: RunscHostCommandRunner,
): Promise<RunscPreflightResult>;
```

Its inferred strict configuration expands to:

```ts
type RunscPreflightConfig = {
  stateRoot: string;
  digestMarkerPath: string;
  networkNamespace: string;
  nftTable: string;
  requiredBlockedCidrs: string[];
  cgroupRoot: string;
  workspaceCgroupRoot: string;
  binaries: {
    runsc: string;
    ip: string;
    nft: string;
    cat: string;
    true: string;
  };
  expected: {
    imageDigest: string;
    cpuPeriodMicros: number;
    cpuQuotaMicros: number;
    memoryBytes: number;
    pidsMax: number;
  };
};

validateRunscPreflightConfig(value: unknown): RunscPreflightConfig

class RunscPreflightError extends Error {
  constructor(readonly code: RunscPreflightErrorCode, message: string);
}
```

`validateRunscPreflightConfig(value: unknown): RunscPreflightConfig` validates
absolute bounded paths, a SHA-256 image digest, required blocked CIDRs, child
paths, safe IDs, and exact cgroup limits. Every probe is capped at 10 seconds and
256 KiB. `RunscPreflightError` has a stable code. Evidence V1/V2/V3 creation,
parsing, digest verification, qualification manifests, and fleet admission are
exported through `providers/runsc/index.ts`. Even successful preflight returns
`productionReady: false` with explicit unproven security facts; strict fleet
admission rejects a non-passed probe.

The full public evidence functions in `isolationEvidence.ts` are:

```ts
digestRuntimeIsolationValue(value: unknown): RuntimeIsolationDigest
createRuntimeIsolationEvidence(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  probes: unknown;
  positiveControls: unknown;
}): RuntimeIsolationEvidenceV1
verifyRuntimeIsolationEvidence(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification
createDockerRuntimeIsolationEvidence(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  probes: unknown;
  positiveControls: unknown;
  coldStartLatency?: unknown;
}): RuntimeIsolationEvidenceV2
verifyDockerRuntimeIsolationEvidence(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification
createRuntimeIsolationEvidenceV3(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  qualificationBundleDigest: unknown;
  qualificationRunId: unknown;
  qualificationTimestamp: unknown;
  probes: unknown;
  positiveControls: unknown;
  coldStartLatency?: unknown;
}): RuntimeIsolationEvidenceV3
verifyRuntimeIsolationEvidenceV3(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification
parseRuntimeIsolationEvidenceV3(value: unknown): RuntimeIsolationEvidenceV3
```

`index.ts` additionally re-exports strict qualification-bundle construction and
verification, fleet admission, Docker/runsc argv and command runners, bounded
runtime limits, invocation envelopes/credentials, workspace quotas, session
runtime, and workspace helper client. Those are host-specific runsc machinery,
not fields of `SandboxProviderV1`.

For Blaxel, copy the discipline: bounded helper calls, strict parsing, stable
errors, and honest unknown/provider claims. Do not add `runsc` to any provider or
mode union as part of this issue.

## Reference Vercel behavior to preserve deliberately

The full 563-line reference is
[`createVercelSandboxWorkspace.ts`](../../../packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxWorkspace.ts).
Its relevant behavior is:

- `/workspace` is both root and runtime cwd.
- All paths pass `validatePath("/workspace", relPath)`.
- SDK compatibility covers optional native `readFile`, `readdir`, `stat`,
  `mkdir`, `rename`, and `rm`, plus older `readFileToBuffer`, `mkDir`, and
  `runCommand` surfaces.
- `stat` and `readdir` use a map-backed LRU with `CACHE_TTL_MS = 15_000` and
  `CACHE_MAX_ENTRIES = 512`. Values are cloned. A metadata version prevents an
  in-flight read from repopulating after invalidation.
- `MAX_INLINE_WRITE_BYTES = 128 * 1024` limits only the small base64 exec shim;
  it is not a general file-size limit. Normal writes use `writeFiles`.
- `readFileWithStat` and write-with-stat combine operations when an SDK surface
  allows it, otherwise use bounded helper commands or write then stat.
- `unlink` rejects workspace root with `EPERM`, realpath-checks confinement,
  enumerates descendants for events, and uses recursive remove. It treats a
  symlink carefully rather than traversing its descendants.
- `mkdir` prefers native recursive creation and falls back to `mkdir -p`.
- `rename` prefers native rename and falls back to `mv --`; neither the contract
  nor conformance promises atomicity.
- every mutation invalidates metadata, marks the workspace dirty, and emits a
  local watcher event.
- repeated `watch()` calls return one broadcaster. The Vercel broadcaster sees
  only adapter-originated mutations, not arbitrary guest changes. Remote bash
  separately emits `resync-required`.

[`createVercelSandboxExec.ts`](../../../packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxExec.ts)
sets the execution precedent:

- default timeout 30 seconds and combined output limit 1 MiB;
- absolute `cwd` constrained to `/workspace`;
- `sh -c`, a safe PATH, and workspace Python environment;
- one collector shared by stdout/stderr, retaining partial final chunks;
- external abort passed to the SDK and rethrown;
- internal timeout returns exit 124;
- heartbeat every second;
- metadata invalidation in `finally`, even after failure or abort.

The Blaxel implementation should share the same path, cache, collector, and
error-normalization helpers where practical, rather than fork behavior by copy.

## Actual `@blaxel/core@0.3.11` surface

The declarations below were verified in the installed package. “Native” means
the public high-level SDK method exists; it does not imply that the SDK's own
implementation never executes a guest command.

### Sandbox lifecycle and provisioning

From `node_modules/@blaxel/core/dist/cjs/types/sandbox/sandbox.d.ts`:

```ts
SandboxInstance.create(
  sandbox?: SandboxModel | SandboxCreateConfiguration,
  options?: { safe?: boolean; createIfNotExist?: boolean },
): Promise<SandboxInstance>

SandboxInstance.get(sandboxName: string): Promise<SandboxInstance>
SandboxInstance.getByExternalId(externalId: string): Promise<SandboxInstance>
SandboxInstance.list(query?: SandboxListQuery): Promise<PaginatedList<SandboxInstance, {
  showTerminated?: boolean;
  cursor?: string;
  limit?: number;
  sort?: "createdAt:desc" | "createdAt:asc" | "name:asc" | "name:desc";
  q?: string;
  anchor?: "end";
  externalId?: string;
}>>
SandboxInstance.delete(sandboxName: string): Promise<SandboxModel>
sandbox.delete(): Promise<SandboxModel>
SandboxInstance.createIfNotExists(
  sandbox: SandboxModel | SandboxCreateConfiguration,
): Promise<SandboxInstance>
sandbox.wait(options?: { maxWait?: number; interval?: number }): Promise<SandboxInstance>

sandbox.snapshot(name?: string): Promise<SandboxSnapshot>
sandbox.listSnapshots(): Promise<SandboxSnapshots>
sandbox.deleteSnapshot(snapshotId: string): Promise<void>
sandbox.fork(
  targetName: string,
  options?: SandboxForkOptions,
): Promise<SandboxForkResponse>

SandboxInstance.updateMetadata(
  name: string,
  metadata: SandboxUpdateMetadata,
): Promise<SandboxInstance>
SandboxInstance.updateTtl(name: string, ttl: string | null): Promise<SandboxInstance>
SandboxInstance.updateLifecycle(
  name: string,
  lifecycle: SandboxLifecycle | null,
): Promise<SandboxInstance>
SandboxInstance.updateNetwork(
  name: string,
  network: SandboxUpdateNetwork,
): Promise<SandboxInstance>
SandboxInstance.fromSession(session: SessionWithToken): Promise<SandboxInstance>
```

An instance exposes `fs`, `network`, `process`, `previews`, `schedules`,
`sessions`, `codegen`, `system`, `drives`, and `h2Session`, plus metadata/status/
spec/events/last-used/expiry getters and `fetch(port, path?, init?)`. Only the
filesystem, process, drive, status/spec, and H2 lifecycle surfaces are relevant to
the first adapter.

`SandboxCreateConfiguration` in the installed package is exactly:

```ts
interface SandboxCreateConfiguration {
  name?: string;
  image?: string;
  memory?: number;
  ports?: (Port | Record<string, any>)[];
  envs?: EnvVar[];
  volumes?: (VolumeBinding | VolumeAttachment)[];
  ttl?: string;
  expires?: Date;
  region?: string;
  lifecycle?: SandboxLifecycle;
  network?: SandboxNetwork;
  snapshotEnabled?: boolean;
  labels?: Record<string, string>;
  extraArgs?: Record<string, string>;
  externalId?: string;
}
```

There is no explicit CPU field, sandbox working-directory field, or
`storageMb` field in 0.3.11. Memory is MB and CPU is derived by Blaxel. Runtime
defaults are `blaxel/base-image:latest` and 4096 MB. The adapter creates
`/workspace` and sets each process `workingDir` explicitly. Official examples
alternate between `/app` and `/blaxel/app`; those are examples, not an SDK
working-root setting or a contract the adapter should inherit.

Region is a native create field. The installed package exports
`listLocations()` and `getConfiguration()`; it does **not** export
`listRegions()`. Region access can be entitlement/policy dependent, so validate
configured syntax locally and let Blaxel return a stable normalized error rather
than hard-coding the four currently documented regions.

The generated control-plane functions are generic request-result APIs, not
high-level `SandboxInstance` methods:

```ts
getConfiguration<ThrowOnError extends boolean = false>(
  options?: Options<GetConfigurationData, ThrowOnError>,
): RequestResult<Configuration, unknown, ThrowOnError>

listLocations<ThrowOnError extends boolean = false>(
  options?: Options<ListLocationsData, ThrowOnError>,
): RequestResult<LocationResponse[], unknown, ThrowOnError>
```

The current documented codes are `us-pdx-1`, `us-was-1`, `eu-lon-1`,
`eu-fra-1`, and `auto`, but not every workspace is entitled to every region.

### Filesystem

From `filesystem.d.ts`:

```ts
mkdir(path: string, permissions?: string): Promise<SuccessResponse>
write(path: string, content: string): Promise<SuccessResponse>
writeBinary(
  path: string,
  content: Buffer | Blob | File | Uint8Array | string,
): Promise<SuccessResponse>
writeTree(
  files: SandboxFilesystemFile[],
  destinationPath?: string | null,
): Promise<Directory | undefined>
read(path: string): Promise<string>
readBinary(path: string): Promise<Blob>
download(src: string, destinationPath: string, options?: { mode?: number }): Promise<void>
rm(path: string, recursive?: boolean): Promise<SuccessResponse>
ls(path: string): Promise<Directory>
search(
  query: string,
  path?: string,
  options?: FilesystemSearchOptions,
): Promise<FuzzySearchResponse>
find(path: string, options?: FilesystemFindOptions): Promise<FindResponse>
grep(
  query: string,
  path?: string,
  options?: FilesystemGrepOptions,
): Promise<ContentSearchResponse>
cp(source: string, destination: string, options?: { maxWait?: number }): Promise<CopyResponse>
watch(
  path: string,
  callback: (event: WatchEvent) => void | Promise<void>,
  options?: { onError?: (error: Error) => void; withContent: boolean; ignore?: string[] },
): { close(): void }
```

`Directory.files` contains owner, group, lastModified, permissions, size, name,
and path. `Directory.subdirectories` contains only name and path. There is no
high-level `stat`, move, or rename. `mkdir` has no recursive parameter.

Although `cp` exists, 0.3.11 implements it as an unquoted
`cp -r ${source} ${destination}` command. Do not call it with user-controlled
paths. Boring has no Workspace copy method anyway.

Installed native watch events are:

```ts
interface WatchEvent {
  op: "CREATE" | "WRITE" | "REMOVE" | "RENAME" | "CHMOD";
  path: string;
  name: string;
  content?: string;
}
```

The current prose says “DELETE,” while the declaration and runtime use
`REMOVE`; the adapter must compile and test against the installed value. A watch
handle's `close()` aborts the streaming request. There is no readiness callback,
reconnect contract, or old path for rename.

The exact installed search option shapes are:

```ts
interface FilesystemSearchOptions {
  maxResults?: number;
  patterns?: string[];
  excludeDirs?: string[];
  excludeHidden?: boolean;
}
interface FilesystemFindOptions {
  type?: "file" | "directory";
  patterns?: string[];
  maxResults?: number;
  excludeDirs?: string[];
  excludeHidden?: boolean;
}
interface FilesystemGrepOptions {
  caseSensitive?: boolean;
  contextLines?: number;
  maxResults?: number;
  filePattern?: string;
  excludeDirs?: string[];
}
```

### Processes

From `process.d.ts` and generated types:

```ts
interface ProcessRequest {
  command: string;
  env?: Record<string, string>;
  keepAlive?: boolean;
  maxRestarts?: number;
  name?: string;
  restartOnFailure?: boolean;
  timeout?: number;
  waitForCompletion?: boolean;
  waitForPorts?: number[];
  workingDir?: string;
}

type ProcessRequestWithLog = ProcessRequest & {
  onLog?: (log: string) => void;
  onStdout?: (stdout: string) => void;
  onStderr?: (stderr: string) => void;
}

streamLogs(identifier: string, callbacks?: {
  onLog?: (log: string) => void;
  onStdout?: (stdout: string) => void;
  onStderr?: (stderr: string) => void;
  onError?: (error: Error) => void;
}): {
  close(): void;
  wait(): Promise<void>;
}
exec(request: ProcessRequest | ProcessRequestWithLog):
  Promise<PostProcessResponse | ProcessResponseWithLog>
wait(identifier: string, options?: { maxWait?: number; interval?: number }):
  Promise<GetProcessByIdentifierResponse>
get(identifier: string): Promise<GetProcessByIdentifierResponse>
list(): Promise<GetProcessResponse>
stop(identifier: string): Promise<DeleteProcessByIdentifierResponse>
kill(identifier: string): Promise<DeleteProcessByIdentifierKillResponse>
logs(identifier: string, type?: "stdout" | "stderr" | "all"):
  Promise<string>
```

Responses contain PID, name, status, exit code, stdout, stderr, logs, timestamps,
and working directory. There is no `AbortSignal` and no output-byte limit.
`streamLogs().close()` closes only the log transport. The streaming
`exec(waitForCompletion: true, callbacks)` creates an internal controller but
does not expose its close handle until the awaited operation has completed, so it
cannot implement Boring cancellation.

Official docs confirm `timeout` is seconds. Without `keepAlive: true`, it bounds
only the API wait and does not kill the process. With `keepAlive: true`, it is an
auto-kill timeout (and defaults to 600 seconds if omitted). Boring must still use
its own exact millisecond timer and `kill()`.

### Persistence, standby, snapshots, and Volumes

There is no explicit high-level start, stop, suspend, or state getter. A request
automatically resumes standby, and `SandboxInstance.get(name)` creates a fresh
instance/connection. The durable lookup handle is therefore the stable sandbox
name; `externalId` is a secondary indexed lookup, not unique.

The base filesystem survives standby but is not guaranteed as durable storage
after deletion/expiration. `ttl` is maximum age, `expires` is absolute time, and
`lifecycle` supports idle/max-age/date expiration policy. These are deletion
policies, not standby controls.

The stable Volume API exists:

```ts
VolumeInstance.create(config: VolumeCreateConfiguration | Volume): Promise<VolumeInstance>
VolumeInstance.get(name: string): Promise<VolumeInstance>
VolumeInstance.list(query?: VolumeListQuery): Promise<PaginatedList<VolumeInstance, {
  cursor?: string;
  limit?: number;
  sort?: "createdAt:desc" | "createdAt:asc" | "name:asc" | "name:desc";
  q?: string;
  anchor?: "end";
  externalId?: string;
}>>
VolumeInstance.delete(name: string): Promise<Volume>
volume.delete(): Promise<Volume>
VolumeInstance.update(
  name: string,
  updates: VolumeCreateConfiguration | Volume,
): Promise<VolumeInstance>
volume.update(updates: VolumeCreateConfiguration | Volume): Promise<VolumeInstance>
VolumeInstance.createIfNotExists(
  config: VolumeCreateConfiguration | Volume,
): Promise<VolumeInstance>
```

Attach it only at sandbox creation with `{ name, mountPath: "/workspace",
readOnly: false }`. Official constraints are one Volume per sandbox, one sandbox
per Volume, same region, attach at creation, and no detach. A Volume survives
sandbox deletion. Region and binding mismatches are therefore immutable
configuration errors, not fields to “fix” on reconnect.

Agent Drive supports hot mount/unmount but is private preview and entitlement
gated. Snapshots/list/delete/fork exist in 0.3.11, but official docs mark them
private preview and there is no in-place restore. Neither is in the first
production scope.

For completeness, the installed Drive surface is:

```ts
sandbox.drives.mount(request: DriveMountRequest): Promise<DriveMountResponse>
sandbox.drives.unmount(mountPath: string): Promise<DriveUnmountResponse>
sandbox.drives.list(): Promise<DriveMountInfo[]>
```

`DriveMountRequest` requires `driveName` and `mountPath` and optionally accepts
`drivePath`, `readOnly`, `uidMap`, and `gidMap`. It is not interchangeable with
the stable create-time persistent Volume attachment.

Lifecycle types in 0.3.11 are:

```ts
interface ExpirationPolicy {
  action?: "delete";
  type?: "ttl-idle" | "ttl-max-age" | "date";
  value?: string;
}
interface SandboxLifecycle {
  expirationPolicies?: ExpirationPolicy[];
  terminatedRetention?: string;
}
```

## Contract-to-Blaxel mapping

Effort is implementation effort for the individual adapter method after common
helpers exist: S is under half a day, M is roughly half to one day, L is one to
two days including edge tests.

| Boring method/capability                  | Concrete Blaxel 0.3.11 call                                                                         | Verdict                                                      | Effort |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| `provider.resolveRuntimeRoot()`           | constant `/workspace`                                                                               | NATIVE policy                                                | S      |
| `provider.create()` new                   | `VolumeInstance.createIfNotExists()` then `SandboxInstance.createIfNotExists()`                     | NATIVE + lifecycle orchestration                             | L      |
| `provider.create()` resume                | handle store then `SandboxInstance.get(sandboxName)`                                                | NATIVE                                                       | M      |
| `provider.invalidate()`                   | evict local instance/in-flight/cache state; do not delete remote resources                          | NATIVE policy                                                | S      |
| `provider.close()`                        | close owned watchers/log streams; global SDK connection close only at process shutdown              | NATIVE policy                                                | S      |
| `pair.checkHealth()`                      | on-demand control-plane `SandboxInstance.get(name)`; no periodic fs request                         | NATIVE, wake impact to qualify                               | M      |
| `pair.dispose()`                          | close local streams/watchers; do not delete sandbox or Volume                                       | NATIVE policy                                                | S      |
| `Sandbox.init()`                          | omit; provider creation already binds Workspace/session to the remote instance                      | NATIVE policy                                                | S      |
| `Sandbox.executeIsolatedCode()`           | omit and do not advertise `isolated-code` in the first adapter                                      | OMIT / OUT-OF-SCOPE                                          | —      |
| `Sandbox.dispose()`                       | same owned local-resource release as pair disposal; idempotent                                      | NATIVE policy                                                | S      |
| `Workspace.root` / runtime cwd            | constant `/workspace`; create/mount it                                                              | NATIVE policy                                                | S      |
| `readFile()`                              | `sandbox.fs.read(abs)`                                                                              | NATIVE                                                       | S      |
| `readBinaryFile()`                        | `new Uint8Array(await (await fs.readBinary(abs)).arrayBuffer())`                                    | NATIVE                                                       | S      |
| `writeFile()`                             | `sandbox.fs.write(abs, data)`                                                                       | NATIVE                                                       | S      |
| `writeBinaryFile()`                       | `sandbox.fs.writeBinary(abs, data)`                                                                 | NATIVE                                                       | S      |
| `readFileWithStat()`                      | parallel native read + `stat` helper, with cache/version guard                                      | EXEC-SHIM                                                    | M      |
| `writeFileWithStat()`                     | native write then `stat` helper                                                                     | EXEC-SHIM                                                    | M      |
| `writeBinaryFileWithStat()`               | native binary write then `stat` helper                                                              | EXEC-SHIM                                                    | M      |
| `unlink()`                                | validate/root guard, enumerate descendants, `sandbox.fs.rm(abs, true)`                              | NATIVE + safety wrapper                                      | M      |
| `readdir()`                               | `sandbox.fs.ls(abs)`; map files/subdirectories to `Entry[]`                                         | NATIVE                                                       | S      |
| `stat()`                                  | bounded `stat` guest process; SDK metadata is incomplete for directories                            | EXEC-SHIM                                                    | M      |
| `mkdir(..., {recursive:false})`           | `sandbox.fs.mkdir(abs)`                                                                             | NATIVE                                                       | S      |
| `mkdir(..., {recursive:true})`            | bounded, quoted `mkdir -p -- path` process                                                          | EXEC-SHIM                                                    | S      |
| `rename()`                                | bounded, quoted `mv -- from to` process                                                             | EXEC-SHIM                                                    | M      |
| `watch()` adapter mutations               | shared local broadcaster                                                                            | NATIVE adapter behavior                                      | M      |
| `watch()` arbitrary guest mutations       | one `fs.watch('/workspace/**', ..., {withContent:false})` stream                                    | NATIVE, lossy rename mapping                                 | L      |
| watcher `subscribe()` / unsubscribe       | listener set around the one shared source; unsubscribe removes only that listener                   | NATIVE adapter behavior                                      | S      |
| watcher `whenReady()`                     | omit until connection readiness can be observed honestly, or return `{ok:false}` on refused startup | SDK readiness NOT-POSSIBLE                                   | M      |
| watcher `close()`                         | close native handle once, clear listeners, stop reconnect                                           | NATIVE                                                       | S      |
| `notifyExternalChange()`                  | shared broadcaster control event                                                                    | NATIVE adapter behavior                                      | S      |
| `Workspace.fsCapability`                  | `best-effort`; native stream has reconnect/readiness gaps                                           | NATIVE policy                                                | S      |
| `Sandbox.exec()` start                    | `process.exec({name, command, workingDir, env, waitForCompletion:false})`                           | NATIVE                                                       | M      |
| exact terminal stdout/stderr              | terminal `process.get(name).stdout/.stderr`                                                         | NATIVE, unbounded transfer                                   | M      |
| incremental stdout/stderr callbacks       | `process.streamLogs(name, callbacks)`                                                               | NATIVE best-effort; exact byte/newline fidelity NOT-POSSIBLE | L      |
| exec exit/status                          | abort-aware polling with `process.get(name)`                                                        | NATIVE                                                       | M      |
| exec external cancel                      | pre/post-launch abort checks plus `process.kill(name)`                                              | EXEC-SHIM, best effort                                       | L      |
| exec timeout                              | host timer + `process.kill(name)`, return 124                                                       | EXEC-SHIM                                                    | M      |
| exec output cap                           | cap terminal UTF-8 stdout/stderr locally                                                            | EXEC-SHIM locally; provider-side cap NOT-POSSIBLE            | L      |
| exec heartbeat                            | host interval matching Vercel behavior                                                              | NATIVE adapter behavior                                      | S      |
| generic `FileSearch.search()`             | existing `createServerFileSearch()` uses bounded guest `find`                                       | EXEC-SHIM                                                    | S      |
| optional optimized search                 | add provider adapter seam to use `sandbox.fs.find()`                                                | NATIVE, defer optimization                                   | M      |
| provisioning `workspaceFs`                | native fs plus safe helper/process and host upload loop                                             | NATIVE + EXEC-SHIM                                           | L      |
| provisioning `exec()`                     | call the same bounded Sandbox exec adapter                                                          | EXEC-SHIM                                                    | M      |
| provisioning `workspaceFs.exists()`       | bounded `stat` helper; translate ENOENT to false only                                               | EXEC-SHIM                                                    | S      |
| provisioning `workspaceFs.rm()`           | native `fs.rm(path, true)` with approved absolute provisioning path                                 | NATIVE                                                       | S      |
| provisioning `workspaceFs.mkdir()`        | recursive mkdir helper                                                                              | EXEC-SHIM                                                    | S      |
| provisioning `workspaceFs.writeText()`    | native `fs.write()`                                                                                 | NATIVE                                                       | S      |
| provisioning `workspaceFs.readText()`     | native `fs.read()`, returning null only for ENOENT                                                  | NATIVE                                                       | S      |
| provisioning `workspaceFs.copyFromHost()` | approved host walk plus native binary/tree uploads                                                  | NATIVE + host orchestration                                  | L      |
| provisioning `resolveInstallSource()`     | existing content-addressed pack/upload/cache algorithm                                              | NATIVE + host orchestration                                  | M      |
| provisioning cache root                   | stable path on mounted `/workspace`, e.g. `/workspace/.boring/cache`                                | NATIVE policy                                                | S      |
| standby reconnect                         | `SandboxInstance.get(storedName)`; first request wakes standby                                      | NATIVE                                                       | M      |
| deletion recovery                         | recreate sandbox with same attached Volume                                                          | NATIVE with Volume; NOT-POSSIBLE for lost base fs            | L      |
| snapshot restore                          | `fork()` to a new name only                                                                         | PRIVATE PREVIEW; omit from MVP                               | —      |
| hot Drive attach                          | `sandbox.drives.mount()`                                                                            | PRIVATE PREVIEW/403; omit                                    | —      |
| region selection                          | create `region`; optional `listLocations()`/`getConfiguration()` diagnostics                        | NATIVE                                                       | S      |

## Flagged gaps: exact resolution and sketches

The sketches are structural, not copy-paste implementations. Production code
must use shared quoting, bounded process, error, and cache helpers rather than
inline one-offs.

### `stat`: EXEC-SHIM

`fs.ls()` cannot satisfy `Stat`: it has size/lastModified for files but only name
and path for subdirectories. The lower-level filesystem GET similarly cannot
provide an exact arbitrary directory mtime through the high-level SDK. A parent
listing would also mishandle root, symlinks, and directories.

Use a qualified image with `sh` and a known `stat` implementation. Prefer a
machine-readable helper with an argv-safe wrapper; if using shell, quote every
path and parse strictly:

```ts
async function statPath(absPath: string): Promise<Stat> {
  const result = await execHelper(
    `stat -Lc '%s\\n%Y\\n%F' -- ${shellQuote(absPath)}`,
    { timeoutMs: 10_000, maxOutputBytes: 8 * 1024 },
  );
  const [sizeText, secondsText, type, extra] = decode(result.stdout)
    .trim()
    .split("\n");
  if (extra !== undefined) throw invalidProviderOutput("stat");
  const size = Number(sizeText);
  const seconds = Number(secondsText);
  if (!Number.isSafeInteger(size) || !Number.isFinite(seconds)) {
    throw invalidProviderOutput("stat");
  }
  return {
    size,
    mtimeMs: seconds * 1_000,
    kind: type.includes("directory") ? "dir" : "file",
  };
}
```

Preflight the exact syntax because GNU and BusyBox variants differ. If the
chosen image does not satisfy it, fail creation with a stable image/preflight
error rather than returning guessed metadata. Cache `stat` and `readdir` for 15
seconds with the Vercel adapter's maximum 512 entries and metadata-version race
guard. Preserve ENOENT/ENOTDIR mapping.

### Rename: EXEC-SHIM

There is no SDK `mv`, `move`, or `rename`. Use the guest `mv` binary with both
paths independently validated under `/workspace`:

```ts
async function rename(fromRelPath: string, toRelPath: string): Promise<void> {
  const from = resolveWorkspacePath(fromRelPath);
  const to = resolveWorkspacePath(toRelPath);
  await assertMutationPathSafe(from, { allowRoot: false });
  await assertDestinationParentSafe(to);
  await execHelper(`mv -- ${shellQuote(from)} ${shellQuote(to)}`, {
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });
  invalidateMetadata();
  broadcast({ op: "rename", oldPath: fromRelPath, path: toRelPath });
}
```

`mv` normally uses `rename(2)` within one filesystem, but may copy/delete across
mounts. Keep every Workspace path on the one `/workspace` mount. The Workspace
contract does not promise atomicity; tests should still pin overwrite and failure
behavior so SDK/image upgrades cannot silently change it.

### Recursive mkdir: EXEC-SHIM

The second `fs.mkdir` argument is permissions, not recursion. Do not rely on
undocumented server behavior:

```ts
async function mkdir(
  relPath: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  const absPath = resolveWorkspacePath(relPath);
  if (opts?.recursive) {
    await execHelper(`mkdir -p -- ${shellQuote(absPath)}`, {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
  } else {
    await remote.fs.mkdir(absPath);
  }
  invalidateMetadata();
  broadcast({ op: "mkdir", path: relPath });
}
```

### Cancellation: EXEC-SHIM with provider-network caveat

`ProcessRequest` has no signal. `streamLogs().close()` does not kill a process,
and the callback form of `exec()` does not expose its close handle soon enough.
Use a unique process name, register the abort listener before launch, start the
process nonblocking, and re-check abort immediately after launch to close the
race:

```ts
const name = createSafeProcessName();
let identifier = name;
let launchSettled = false;
const aborted = createDeferred<never>();

const kill = async () => {
  try {
    await remote.process.kill(identifier);
  } catch (error) {
    if (launchSettled && !isAlreadyExitedOrNotFound(error)) throw error;
  }
};

const onAbort = () => {
  // Make rejection win synchronously; cleanup is separately bounded/observed.
  aborted.reject(options.signal?.reason ?? createAbortError());
  void (async () => {
    await settleWithin(kill(), KILL_GRACE_MS);
    closeOwnedLogTransports();
  })().catch(recordCancellationFailure);
};
options.signal?.addEventListener("abort", onAbort, { once: true });

try {
  if (options.signal?.aborted) throw options.signal.reason;
  const started = await remote.process.exec({
    name,
    command: `sh -c ${shellQuote(cmd)}`,
    env: options.env,
    workingDir: validateExecCwd(options.cwd),
    keepAlive: true,
    // Provider seconds are a secondary fuse; the host timer below is normative.
    timeout: Math.max(1, Math.ceil(effectiveTimeoutMs / 1_000)),
    waitForCompletion: false,
  });
  launchSettled = true;
  identifier = started.pid ?? name;
  if (options.signal?.aborted) {
    await kill();
    throw options.signal.reason;
  }
  const collecting = collectUntilTerminal(identifier, options).then(
    (result) => {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? createAbortError();
      }
      return result;
    },
  );
  return await Promise.race([collecting, aborted.promise]);
} finally {
  options.signal?.removeEventListener("abort", onAbort);
}
```

Use a host timer for exact `timeoutMs`; on expiry call `kill()` and return exit
124 only after the kill attempt/terminal observation is bounded. Do not rely on
Blaxel `timeout`: it is seconds, and without `keepAlive` it does not kill. Avoid
blind retries of process creation because a lost response may still have launched
the command. Retry idempotent `get()`/log connection operations only.

External abort remains best effort across a provider/network partition. Tests
must cover abort before launch, during launch, during running, already-exited kill,
kill failure, and timeout/abort precedence. In every external-abort case the
caller observes rejection with `signal.reason`; a killed-process exit result must
not win the race. The abort path bounds/records kill failure, closes log transport,
and then rejects.

### Output limit: local EXEC-SHIM; provider-side hard cap NOT-POSSIBLE

Do **not** build `ExecResult` from `process.streamLogs()`. The installed runtime
splits its line protocol on CR/LF, strips `stdout:`/`stderr:` prefixes, drops blank
lines, and does not restore delimiters. For example, `a\nb\n` can arrive as `a`,
`b` and become `ab`. Exact incremental bytes, blank lines, and the final newline
are unrecoverable through this high-level callback API.

Build the returned result from the terminal process response instead:

```ts
const terminal = await waitForTerminalWithGet(identifier);
const capped = capUtf8Outputs({
  stdout: terminal.stdout,
  stderr: terminal.stderr,
  maxBytes: options.maxOutputBytes ?? 1024 * 1024,
  // Deterministic allocation because terminal fields no longer expose interleave.
  order: "stdout-then-stderr",
});

return {
  stdout: capped.stdout,
  stderr: capped.stderr,
  exitCode: terminal.exitCode,
  truncated: capped.truncated,
  stdoutEncoding: "utf-8",
  stderrEncoding: "utf-8",
  durationMs,
};
```

Count encoded UTF-8 bytes across both fields, retain a partial final chunk, and
set `truncated: true`. Reaching the cap must not change command semantics by
killing it. Because terminal fields do not preserve stdout/stderr interleaving,
the adapter must pin and test a deterministic allocation rule; stdout-then-stderr
is proposed above.

For the first adapter, do not invoke `onStdout`/`onStderr` from the lossy line
stream and imply byte fidelity. The exact Boring incremental-callback semantics
are **NOT-POSSIBLE** through the 0.3.11 high-level API. If product UX requires a
best-effort line stream, expose that only after an explicit contract/capability
decision; do not make it the returned result. A future raw streaming endpoint or
SDK fix can close this gap.

The remaining limitation is real: Blaxel 0.3.11 exposes no output-limit request
field. `process.get()` returns full stdout/stderr/log fields, and its log stream is
text/line oriented. Even if Boring stores and emits only the capped prefix, the
provider may retain full logs and the SDK must transfer/parse an unbounded
terminal response before local truncation. `get()`/`wait()` also expose no
lightweight status-only response, so polling may repeatedly transfer growing
output; use an adaptive bounded interval and open an upstream status-only request.

Mitigations:

- do not call `process.logs()` for the final result;
- discard the duplicate combined `logs` field immediately;
- cap terminal stdout/stderr immediately after the unavoidable response transfer;
- close the stream after terminal status or adapter disposal;
- cap every helper command separately;
- open an upstream Blaxel request for provider-side byte limits/lightweight
  status responses;
- do not advertise “hard upstream output containment.”

Add regression cases for `a\nb\n`, blank lines, no-final-newline, multibyte UTF-8
split boundaries, stdout/stderr over the shared cap, and output much larger than
the local cap. Production safety must retain the SDK limitation until a raw or
provider-capped path is proven.

Killing the process when the cap is reached is a possible emergency policy, but
it is not the current Boring contract or Vercel behavior and is not recommended
without an explicit contract decision.

### Native watch: NATIVE with resync degradation

Create one lazy shared watch stream per Workspace:

```ts
const handle = remote.fs.watch(
  "/workspace/**",
  (event) => {
    const rel = normalizeWatchPath(event.path, event.name);
    switch (event.op) {
      case "CREATE":
        return broadcastClassifiedCreate(rel);
      case "WRITE":
        return broadcast({ op: "write", path: rel });
      case "REMOVE":
        return broadcast({ op: "unlink", path: rel });
      case "RENAME":
        return resync("blaxel_rename_missing_old_path");
      case "CHMOD":
        return resync("blaxel_unmapped_chmod");
    }
  },
  { withContent: false, onError: () => resync("blaxel_watch_error") },
);
```

`CREATE` does not say file vs directory in the declared event. Classify with a
bounded stat call or emit a resync if classification races. Deduplicate events
originated by adapter methods so local broadcaster plus native stream do not
double-notify. Because the SDK gives no ready callback, implement `whenReady()`
as false/unavailable until the stream has delivered an explicit connected signal,
or omit it rather than promise readiness. On stream error, issue
`resync-required`; a reconnect loop needs bounded exponential backoff and must
stop permanently after Workspace close.

### Durable handle: NATIVE Blaxel reconnect, required Boring store change

The public handle currently is:

```ts
interface SandboxHandleRecord {
  workspaceId: string;
  sandboxId: string;
  snapshotId?: string;
  createdAt: string;
  lastUsedAt: string;
}
```

Store the stable Blaxel sandbox **name** in `sandboxId`. Derive it deterministically
from workspace ID, e.g. `boring-${sha256(workspaceId).slice(0, 32)}`, and use a
similarly safe external ID as a diagnostic secondary index. `get(name)` is the
authoritative reconnect, including after standby.

Core currently blocks correct reuse:
`WorkspaceRuntimeSandboxHandleStore` hard-codes this selector for get/delete/list:

```ts
const SANDBOX_RESOURCE = {
  kind: "sandbox",
  purpose: "main",
  provider: "vercel",
};
```

Its `put()` can write another provider, but `get()` will never retrieve it. Make
the store provider-scoped without changing the generic public record:

```ts
class WorkspaceRuntimeSandboxHandleStore implements SandboxHandleStore {
  constructor(
    private readonly store: WorkspaceRuntimeStore,
    private readonly provider: "vercel" | "blaxel" = "vercel",
  ) {}

  private selector(): WorkspaceRuntimeResourceSelector {
    return {
      kind: "sandbox",
      purpose: "main",
      provider: this.provider,
    };
  }
}
```

`WorkspaceRuntimeResourceSelector` has exactly `kind`, `purpose`, and `provider`;
workspace ID remains the separate argument to store `get`/`delete`. Core must
resolve the selected runtime mode **before** constructing its default store, then
choose `vercel` for `vercel-sandbox` and `blaxel` for Blaxel.
Test that identical workspace IDs can hold both provider records without collision
and that put/get/list/delete stay within the selected provider.

```ts
const selectedMode =
  options.mode ?? getEnv("BORING_AGENT_MODE") ?? autoDetectMode();
const handleProvider =
  selectedMode === "blaxel"
    ? "blaxel"
    : selectedMode === "vercel-sandbox"
      ? "vercel"
      : undefined;
const sandboxHandleStore =
  options.sandboxHandleStore ??
  (handleProvider
    ? new WorkspaceRuntimeSandboxHandleStore(workspaceStore, handleProvider)
    : undefined);
```

A caller-supplied store is scoped to that one selected runtime mode. Standalone
file-store defaults must use a Blaxel-specific file/namespace rather than sharing
Vercel's workspace-ID-only JSON file.

Normal pair disposal must only release local watch/log resources. It must not
delete a remotely durable sandbox or Volume. `provider.invalidate()` evicts local
cached handles and in-flight state. There is no destructive-delete method in
`SandboxProviderV1`; resource destruction remains an explicit administrative/TTL
operation.

On resume:

1. load provider-scoped handle;
2. `SandboxInstance.get(record.sandboxId)`;
3. verify expected external ID, region, image policy, and Volume binding;
4. ensure `/workspace` is accessible;
5. update `lastUsedAt` without changing `createdAt`;
6. retry one idempotent lookup on a documented transient transport error;
7. on missing/terminated sandbox, recreate with the same Volume if configured;
8. without a Volume, fail with a stable expired/data-loss error rather than
   silently presenting an empty workspace as a resume.

Because a Volume can be attached to only one sandbox and cannot be detached,
recreation must also handle the provider's termination/release window. Poll the
old sandbox to a bounded terminal/not-found condition before create, then surface
a stable retryable “volume still attached” error if Blaxel has not released the
binding. Never resolve that race by deleting the Volume.

`VolumeInstance` does not expose the underlying `state` getter. Add the installed
low-level generated call to the client facade:

```ts
getVolume<ThrowOnError extends boolean = false>(
  options: Options<GetVolumeData, ThrowOnError>,
): RequestResult<Volume, _Error, ThrowOnError>

// Volume.state?.attachedTo is "sandbox:<name>" while bound and empty when free.
```

Bounded-poll `data.state?.attachedTo` until empty before recreate. If it remains
attached, return `BLAXEL_VOLUME_BUSY` with retryable context. A separate explicit
live-smoke cleanup must also wait for `attachedTo` to clear after sandbox deletion
before deleting the Volume.

### Full provisioning lifecycle

Use these exact environment keys and defaults:

| Key                                  | Requirement/default                 | Handling                                                                 |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `BL_WORKSPACE`                       | required                            | Blaxel workspace name; log presence only                                 |
| `BL_API_KEY`                         | required                            | secret; never log, persist, or include in an error                       |
| `BORING_BLAXEL_IMAGE`                | `blaxel/base-image:latest`          | image policy input                                                       |
| `BORING_BLAXEL_MEMORY_MB`            | `4096`                              | bounded positive integer                                                 |
| `BORING_BLAXEL_REGION`               | required for persistent Volume mode | explicit region; do not default `auto` for a regional Volume             |
| `BORING_BLAXEL_VOLUME_SIZE_MB`       | `2048`                              | positive integer; Volume enabled by default for the durable runtime mode |
| `BORING_BLAXEL_TTL`                  | unset                               | sandbox max-age string; deletion policy                                  |
| `BORING_BLAXEL_IDLE_TTL`             | unset                               | produces a `ttl-idle` lifecycle policy                                   |
| `BORING_BLAXEL_TERMINATED_RETENTION` | provider default                    | lifecycle retention string                                               |

`BlaxelSandboxProviderOptions` is the typed injection seam for tests/embedders:

```ts
interface BlaxelSandboxProviderOptions {
  image: string;
  memoryMb: number;
  region: string;
  ttl?: string;
  lifecycle?: SandboxLifecycle;
  volume?: { enabled: boolean; sizeMb: number };
  workspaceRoot?: "/workspace";
  handleStore: SandboxHandleStore;
}
```

Credentials are not constructor arguments in the SDK. Official docs and 0.3.11
load `BL_WORKSPACE` and `BL_API_KEY` from environment/CLI state. Add them to env
validation and examples, never log their values, and abstract SDK calls behind a
small client facade so unit tests need no process-global credentials.

Add stable `ErrorCode` values `BLAXEL_AUTH_FAILED`, `BLAXEL_API_ERROR`,
`BLAXEL_CONFIG_DRIFT`, `BLAXEL_RUNTIME_UNQUALIFIED`, and
`BLAXEL_VOLUME_BUSY`. Reuse `CONFIG_INVALID` for local syntax/range errors,
`SANDBOX_EXPIRED` for a missing non-Volume sandbox, and `ABORTED` for external
exec cancellation. Normalize provider messages through a redactor for API keys,
authorization headers, workspace identifiers where sensitive, and absolute host
paths before surfacing/logging them.

Creation order:

```ts
const sandboxName = stableSandboxName(workspaceId);
const volumeName = stableVolumeName(workspaceId);

if (config.volume.enabled) {
  const volume = await VolumeInstance.createIfNotExists({
    name: volumeName,
    size: config.volume.sizeMb,
    region: config.region,
  });
  assertVolumeCompatible(volume, config);
}

const remote = await SandboxInstance.createIfNotExists({
  name: sandboxName,
  externalId: stableExternalId(workspaceId),
  image: config.image,
  memory: config.memoryMb,
  region: config.region,
  ttl: config.ttl,
  lifecycle: config.lifecycle,
  labels: { owner: "boring-ui", workspace: stableLabel(workspaceId) },
  volumes: config.volume.enabled
    ? [{ name: volumeName, mountPath: "/workspace", readOnly: false }]
    : undefined,
});

if (!config.volume.enabled) await remote.fs.mkdir("/workspace");
await preflightRuntime(remote); // /workspace, sh, stat, mv, mkdir, runtime tools
```

`createIfNotExists()` does not prove configuration compatibility. Verify the
reused sandbox/Volume against immutable region, image policy, memory, and binding.
Return stable configuration errors for drift; do not delete or mutate existing
resources automatically.

It also does not tell the caller whether this invocation created or reused the
sandbox. Never infer “new workspace” from that method. Persist
`/workspace/.boring/provisioning/template.json` on the Volume with the template
fingerprint and provisioning schema version. Rules:

1. marker matches: resume/recreated compute must not reseed;
2. marker absent and `/workspace` is otherwise empty: stage seed content under a
   unique temporary directory, move it into place, then atomically rename the
   marker last;
3. marker absent with user content: fail `BLAXEL_CONFIG_DRIFT`; do not overwrite;
4. marker fingerprint differs: fail `BLAXEL_CONFIG_DRIFT` and require an explicit
   migration; do not merge templates over user edits;
5. interrupted seed without marker is cleaned/retried only inside the adapter's
   owned staging path.

Template seeding and runtime provisioning should reuse the existing generic
provisioning engine. Implement `copyFromHost` by enumerating the already-approved
host source, creating directories, and uploading bounded files with
`writeBinary`/`writeTree`. Preserve the Vercel adapter's content-addressed
`resolveInstallSource`, cache root, and shell-argument separation. A persistent
cache must live under the mounted `/workspace`; do not put host session history
there. Per AGENTS rule 9, host Pi transcripts remain in
`BORING_AGENT_SESSION_ROOT` (normally `/data/pi-sessions`).

TTL policy must be explicit:

- standby is automatic and does not require TTL;
- `ttl`/expiration can delete the sandbox;
- with a Volume, deletion recovery may recreate compute around persistent files;
- without a Volume, expiration is data loss and must not masquerade as resume;
- Volume deletion is never coupled to pair disposal or routine sandbox expiry.

## Runtime-mode and package registration

The requested five edits are necessary but not sufficient. Implement in these
slices so each commit remains type-checkable and testable.

### Slice 1: provider identity and package surface

1. Add `"blaxel"` to `SandboxProviderId`, `RuntimeModeId`,
   `PROVIDER_CAPABILITIES`, and `MODE_TO_PROVIDER` in `providerMatrix.ts`.
2. Add it to `ExtractedSandboxProviderIdV1`, `SandboxRuntimeModeIdV1`, and hence
   provisioning mode support in `providerV1.ts`.
3. Add Blaxel options/static registration in
   `packages/boring-sandbox/src/providers/static.ts` and exports in
   `src/providers/index.ts`.
4. Add `src/providers/blaxel/` with:
   - `config.ts` and strict validation;
   - `errors.ts` and stable normalization;
   - `client.ts` facade over `@blaxel/core` for deterministic mocks;
   - `createBlaxelSandboxWorkspace.ts`;
   - `createBlaxelSandboxExec.ts`;
   - `createBlaxelSandboxProvider.ts`;
   - `resolveSandboxHandle.ts`;
   - `provisioningAdapter.ts`;
   - `index.ts`.
5. Add `./providers/blaxel` to `packages/boring-sandbox/package.json`, the tsup
   entry, and `scripts/check-invariants.mjs`.
6. Move/add `@blaxel/core@0.3.11` as a production dependency of
   `@hachej/boring-sandbox`, the package that imports it; update the lockfile.
   A root-only dependency is not a valid published package dependency.
7. Add test/source aliases only where direct package subpath imports require
   them (`agent`, `core`, CLI/full-app/test configs). Avoid mechanically copying
   Vercel aliases into packages that never import the Blaxel subpath.

### Slice 2: Workspace, exec, and provider pair

1. Extract/reuse Vercel-grade path validation, shell quoting, metadata cache, and
   combined output collector instead of cloning divergent versions.
2. Implement every required Workspace method and optional binary/with-stat
   methods from the mapping table.
3. Add local mutation broadcaster first; add native watch with dedup/resync and
   one underlying stream.
4. Implement named-process exec, polling, stream collection, heartbeat,
   timeout/cancel kill, cwd validation, and `finally` metadata invalidation.
5. Implement pair health and disposal ownership. Ensure construction failure
   closes any partially created local resources while preserving the original
   error.
6. Keep generic `createServerFileSearch()` for v1. A later optimization may add
   an optional provider `FileSearch` factory and use native `fs.find()`. Native
   search exists, but changing that seam is not required for contract parity.

### Slice 3: durable lifecycle and provisioning

1. Generalize `WorkspaceRuntimeSandboxHandleStore` to a provider-scoped selector.
2. Thread a `blaxel` store from
   `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` through
   `packages/agent/host/sandbox.ts` into the provider.
3. Implement stable names, in-process cache/in-flight convergence, get/resume,
   create, handle timestamps, health, and Volume-backed recreate.
4. Implement Volume creation/validation and `/workspace` attachment before
   sandbox creation.
5. Add template seeding and `SandboxProvisioningOperationsV1`; only then set
   `provisioningSupport: true`.
6. Add an explicit administrative resource cleanup script only if separately
   requested. Do not overload pair `dispose()` with deletion.

### Slice 4: runtime mode and application wiring

1. Add `packages/agent/src/server/runtime/modes/blaxel.ts`, mirroring the generic
   provider adapter shape:

   ```ts
   createProviderRuntimeModeAdapter({
     id: "blaxel",
     provider,
     runtimeHost,
     workspaceFsCapability: "best-effort",
     bash: { kind: "remote" },
     filesystem: { kind: "remote-workspace" },
     readiness: {/* stable provider preflight */},
   });
   ```

   Blaxel has no legacy Vercel root alias, so the actual filesystem entry is
   `filesystem: { kind: 'remote-workspace' }`; add a `RuntimeRemoteWorkspacePathOptions`
   mapper only if a distinct host-visible alias is introduced. Likewise use
   `bash: { kind: 'remote' }` unless the selected image policy supplies a
   verified safe default PATH.

   Do not configure `healthCheckIntervalMs` initially. A 15-second
   `fs.ls('/workspace')` check would create activity and can prevent standby or
   repeatedly wake it. If `pair.checkHealth()` is retained for on-demand use,
   use control-plane `SandboxInstance.get(name)`, and enable a periodic cached
   binding check only after a live qualification proves it does not wake compute
   or create unacceptable cost.

2. Extend `BuiltinRuntimeModeId` and `providerAdapter.ts`'s closed ID union.
3. Extend `resolveMode.ts` builtin recognition and its env error text. This file
   selects an injected adapter; it does not own durable handles.
4. Add config-schema runtime enum and Blaxel env/config validation.
5. Export the mode from `packages/agent/src/server/index.ts`; extend agent host
   layout root and construction switch; update `test-host/sandbox.ts`.
   Widen `packages/agent/e2e/helpers/backend.ts` and its mode tests as well.
6. Extend `packages/agent/src/server/workspace/provisioning/types.ts`.
7. Replace the closed casts/unions in core capabilities, core server assembly,
   CLI mode app construction, and workspace server construction with the new
   builtin type or add `blaxel` explicitly.
8. Update host durable session-root inference: Blaxel is another remote sandbox
   mode, but host session history still belongs under `/data/pi-sessions`, never
   `/workspace` or a sandbox home directory.
9. Review remote-mode plugin discovery/bypass conditions currently written only
   for Vercel. Express them by placement/capability or include Blaxel explicitly.
10. Update runtime/package docs, `.env.example`, and deploy docs.
11. `apps/full-app/src/server/productionSafety.ts` currently allows only
    `vercel-sandbox`. Do **not** silently add Blaxel. Add it to the production-safe
    allowlist only after live conformance, persistent Volume recovery, and a
    documented security decision pass; until then it remains opt-in behind the
    existing unsafe override.

The source scan found the concrete non-document production surfaces which need a
decision or edit: `packages/agent/host/sandbox.ts`,
`packages/agent/test-host/sandbox.ts`, `packages/agent/e2e/helpers/backend.ts`,
`packages/agent/src/server/runtime/{mode.ts,resolveMode.ts}`,
`packages/agent/src/server/runtime/modes/providerAdapter.ts`,
`packages/agent/src/server/workspace/provisioning/types.ts`,
`packages/agent/src/server/index.ts`, `packages/cli/src/server/modeApps.ts`,
`packages/core/src/{shared/types.ts,app/server/createCoreWorkspaceAgentServer.ts}`,
`packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, and
`apps/full-app/src/server/productionSafety.ts`. Re-run the source scan during
implementation; tests, build aliases, env examples, and docs deliberately add a
larger update set.

## Test and proof plan

### Static and unit tests, no credentials

Use a typed fake client at the new facade boundary. Tests must not read
`BL_API_KEY`, instantiate a live SDK connection, or depend on order-sensitive
global SDK configuration.

1. Provider matrix tests:
   - exhaustive IDs/mode mapping;
   - capability values and contract version;
   - static provider resolution/export/build invariant.
2. Path and filesystem tests:
   - all existing Workspace conformance cases;
   - binary round trips and Blob conversion;
   - file and directory stat parsing, malformed output, ENOENT, symlink behavior;
   - recursive and nonrecursive mkdir;
   - rename overwrite/error behavior and shell metacharacter filenames;
   - root deletion EPERM, descendant unlink events, and path escape corpus;
   - `stat`/`readdir` 15-second cache, 512-entry eviction, clone safety,
     mutation invalidation, and in-flight version race;
   - prove `fs.cp()` is never called for caller-controlled paths.
3. Watch tests:
   - repeated `watch()` shares one native stream;
   - unsubscribe leaves it alive, close is idempotent, post-close subscribe no-op;
   - CREATE/WRITE/REMOVE mapping;
   - RENAME/CHMOD/error emits resync rather than fabricated fields;
   - local/native duplicate suppression;
   - bounded reconnect stops on close.
4. Exec tests:
   - all Sandbox conformance cases;
   - stdout/stderr combined cap and partial UTF-8 final chunk;
   - terminal output preserves `a\nb\n`, blank lines, no-final-newline, and
     multibyte UTF-8 boundaries;
   - pin the stdout-then-stderr local budget rule;
   - prove v1 does not invoke lossy `streamLogs` callbacks as if byte-exact;
   - nonzero exit, text encodings, cwd and env;
   - abort before launch, launch race, running abort, already-exited process;
   - timeout kills then returns 124; external abort rejects with the exact
     `signal.reason`, even when a killed terminal result races it;
   - heartbeat; stream error; poll transient; kill failure;
   - output cap does not kill the command;
   - no accidental retry of a possibly launched command.
5. Durable store and lifecycle tests:
   - Vercel behavior remains unchanged after store generalization;
   - same workspace ID has isolated Vercel and Blaxel records;
   - stable name/external ID derivation and collision resistance;
   - concurrent create convergence;
   - stored `get()` resume and `lastUsedAt` refresh;
   - standby-like reconnect uses the same name;
   - missing sandbox + Volume recreates compute and preserves mounted files;
   - recreation polls low-level `Volume.state.attachedTo`, succeeds after detach,
     and returns `BLAXEL_VOLUME_BUSY` on bounded timeout;
   - missing sandbox without Volume returns stable data-loss/expired error;
   - incompatible region/image/volume refuses mutation;
   - pair disposal and invalidate never call sandbox/Volume delete.
6. Provisioning tests:
   - first empty Volume seed writes the marker last;
   - matching marker resumes/recreates without reseeding user-edited files;
   - missing/mismatched marker with content fails drift, and interrupted owned
     staging is safely retried;
   - host file copy, cache root, Node and Python install source;
   - source path validation and bounded upload;
   - provider pair advertises provisioning only when the adapter exists;
   - dual-target parity suite adds Blaxel.
7. Mode/application tests:
   - `BORING_AGENT_MODE=blaxel` resolution and missing env failures;
   - `/workspace` runtime pairing and remote workspace/bash operations;
   - capability response, CLI/test-host wiring, plugin policy, and session-root
     inference;
   - agent e2e helper accepts the Blaxel mode;
   - no 15-second filesystem health probe is configured;
   - production safety stays blocked until the explicit gate is approved.

Use the existing shared suites at
`packages/agent/src/__tests__/conformance/workspace.ts` and
`sandbox.ts`. Add Blaxel fake harnesses under the provider package, mirroring
`vercelSandboxWorkspace.conformance.test.ts`, and extend
`dualTargetParity.test.ts` only after provisioning exists.

### Credential-gated live smoke

Extend or add `scripts/blaxel-adapter-smoke.mjs` based on
[`scripts/blaxel-spike.mjs`](../../../scripts/blaxel-spike.mjs). It must be
explicitly opt-in and skip cleanly unless both `BL_WORKSPACE` and `BL_API_KEY`
are present. CI PR jobs remain static; a protected scheduled/release environment
may run live qualification.

The smoke should:

1. derive a unique sandbox and Volume name and record cleanup targets;
2. create Volume, create sandbox from configured image/memory/region, mount it at
   `/workspace`, and verify the configured lifecycle fields;
3. run Workspace conformance operations, including stat shim, recursive mkdir,
   quoted rename, binary file, root deletion rejection, and native watch;
4. run Sandbox conformance: exit code, cwd/env, separated stdout/stderr,
   heartbeat, 1 KiB truncation, timeout kill, and external abort kill;
5. release connections, wait past standby, reconnect with `get(name)`, and prove
   the same file remains; verify the chosen on-demand health lookup does not wake
   compute before considering any periodic check;
6. explicitly delete only the sandbox, recreate it with the same Volume, and
   prove the file remains after low-level `state.attachedTo` clears;
7. delete the smoke sandbox, wait for `state.attachedTo` to clear, then delete the
   Volume in a guarded `finally`, printing names but never credentials;
8. emit timings and SDK/version/config metadata with secret redaction.

Do not test Agent Drive or snapshots in the required smoke. They are preview
features and would make the adapter gate entitlement-dependent. The existing
spike is retained as historical lifecycle evidence; it already proved create,
exec, `/workspace` I/O, standby wake, and delete against the live service.

### Quality gates

Run, at minimum:

```sh
pnpm --filter @hachej/boring-sandbox test
pnpm --filter @hachej/boring-sandbox typecheck
pnpm --filter @hachej/boring-sandbox build
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-core test
pnpm --filter @hachej/boring-core typecheck
pnpm test:boundaries
pnpm typecheck
git diff --check
```

Use the actual package scripts if names differ when implementation starts. Live
smoke is an additional protected gate, never a replacement for deterministic
tests.

## Risks and explicit non-goals

| Risk                                            | Consequence                                                           | Mitigation / gate                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| No provider-side output cap                     | Blaxel/SDK may retain or transfer more output than Boring's local cap | local combined byte cap; avoid full log call; upstream request; document limitation; block any “hard cap” claim |
| No `AbortSignal`                                | kill is a second network call and can race/partition                  | named process, pre/post-launch checks, bounded kill/poll, no exec retry, race tests                             |
| Text/line log streaming                         | byte/newline-exact incremental callbacks cannot be reproduced         | build result from terminal fields; omit lossy callbacks in v1; upstream raw-stream request                      |
| No native stat/rename/recursive mkdir           | depends on guest image tools and quoting                              | controlled image/preflight, strict bounded parsing, shared quote helper, metacharacter tests                    |
| Native rename event lacks `oldPath`             | cannot construct valid fine-grained rename event                      | emit `resync-required`; adapter-originated rename still emits exact event                                       |
| Native watch lacks readiness/reconnect contract | missed events during connection churn                                 | honest readiness, resync on error, bounded reconnect, best-effort capability                                    |
| Frequent filesystem health checks wake compute  | defeats standby and adds cost                                         | no periodic check initially; control-plane/on-demand proof before enabling                                      |
| Base filesystem deleted by expiry               | silent workspace loss if recreated empty                              | persistent Volume for durable mode; stable data-loss error without it                                           |
| Volume is regional, exclusive, create-time only | configuration drift cannot be repaired in place                       | deterministic names, pre-create/verify, fail closed, admin migration procedure                                  |
| Terminated sandbox may still hold its Volume    | immediate compute recreation can conflict on sole attachment          | bounded terminal/release poll; retryable stable error; never delete Volume                                      |
| Reused Volume cannot reveal first create        | template reseed could overwrite user work                             | durable fingerprint marker, empty-root requirement, staged seed, fail drift                                     |
| Handle store is Vercel-scoped today             | Blaxel handles become unreadable/collide                              | provider-scoped selector plus cross-provider tests before provider wiring                                       |
| Snapshot/fork private preview                   | unstable recovery dependency and no in-place restore                  | exclude from MVP; reconsider only behind capability/config gate                                                 |
| Agent Drive private preview/403                 | entitlement-specific failure                                          | exclude; use stable Volume API                                                                                  |
| Docs/SDK drift (`storageMb`, watch wording)     | compile/runtime mismatch                                              | pin 0.3.11, test installed declarations/runtime, upgrade intentionally                                          |
| SDK credentials are process-global env/CLI      | test isolation and multi-tenant credential injection limits           | env validation/redaction; facade mocks; document one Blaxel workspace credential context per host process       |
| Production safety is currently Vercel-only      | premature security approval                                           | keep Blaxel blocked until live conformance, persistence, and security decision pass                             |
| Region availability is policy-dependent         | configured region may be rejected                                     | optional diagnostics via `listLocations`/`getConfiguration`; normalize API error; no stale hard-coded allowlist |

Non-goals for issue 1081:

- Agent Drive support;
- snapshot/fork recovery;
- direct CPU sizing (not in 0.3.11 configuration);
- a false provider-side hard output guarantee;
- automatic destructive migration of mismatched sandbox/Volume resources;
- changing runsc's provider status;
- optimizing generic FileSearch to native `fs.find()` before parity is proven.

## Delivery order, estimates, and gates

| Slice | Scope                                                                            |    Estimate | Exit gate                                    |
| ----- | -------------------------------------------------------------------------------- | ----------: | -------------------------------------------- |
| 1     | shared IDs/capabilities, package export/dependency, client facade, config/errors |     1-1.5 d | package typecheck/build; matrix/static tests |
| 2     | Workspace methods, safety, metadata cache, local broadcaster                     |     1.5-2 d | Workspace conformance + edge tests           |
| 3     | process exec, streams, cap, cancellation, timeout, heartbeat                     |     2-2.5 d | Sandbox conformance + race/fidelity tests    |
| 4     | native watch integration and health/disposal                                     | 0.75-1.25 d | watch ownership/resync/reconnect tests       |
| 5     | provider-scoped durable store, stable handle, Volume/recreate lifecycle          |     1.5-2 d | cross-provider store + lifecycle tests       |
| 6     | provisioning adapter/template/cache integration                                  |     1-1.5 d | provisioning and dual-target parity tests    |
| 7     | agent/core/CLI/full-app wiring, docs, live qualification                         |     1-1.5 d | repository gates + protected live smoke      |

Nominal sum is 8.75-12.25 days; shared helper reuse and parallel review can bring
the practical range to **8-12 days**. Preview features and upstream SDK changes
are excluded. A security review or provider-side API change may add calendar
time.

## Definition of done

- `blaxel` is a complete provider and builtin runtime mode, not a cast-only path.
- Every Workspace and Sandbox conformance test passes against the fake facade.
- The live protected smoke passes create, standby reconnect, cancellation,
  truncation, and Volume-backed compute recreation.
- Vercel behavior and handle records remain green and provider-isolated.
- Capability claims match actual shipped behavior; limitations are visible in
  runtime docs and error output.
- No credential is logged, committed, or required by static tests.
- Pair disposal/invalidation never deletes durable remote state.
- Production safety remains gated until the explicit security/persistence gate is
  accepted.
