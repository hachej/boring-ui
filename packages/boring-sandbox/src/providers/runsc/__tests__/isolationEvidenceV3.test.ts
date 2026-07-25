import { describe, expect, it } from "vitest";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  createRuntimeIsolationEvidenceV3,
  digestRuntimeIsolationValue,
  parseRuntimeIsolationEvidenceV3,
  verifyRuntimeIsolationEvidenceV3,
} from "../index";
import { TEST_SUITE_DIGEST, digest, passedProbes, profileV3, trueControls } from "./v3Fixtures";

function evidence(overrides: Record<string, unknown> = {}) {
  return createRuntimeIsolationEvidenceV3({
    profile: profileV3(),
    testSuiteDigest: TEST_SUITE_DIGEST,
    qualificationBundleDigest: digest("e"),
    qualificationRunId: "run-2026-07-22-1",
    qualificationTimestamp: "2026-07-22T04:30:00Z",
    probes: passedProbes(),
    positiveControls: trueControls(),
    coldStartLatency: null,
    ...overrides,
  });
}

describe("V3 isolation evidence — schema + digests", () => {
  it("creates a self-consistent, frozen V3 envelope", () => {
    const e = evidence();
    expect(e.schemaVersion).toBe(3);
    expect(e.domain).toBe("boring-runtime-isolation-evidence:v3");
    expect(e.profile.networkPolicy).toBe("none");
    expect(e.profile.workspaceMountPolicy).toBe("readwrite-workspace-only");
    expect(e.profile.workspaceQuota).toEqual({ bytesQuota: 1_073_741_824, inodeQuota: 65_536 });
    expect(Object.isFrozen(e)).toBe(true);
    const { evidenceDigest, ...withoutDigest } = e;
    expect(digestRuntimeIsolationValue(withoutDigest)).toBe(evidenceDigest);
    expect(e.profileDigest).toBe(digestRuntimeIsolationValue(e.profile));
  });

  it("preserves all eleven isolation-configuration probes", () => {
    const e = evidence();
    expect(Object.keys(e.probes)).toHaveLength(11);
  });

  it("carries the four V3 controls plus the seven V2 controls", () => {
    const e = evidence();
    expect(e.positiveControls.ownWorkspaceWritable).toBe(true);
    expect(e.positiveControls.ownWorkspacePersistsAcrossRecreate).toBe(true);
    expect(e.positiveControls.bytesQuotaEnforced).toBe(true);
    expect(e.positiveControls.inodeQuotaEnforced).toBe(true);
    expect(e.positiveControls.ownMarkerReadable).toBe(true);
    expect(Object.keys(e.positiveControls)).toHaveLength(11);
  });

  it("round-trips through the strict parser", () => {
    const e = evidence();
    expect(parseRuntimeIsolationEvidenceV3(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});

describe("V3 isolation evidence — strict negatives", () => {
  it("rejects a non-production network policy", () => {
    expect(() => createRuntimeIsolationEvidenceV3({
      profile: profileV3({ networkPolicy: "isolated-internal-bridge-no-default-route" as never }),
      testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
      qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
      probes: passedProbes(), positiveControls: trueControls(),
    })).toThrow();
  });

  it("rejects a read-only workspace mount policy", () => {
    expect(() => createRuntimeIsolationEvidenceV3({
      profile: profileV3({ workspaceMountPolicy: "readonly" as never }),
      testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
      qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
      probes: passedProbes(), positiveControls: trueControls(),
    })).toThrow();
  });

  it("rejects a drifted workspace quota", () => {
    expect(() => createRuntimeIsolationEvidenceV3({
      profile: profileV3({ workspaceQuota: { bytesQuota: 999, inodeQuota: 65_536 } as never }),
      testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
      qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
      probes: passedProbes(), positiveControls: trueControls(),
    })).toThrow();
  });

  it("rejects a guest kernel that is not the gVisor sentinel", () => {
    expect(() => createRuntimeIsolationEvidenceV3({
      profile: profileV3({ guestKernelRelease: "6.14.0-37-generic" as never }),
      testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
      qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
      probes: passedProbes(), positiveControls: trueControls(),
    })).toThrow();
  });

  it("rejects a control that is not true", () => {
    expect(() => createRuntimeIsolationEvidenceV3({
      profile: profileV3(),
      testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
      qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
      probes: passedProbes(), positiveControls: { ...trueControls(), bytesQuotaEnforced: false },
    })).toThrow();
  });

  it("rejects a malformed qualification run id and timestamp", () => {
    for (const bad of [{ qualificationRunId: "bad id!" }, { qualificationTimestamp: "not-a-date" }]) {
      expect(() => createRuntimeIsolationEvidenceV3({
        profile: profileV3(), testSuiteDigest: TEST_SUITE_DIGEST, qualificationBundleDigest: digest("e"),
        qualificationRunId: "r", qualificationTimestamp: "2026-07-22T04:30:00Z",
        probes: passedProbes(), positiveControls: trueControls(), ...bad,
      })).toThrow();
    }
  });

  it("verify() detects profile drift and tampered digests", () => {
    const e = evidence();
    const observed = digestRuntimeIsolationValue(profileV3());
    expect(observed).toBe(e.profileDigest);
    const drift = verifyRuntimeIsolationEvidenceV3(e, profileV3({ hostKernelRelease: "5.15.0-generic" }), TEST_SUITE_DIGEST);
    expect(drift.status).toBe("rejected");
    if (drift.status === "rejected") expect(drift.code).toBe(RUNTIME_ISOLATION_ERROR_CODES.profileDrift);

    const tampered = { ...e, qualificationRunId: "run-2026-07-22-2" };
    const bad = verifyRuntimeIsolationEvidenceV3(tampered, profileV3(), TEST_SUITE_DIGEST);
    expect(bad.status).toBe("rejected");
    if (bad.status === "rejected") expect(bad.code).toBe(RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid);
  });

  it("accepts an untampered envelope", () => {
    const e = evidence();
    const ok = verifyRuntimeIsolationEvidenceV3(e, profileV3(), TEST_SUITE_DIGEST);
    expect(ok.status).toBe("accepted");
  });
});
