import { describe, expect, it } from "vitest";

import {
  FLEET_ADMISSION_ERROR_CODES,
  QUALIFICATION_BUNDLE_ERROR_CODES,
  verifyFleetAdmission,
} from "../index";
import {
  TEST_SUITE_DIGEST,
  cohortBundle,
  digest,
  evidenceForBundle,
  passedProbes,
  profileV3,
} from "./v3Fixtures";

describe("fleet admission — strict all-passed acceptance", () => {
  it("accepts a fully-passed, cohort-bound bundle + evidence pair", () => {
    const profile = profileV3();
    const bundle = cohortBundle(profile);
    const evidence = evidenceForBundle(profile, bundle);
    const res = verifyFleetAdmission({ bundle, evidence });
    expect(res.status).toBe("accepted");
    if (res.status === "accepted") {
      expect(res.evidenceDigest).toBe(evidence.evidenceDigest);
      expect(res.bundleDigest).toBe(bundle.manifestDigest);
      expect(res.facts.cohortId).toBe("gitsha-abc1234");
      expect(res.facts.guestKernelRelease).toBe("4.19.0-gvisor");
      // Safe facts only — no host paths, secrets, or digests of raw config.
      expect(Object.keys(res.facts).sort()).toEqual([
        "cohortId", "dockerServerVersion", "guestKernelRelease", "hostKernelRelease",
        "qualificationRunId", "qualificationTimestamp", "runtimeVersion", "workloadImageRepository",
      ]);
    }
  });
});

describe("fleet admission — strict negatives (drift / incomplete / tampered)", () => {
  it("rejects an unproven probe (stricter than the general parser)", () => {
    const profile = profileV3();
    const bundle = cohortBundle(profile);
    const probes = { ...passedProbes(), "secret-access": { status: "unproven", reason: "no diagnostics available" } };
    const evidence = evidenceForBundle(profile, bundle, { probes });
    const res = verifyFleetAdmission({ bundle, evidence });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(FLEET_ADMISSION_ERROR_CODES.probeNotPassed);
  });

  it("rejects evidence bound to a different bundle (cohort mismatch)", () => {
    const profile = profileV3();
    const bundle = cohortBundle(profile);
    const otherBundle = cohortBundle(profile, TEST_SUITE_DIGEST, "gitsha-other999");
    const evidence = evidenceForBundle(profile, otherBundle);
    const res = verifyFleetAdmission({ bundle, evidence });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(FLEET_ADMISSION_ERROR_CODES.cohortMismatch);
  });

  it("rejects a cohort pin that does not match the evidence profile", () => {
    const profile = profileV3();
    // Bundle pins a DIFFERENT profile digest than the evidence carries.
    const mismatchedBundle = cohortBundle(profileV3({ providerConfigDigest: digest("77") }));
    const evidence = evidenceForBundle(profile, mismatchedBundle);
    const res = verifyFleetAdmission({ bundle: mismatchedBundle, evidence });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(FLEET_ADMISSION_ERROR_CODES.cohortMismatch);
  });

  it("rejects a tampered (digest-mismatched) bundle", () => {
    const profile = profileV3();
    const bundle = cohortBundle(profile);
    const evidence = evidenceForBundle(profile, bundle);
    const tampered = { ...bundle, cohortId: "gitsha-tampered" };
    const res = verifyFleetAdmission({ bundle: tampered, evidence });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(QUALIFICATION_BUNDLE_ERROR_CODES.digestMismatch);
  });

  it("rejects tampered evidence (broken self-digest)", () => {
    const profile = profileV3();
    const bundle = cohortBundle(profile);
    const evidence = evidenceForBundle(profile, bundle);
    const tampered = { ...evidence, qualificationRunId: "run-forged" };
    const res = verifyFleetAdmission({ bundle, evidence: tampered });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(FLEET_ADMISSION_ERROR_CODES.evidenceRejected);
  });

  it("rejects a non-V3 evidence value", () => {
    const bundle = cohortBundle(profileV3());
    const res = verifyFleetAdmission({ bundle, evidence: { schemaVersion: 2 } });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(FLEET_ADMISSION_ERROR_CODES.evidenceRejected);
  });
});
