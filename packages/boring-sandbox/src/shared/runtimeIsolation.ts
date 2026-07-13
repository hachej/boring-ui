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
