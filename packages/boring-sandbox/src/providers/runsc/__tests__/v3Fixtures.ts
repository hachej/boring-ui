// Shared, self-consistent V3 / bundle test fixtures (SBX1.2). Not a test file.

import {
  RUNTIME_ISOLATION_PROBE_IDS,
  RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS,
  buildQualificationBundleManifest,
  createRuntimeIsolationEvidenceV3,
  digestRuntimeIsolationValue,
  type QualificationBundleEntry,
  type QualificationBundleManifest,
  type RuntimeIsolationEvidenceV3,
  type RuntimeIsolationProbeId,
  type RuntimeIsolationProfileV3,
} from "../index";

export const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

export function profileV3(overrides: Partial<RuntimeIsolationProfileV3> = {}): RuntimeIsolationProfileV3 {
  return {
    schemaVersion: 3,
    provider: "runsc",
    launcher: "docker-runsc",
    privilegeModel: "docker-runsc-nonroot",
    hostKernelRelease: "6.14.0-37-generic",
    guestKernelRelease: "4.19.0-gvisor",
    dockerServerVersion: "27.5.1",
    runtimeVersion: "release-20260706.0",
    runtimeBinaryDigest: digest("a"),
    rootfsBinaryDigest: digest("f"),
    platformMode: "systrap",
    containerCapabilities: [],
    workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "none",
    workspaceMountPolicy: "readwrite-workspace-only",
    workspaceQuota: { bytesQuota: 1_073_741_824, inodeQuota: 65_536 },
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    workloadImage: {
      repository: "registry.example/boring-workload",
      repositoryDigest: digest("2"),
      manifestDigest: digest("3"),
      architecture: "amd64",
    },
    dockerRuntimeRegistrationDigest: digest("4"),
    providerConfigDigest: digest("b"),
    hostPolicyDigest: digest("c"),
    ...overrides,
  };
}

export function passedProbes(): Record<RuntimeIsolationProbeId, { status: "passed" }> {
  return Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, { status: "passed" }])) as Record<
    RuntimeIsolationProbeId,
    { status: "passed" }
  >;
}

export function trueControls(): Record<string, true> {
  return Object.fromEntries(RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS.map((k) => [k, true]));
}

export const TEST_SUITE_DIGEST = digest("d");

export function bundleEntries(): QualificationBundleEntry[] {
  return [
    { role: "provider-entry", path: "dist/providers/runsc/index.js", digest: digest("10"), bytes: 4096 },
    { role: "evidence-schema-source", path: "src/shared/runtimeIsolation.ts", digest: digest("11"), bytes: 8192 },
    { role: "evidence-validator-source", path: "src/providers/runsc/isolationEvidence.ts", digest: digest("12"), bytes: 8192 },
    { role: "qualification-script", path: "scripts/qualify-docker-runsc-isolation.mjs", digest: digest("13"), bytes: 27000 },
    { role: "probe-source", path: "scripts/runtime-isolation-probe.c", digest: digest("14"), bytes: 2900 },
    { role: "probe-static-binary", path: "bundle/runtime-isolation-probe", digest: digest("15"), bytes: 16000 },
    { role: "qualification-helper", path: "bundle/busybox", digest: digest("16"), bytes: 800000 },
  ];
}

/** Build a bundle whose cohort pin matches the given profile + test-suite digest. */
export function cohortBundle(
  profile: RuntimeIsolationProfileV3,
  testSuiteDigest = TEST_SUITE_DIGEST,
  cohortId = "gitsha-abc1234",
): QualificationBundleManifest {
  return buildQualificationBundleManifest({
    cohortId,
    entries: bundleEntries(),
    cohortPin: {
      expectedProfileDigest: digestRuntimeIsolationValue(profile),
      expectedTestSuiteDigest: testSuiteDigest,
      expectedProviderConfigDigest: profile.providerConfigDigest,
      expectedHostPolicyDigest: profile.hostPolicyDigest,
      expectedDockerRuntimeRegistrationDigest: profile.dockerRuntimeRegistrationDigest,
      expectedWorkloadImageManifestDigest: profile.workloadImage.manifestDigest,
    },
  });
}

/** Build V3 evidence bound to the given bundle. */
export function evidenceForBundle(
  profile: RuntimeIsolationProfileV3,
  bundle: QualificationBundleManifest,
  overrides: {
    testSuiteDigest?: string;
    probes?: unknown;
    positiveControls?: unknown;
    qualificationRunId?: string;
    qualificationTimestamp?: string;
  } = {},
): RuntimeIsolationEvidenceV3 {
  return createRuntimeIsolationEvidenceV3({
    profile,
    testSuiteDigest: overrides.testSuiteDigest ?? TEST_SUITE_DIGEST,
    qualificationBundleDigest: bundle.manifestDigest,
    qualificationRunId: overrides.qualificationRunId ?? "run-2026-07-22-1",
    qualificationTimestamp: overrides.qualificationTimestamp ?? "2026-07-22T04:30:00Z",
    probes: overrides.probes ?? passedProbes(),
    positiveControls: overrides.positiveControls ?? trueControls(),
    coldStartLatency: null,
  });
}
