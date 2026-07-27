import { describe, expect, it } from "vitest";

import {
  QUALIFICATION_BUNDLE_ERROR_CODES,
  buildQualificationBundleManifest,
  parseQualificationBundleManifest,
  verifyQualificationBundle,
} from "../index";
import { bundleEntries, cohortBundle, digest, profileV3 } from "./v3Fixtures";

describe("qualification bundle — build + immutability", () => {
  it("builds a self-verifying, frozen, cohort-pinned manifest", () => {
    const bundle = cohortBundle(profileV3());
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.domain).toBe("boring-runsc-qualification-bundle:v1");
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(verifyQualificationBundle(bundle).status).toBe("accepted");
  });

  it("is reproducible: same inputs (any order) yield the same manifest digest", () => {
    const a = cohortBundle(profileV3());
    const shuffled = [...bundleEntries()].reverse();
    const b = buildQualificationBundleManifest({
      cohortId: "gitsha-abc1234",
      entries: shuffled,
      cohortPin: a.cohortPin,
    });
    expect(b.manifestDigest).toBe(a.manifestDigest);
    // Entries are canonicalized to a stable sort regardless of input order.
    expect(b.entries).toEqual(a.entries);
  });

  it("changes the digest when any cohort input changes", () => {
    const base = cohortBundle(profileV3());
    const otherCohort = cohortBundle(profileV3(), undefined, "gitsha-zzz9999");
    const otherProfile = cohortBundle(profileV3({ hostPolicyDigest: digest("9") }));
    expect(otherCohort.manifestDigest).not.toBe(base.manifestDigest);
    expect(otherProfile.manifestDigest).not.toBe(base.manifestDigest);
  });

  it("round-trips through the strict parser", () => {
    const bundle = cohortBundle(profileV3());
    expect(parseQualificationBundleManifest(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });
});

describe("qualification bundle — strict negatives", () => {
  it("rejects a tampered entry digest (immutability)", () => {
    const bundle = cohortBundle(profileV3());
    const tampered = {
      ...bundle,
      entries: bundle.entries.map((e, i) => (i === 0 ? { ...e, digest: digest("99") } : e)),
    };
    const res = verifyQualificationBundle(tampered);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe(QUALIFICATION_BUNDLE_ERROR_CODES.digestMismatch);
  });

  it("rejects an incomplete bundle (missing a required role)", () => {
    const bundle = cohortBundle(profileV3());
    const incomplete = bundle.entries.filter((e) => e.role !== "probe-static-binary");
    expect(() => buildQualificationBundleManifest({
      cohortId: "gitsha-abc1234", entries: incomplete, cohortPin: bundle.cohortPin,
    })).toThrow();
    expect(() => parseQualificationBundleManifest({ ...bundle, entries: incomplete })).toThrow();
  });

  it("rejects a parse of a manifest whose digest does not match content", () => {
    const bundle = cohortBundle(profileV3());
    const drifted = { ...bundle, cohortId: "gitsha-tampered" };
    expect(() => parseQualificationBundleManifest(drifted)).toThrow();
  });

  it("rejects unknown roles, bad paths, and extra keys", () => {
    const bundle = cohortBundle(profileV3());
    expect(() => parseQualificationBundleManifest({ ...bundle, extra: 1 })).toThrow();
    const badRole = { ...bundle, entries: [{ ...bundle.entries[0], role: "mystery" }, ...bundle.entries.slice(1)] };
    expect(verifyQualificationBundle(badRole).status).toBe("rejected");
    const badPath = { ...bundle, entries: [{ ...bundle.entries[0], path: "../etc/passwd" }, ...bundle.entries.slice(1)] };
    expect(verifyQualificationBundle(badPath).status).toBe("rejected");
  });

  it("rejects a completely malformed value", () => {
    for (const v of [null, 42, "x", [], {}]) {
      const res = verifyQualificationBundle(v);
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") expect(res.code).toBe(QUALIFICATION_BUNDLE_ERROR_CODES.invalidManifest);
    }
  });
});
