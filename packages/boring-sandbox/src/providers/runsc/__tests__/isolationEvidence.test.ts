import { describe, expect, it } from "vitest";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  createRuntimeIsolationEvidence,
  digestRuntimeIsolationValue,
  verifyRuntimeIsolationEvidence,
  type RuntimeIsolationProbeId,
  type RuntimeIsolationProfileV1,
} from "../index";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

function profile(overrides: Partial<RuntimeIsolationProfileV1> = {}): RuntimeIsolationProfileV1 {
  return {
    schemaVersion: 1,
    provider: "runsc",
    kernelRelease: "6.14.0-37-generic",
    runtimeVersion: "release-20260706.0",
    runtimeBinaryDigest: digest("a"),
    rootfsBinaryDigest: digest("f"),
    platformMode: "systrap",
    privilegeModel: "sudo-root",
    containerCapabilities: [],
    workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "isolated-veth-no-default-route",
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    providerConfigDigest: digest("b"),
    hostPolicyDigest: digest("c"),
    ...overrides,
  };
}

function passedProbes(): Record<RuntimeIsolationProbeId, "passed"> {
  return Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, "passed"])) as Record<RuntimeIsolationProbeId, "passed">;
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

describe("runsc runtime isolation evidence", () => {
  it("creates frozen redacted content-addressed evidence only after every probe and positive control passes", () => {
    const evidence = createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls });
    expect(evidence.probes).toEqual(Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, "passed"])));
    expect(evidence.redaction).toEqual({ containsHostPaths: false, containsSecrets: false, containsHostPids: false });
    expect(evidence.profileDigest).toBe(digestRuntimeIsolationValue(evidence.profile));
    expect(evidence.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.profile.cgroupPolicy)).toBe(true);
    expect(verifyRuntimeIsolationEvidence(evidence, profile(), digest("d"))).toEqual({ status: "accepted", evidenceDigest: evidence.evidenceDigest });
  });

  it.each(RUNTIME_ISOLATION_PROBE_IDS)("rejects missing or failed %s evidence", (id) => {
    const probes: Record<string, unknown> = passedProbes();
    probes[id] = "failed";
    expect(() => createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes, positiveControls: controls })).toThrow("invalid runtime isolation evidence");
  });

  it.each(Object.keys(controls) as (keyof typeof controls)[])("rejects a false positive control: %s", (key) => {
    expect(() => createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: { ...controls, [key]: false } })).toThrow();
  });

  it.each([
    ["runtime binary", { runtimeBinaryDigest: digest("e") }],
    ["runtime version", { runtimeVersion: "release-20260713.0" }],
    ["kernel", { kernelRelease: "6.15.0-eu" }],
    ["rootfs binary", { rootfsBinaryDigest: digest("e") }],
    ["provider config", { providerConfigDigest: digest("e") }],
    ["host policy", { hostPolicyDigest: digest("e") }],
  ] as const)("rejects material %s drift", (_label, change) => {
    const evidence = createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls });
    expect(verifyRuntimeIsolationEvidence(evidence, profile(change), digest("d"))).toEqual({
      status: "rejected", code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift, message: "runtime isolation qualification drifted",
    });
  });

  it("rejects test-suite drift and tampered evidence without reflecting hostile input", () => {
    const evidence = createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls });
    expect(verifyRuntimeIsolationEvidence(evidence, profile(), digest("e"))).toMatchObject({ status: "rejected", code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift });
    const hostile = { ...evidence, evidenceDigest: digest("f"), extra: "TOKEN=/private/raw" };
    expect(verifyRuntimeIsolationEvidence(hostile, profile(), digest("d"))).toEqual({
      status: "rejected", code: RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid, message: "runtime isolation evidence is invalid",
    });
  });

  it("rejects privilege/platform/cgroup and schema substitutions instead of downgrading", () => {
    const evidence = createRuntimeIsolationEvidence({ profile: profile(), testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls });
    for (const changed of [
      { ...profile(), privilegeModel: "rootless" },
      { ...profile(), platformMode: "ptrace" },
      { ...profile(), cgroupPolicy: { ...profile().cgroupPolicy, pidsMax: 65 } },
      { ...profile(), provider: "direct" },
    ]) {
      expect(verifyRuntimeIsolationEvidence(evidence, changed, digest("d"))).toEqual({
        status: "rejected",
        code: RUNTIME_ISOLATION_ERROR_CODES.profileDrift,
        message: "runtime isolation qualification drifted",
      });
    }
  });

  it("accepts equivalent object key insertion order but rejects unknown keys", () => {
    const original = profile();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    const evidence = createRuntimeIsolationEvidence({ profile: reordered, testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls });
    expect(verifyRuntimeIsolationEvidence(evidence, reordered, digest("d"))).toMatchObject({ status: "accepted" });
    expect(() => createRuntimeIsolationEvidence({ profile: { ...original, extra: true }, testSuiteDigest: digest("d"), probes: passedProbes(), positiveControls: controls })).toThrow();
  });
});
