import { describe, expect, it } from "vitest";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  createDockerRuntimeIsolationEvidence,
  digestRuntimeIsolationValue,
  verifyDockerRuntimeIsolationEvidence,
  type RuntimeIsolationColdStartEvidence,
  type RuntimeIsolationProbeId,
  type RuntimeIsolationProfileV2,
} from "../index";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

function profile(overrides: Partial<RuntimeIsolationProfileV2> = {}): RuntimeIsolationProfileV2 {
  return {
    schemaVersion: 2,
    provider: "runsc",
    launcher: "docker-runsc",
    privilegeModel: "docker-runsc-nonroot",
    kernelRelease: "6.14.0-37-generic",
    runtimeVersion: "release-20260706.0",
    runtimeBinaryDigest: digest("a"),
    rootfsBinaryDigest: digest("f"),
    platformMode: "systrap",
    containerCapabilities: [],
    workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "isolated-internal-bridge-no-default-route",
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    providerConfigDigest: digest("b"),
    hostPolicyDigest: digest("c"),
    ...overrides,
  };
}

function passedProbes(): Record<RuntimeIsolationProbeId, { status: "passed" }> {
  return Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, { status: "passed" }])) as Record<
    RuntimeIsolationProbeId,
    { status: "passed" }
  >;
}

const controls = {
  ownMarkerReadable: true,
  attackerEndpointReachableBeforeHostileCalls: true,
  attackerEndpointReachableAfterHostileCalls: true,
  siblingEndpointReachableFromSibling: true,
  siblingCanaryReadableFromSibling: true,
  siblingAliveBeforeHostileCalls: true,
  siblingAliveAfterHostileCalls: true,
} as const;

const latency: RuntimeIsolationColdStartEvidence = {
  image: "node:20-slim",
  imageDigest: digest("1"),
  command: "true",
  methodology: "docker run wall-clock, n=20 per runtime and cache-state",
  samples: [
    { runtime: "runsc", cacheState: "warm", n: 20, p50Ms: 320, p95Ms: 410, meanMs: 330, minMs: 300, maxMs: 500, stdevMs: 40 },
    { runtime: "runc", cacheState: "warm", n: 20, p50Ms: 180, p95Ms: 240, meanMs: 190, minMs: 160, maxMs: 300, stdevMs: 30 },
  ],
};

