export const RUNTIME_ISOLATION_PROBE_IDS = [
  "sibling-filesystem-traversal",
  "proc-pid-enumeration",
  "cross-sandbox-signal",
  "cross-sandbox-ptrace",
  "mount-access",
  "device-access",
  "process-escape",
  "cross-workspace-network",
  "secret-access",
  "resource-ceilings",
  "teardown",
] as const;

export type RuntimeIsolationProbeId = (typeof RUNTIME_ISOLATION_PROBE_IDS)[number];
export type RuntimeIsolationDigest = `sha256:${string}`;

export const RUNTIME_ISOLATION_ERROR_CODES = {
  invalidInput: "RUNSC_ISOLATION_INVALID_INPUT",
  probeFailed: "RUNSC_ISOLATION_PROBE_FAILED",
  evidenceInvalid: "RUNSC_ISOLATION_EVIDENCE_INVALID",
  profileDrift: "RUNSC_ISOLATION_PROFILE_DRIFT",
} as const;

export type RuntimeIsolationErrorCode =
  (typeof RUNTIME_ISOLATION_ERROR_CODES)[keyof typeof RUNTIME_ISOLATION_ERROR_CODES];

export interface RuntimeIsolationProfileV1 {
  readonly schemaVersion: 1;
  readonly provider: "runsc";
  readonly kernelRelease: string;
  readonly runtimeVersion: string;
  readonly runtimeBinaryDigest: RuntimeIsolationDigest;
  readonly rootfsBinaryDigest: RuntimeIsolationDigest;
  readonly platformMode: "systrap";
  readonly privilegeModel: "sudo-root";
  readonly containerCapabilities: readonly [];
  readonly workloadIdentity: "uid-65532-gid-65532";
  readonly networkPolicy: "isolated-veth-no-default-route";
  readonly cgroupPolicy: {
    readonly version: 2;
    readonly cpuQuotaMicros: 50_000;
    readonly cpuPeriodMicros: 100_000;
    readonly memoryBytes: 134_217_728;
    readonly pidsMax: 64;
  };
  readonly providerConfigDigest: RuntimeIsolationDigest;
  readonly hostPolicyDigest: RuntimeIsolationDigest;
}

export interface RuntimeIsolationEvidenceV1 {
  readonly schemaVersion: 1;
  readonly domain: "boring-runtime-isolation-evidence:v1";
  readonly profile: RuntimeIsolationProfileV1;
  readonly profileDigest: RuntimeIsolationDigest;
  readonly testSuiteDigest: RuntimeIsolationDigest;
  readonly probes: Readonly<Record<RuntimeIsolationProbeId, "passed">>;
  readonly positiveControls: {
    readonly ownMarkerReadable: true;
    readonly attackerEndpointReachableBeforeHostileCalls: true;
    readonly attackerEndpointReachableAfterHostileCalls: true;
    readonly siblingEndpointReachableFromSibling: true;
    readonly siblingCanaryReadableFromSibling: true;
    readonly siblingAliveBeforeHostileCalls: true;
    readonly siblingAliveAfterHostileCalls: true;
  };
  readonly redaction: {
    readonly containsHostPaths: false;
    readonly containsSecrets: false;
    readonly containsHostPids: false;
  };
  readonly evidenceDigest: RuntimeIsolationDigest;
}

export type RuntimeIsolationEvidenceVerification =
  | { readonly status: "accepted"; readonly evidenceDigest: RuntimeIsolationDigest }
  | { readonly status: "rejected"; readonly code: RuntimeIsolationErrorCode; readonly message: string };