describe("docker-runsc runtime isolation evidence (schema v2)", () => {
  it("creates frozen redacted content-addressed evidence with optional latency", () => {
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
      coldStartLatency: latency,
    });
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.domain).toBe("boring-runtime-isolation-evidence:v2");
    expect(evidence.probes["teardown"]).toEqual({ status: "passed" });
    expect(evidence.coldStartLatency?.samples).toHaveLength(2);
    expect(evidence.redaction).toEqual({ containsHostPaths: false, containsSecrets: false, containsHostPids: false });
    expect(evidence.profileDigest).toBe(digestRuntimeIsolationValue(evidence.profile));
    expect(evidence.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.coldStartLatency)).toBe(true);
    expect(verifyDockerRuntimeIsolationEvidence(evidence, profile(), digest("d"))).toEqual({
      status: "accepted",
      evidenceDigest: evidence.evidenceDigest,
    });
  });

  it("accepts a null latency section", () => {
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
    });
    expect(evidence.coldStartLatency).toBeNull();
    expect(verifyDockerRuntimeIsolationEvidence(evidence, profile(), digest("d"))).toMatchObject({ status: "accepted" });
  });

  it("honestly records an unproven probe with a reason and round-trips", () => {
    const probes: Record<string, unknown> = passedProbes();
    probes["device-access"] = { status: "unproven", reason: "device node absent under gvisor; skipped" };
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes,
      positiveControls: controls,
      coldStartLatency: latency,
    });
    expect(evidence.probes["device-access"]).toEqual({ status: "unproven", reason: "device node absent under gvisor; skipped" });
    expect(verifyDockerRuntimeIsolationEvidence(evidence, profile(), digest("d"))).toMatchObject({ status: "accepted" });
  });

  it("rejects an unproven probe missing a reason and unknown probe status", () => {
    for (const bad of [{ status: "unproven" }, { status: "failed" }, { status: "passed", extra: 1 }]) {
      const probes: Record<string, unknown> = passedProbes();
      probes["mount-access"] = bad;
      expect(() =>
        createDockerRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes, positiveControls: controls }),
      ).toThrow("invalid runtime isolation evidence");
    }
  });

  it.each(Object.keys(controls) as (keyof typeof controls)[])("rejects a false positive control: %s", (key) => {
    expect(() =>
      createDockerRuntimeIsolationEvidence({
        profile: profile(),
        testSuiteDigest: digest("d"),
        probes: passedProbes(),
        positiveControls: { ...controls, [key]: false },
      }),
    ).toThrow();
  });

  it.each([
    ["runtime binary", { runtimeBinaryDigest: digest("e") }],
    ["runtime version", { runtimeVersion: "release-20260713.0" }],
    ["kernel", { kernelRelease: "6.15.0-eu" }],
    ["provider config", { providerConfigDigest: digest("e") }],
    ["host policy", { hostPolicyDigest: digest("e") }],
  ] as const)("rejects material %s drift", (_label, change) => {
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
      coldStartLatency: latency,
    });
    expect(verifyDockerRuntimeIsolationEvidence(evidence, profile(change), digest("d"))).toEqual({
      status: "rejected",
      code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift,
      message: "runtime isolation qualification drifted",
    });
  });

  it("rejects launcher/privilege/network substitutions instead of downgrading", () => {
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
    });
    for (const changed of [
      { ...profile(), launcher: "raw-runsc" },
      { ...profile(), privilegeModel: "sudo-root" },
      { ...profile(), networkPolicy: "isolated-veth-no-default-route" },
      { ...profile(), schemaVersion: 1 },
    ]) {
      expect(verifyDockerRuntimeIsolationEvidence(evidence, changed, digest("d"))).toEqual({
        status: "rejected",
        code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift,
        message: "runtime isolation qualification drifted",
      });
    }
  });

  it("rejects test-suite drift and tampered evidence without reflecting hostile input", () => {
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: profile(),
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
      coldStartLatency: latency,
    });
    expect(verifyDockerRuntimeIsolationEvidence(evidence, profile(), digest("e"))).toMatchObject({
      status: "rejected",
      code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift,
    });
    const hostile = { ...evidence, evidenceDigest: digest("f"), extra: "TOKEN=/private/raw" };
    expect(verifyDockerRuntimeIsolationEvidence(hostile, profile(), digest("d"))).toEqual({
      status: "rejected",
      code: RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid,
      message: "runtime isolation evidence is invalid",
    });
  });

  it("rejects malformed latency samples", () => {
    for (const badSamples of [
      [{ runtime: "podman", cacheState: "warm", n: 20, p50Ms: 1, p95Ms: 1, meanMs: 1, minMs: 1, maxMs: 1, stdevMs: 1 }],
      [{ runtime: "runsc", cacheState: "hot", n: 20, p50Ms: 1, p95Ms: 1, meanMs: 1, minMs: 1, maxMs: 1, stdevMs: 1 }],
      [{ runtime: "runsc", cacheState: "warm", n: 0, p50Ms: 1, p95Ms: 1, meanMs: 1, minMs: 1, maxMs: 1, stdevMs: 1 }],
      [{ runtime: "runsc", cacheState: "warm", n: 20, p50Ms: -1, p95Ms: 1, meanMs: 1, minMs: 1, maxMs: 1, stdevMs: 1 }],
      [],
    ]) {
      expect(() =>
        createDockerRuntimeIsolationEvidence({
          profile: profile(),
          testSuiteDigest: digest("d"),
          probes: passedProbes(),
          positiveControls: controls,
          coldStartLatency: { ...latency, samples: badSamples },
        }),
      ).toThrow("invalid runtime isolation evidence");
    }
  });

  it("accepts equivalent object key insertion order but rejects unknown profile keys", () => {
    const original = profile();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    const evidence = createDockerRuntimeIsolationEvidence({
      profile: reordered,
      testSuiteDigest: digest("d"),
      probes: passedProbes(),
      positiveControls: controls,
    });
    expect(verifyDockerRuntimeIsolationEvidence(evidence, reordered, digest("d"))).toMatchObject({ status: "accepted" });
    expect(() =>
      createDockerRuntimeIsolationEvidence({
        profile: { ...original, extra: true },
        testSuiteDigest: digest("d"),
        probes: passedProbes(),
        positiveControls: controls,
      }),
    ).toThrow();
  });
});