/**
 * Schema v2: the docker-launched runsc runtime profile (`docker run --runtime=runsc`).
 *
 * This is an additive sibling of {@link RuntimeIsolationProfileV1}. v1 remains the
 * canonical shape for the direct `sudo`/OCI-bundle qualification (bead ytq,
 * `D1-006A`) and its evidence file stays valid against the v1 parser. v2 exists so
 * the owner-approved docker-runsc production profile can be attested without
 * mislabelling it as the `sudo-root` direct profile. The differences that matter
 * are surfaced as their own literals rather than reusing v1's:
 *   - `launcher: "docker-runsc"` — the container engine, not raw `runsc run`.
 *   - `privilegeModel: "docker-runsc-nonroot"` — unprivileged (docker group), no sudo.
 *   - `networkPolicy: "isolated-internal-bridge-no-default-route"` — two `--internal`
 *     docker bridge networks on distinct /30s, no interconnection or default route.
 * v2 evidence additionally carries an optional cold-start latency section and lets a
 * probe be honestly recorded as `unproven` (with a reason) instead of forcing every
 * probe to `passed`.
 */
export interface RuntimeIsolationProfileV2 {
  readonly schemaVersion: 2;
  readonly provider: "runsc";
  readonly launcher: "docker-runsc";
  readonly privilegeModel: "docker-runsc-nonroot";
  readonly kernelRelease: string;
  readonly runtimeVersion: string;
  readonly runtimeBinaryDigest: RuntimeIsolationDigest;
  readonly rootfsBinaryDigest: RuntimeIsolationDigest;
  readonly platformMode: "systrap";
  readonly containerCapabilities: readonly [];
  readonly workloadIdentity: "uid-65532-gid-65532";
  readonly networkPolicy: "isolated-internal-bridge-no-default-route";
  readonly cgroupPolicy: {
    readonly version: 2;
    readonly cpuQuotaMicros: 50_000;
    readonly cpuPeriodMicros: 100_000;
    readonly memoryBytes: 134_217_728;
    readonly pidsMax: 64;
  };
  readonly providerConfigDigest: RuntimeIsolationDigest;
  readonly hostPolicyDigest: RuntimeIsolationDigest;
}

export type RuntimeIsolationProbeOutcome =
  | { readonly status: "passed" }
  | { readonly status: "unproven"; readonly reason: string };

export type RuntimeIsolationLatencyRuntime = "runsc" | "runc";
export type RuntimeIsolationLatencyCacheState = "warm" | "cold";

export interface RuntimeIsolationColdStartSample {
  readonly runtime: RuntimeIsolationLatencyRuntime;
  readonly cacheState: RuntimeIsolationLatencyCacheState;
  readonly n: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly stdevMs: number;
}

export interface RuntimeIsolationColdStartEvidence {
  readonly image: string;
  readonly imageDigest: RuntimeIsolationDigest;
  readonly command: string;
  readonly methodology: string;
  readonly samples: readonly RuntimeIsolationColdStartSample[];
}

export interface RuntimeIsolationEvidenceV2 {
  readonly schemaVersion: 2;
  readonly domain: "boring-runtime-isolation-evidence:v2";
  readonly profile: RuntimeIsolationProfileV2;
  readonly profileDigest: RuntimeIsolationDigest;
  readonly testSuiteDigest: RuntimeIsolationDigest;
  readonly probes: Readonly<Record<RuntimeIsolationProbeId, RuntimeIsolationProbeOutcome>>;
  readonly positiveControls: {
    readonly ownMarkerReadable: true;
    readonly attackerEndpointReachableBeforeHostileCalls: true;
    readonly attackerEndpointReachableAfterHostileCalls: true;
    readonly siblingEndpointReachableFromSibling: true;
    readonly siblingCanaryReadableFromSibling: true;
    readonly siblingAliveBeforeHostileCalls: true;
    readonly siblingAliveAfterHostileCalls: true;
  };
  readonly coldStartLatency: RuntimeIsolationColdStartEvidence | null;
  readonly redaction: {
    readonly containsHostPaths: false;
    readonly containsSecrets: false;
    readonly containsHostPids: false;
  };
  readonly evidenceDigest: RuntimeIsolationDigest;
}
