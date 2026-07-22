// Immutable, cohort-specific qualification bundle format (SBX1.2).
//
// A qualification bundle pins a single fleet cohort's EXACT
// host/kernel/runsc/image/profile configuration together with the checksums of
// every artifact the adversarial qualification harness needs (built provider
// entry, V3 schema/validator source, the exact qualification script, probe
// source and static probe binary, read-only qualification helpers, and the
// expected production workload image digest). It is a reproducible release
// manifest — content-addressed and immutable — NOT a content-addressed store or
// a publication journal.
//
// This file is `src/shared/**`: types + stable error codes only. It keeps the
// invariant-clean constraints (no node builtins, no byte buffers; invariants
// 1-2, 8). The digest/build/verify logic lives in the runsc provider
// (`src/providers/runsc/qualificationBundle.ts`), which may use `node:crypto`.

import type { RuntimeIsolationDigest } from "./runtimeIsolation";

export const QUALIFICATION_BUNDLE_SCHEMA_VERSION = 1 as const;
export const QUALIFICATION_BUNDLE_DOMAIN = "boring-runsc-qualification-bundle:v1" as const;

/**
 * The role each manifest entry plays in the qualification cohort. The set is
 * closed so a drifted/incomplete bundle (a missing or extra role) is rejected.
 */
export const QUALIFICATION_BUNDLE_ENTRY_ROLES = [
  "provider-entry",
  "evidence-schema-source",
  "evidence-validator-source",
  "qualification-script",
  "probe-source",
  "probe-static-binary",
  "qualification-helper",
] as const;

export type QualificationBundleEntryRole =
  (typeof QUALIFICATION_BUNDLE_ENTRY_ROLES)[number];

export const QUALIFICATION_BUNDLE_ERROR_CODES = {
  invalidManifest: "RUNSC_QUALIFICATION_BUNDLE_INVALID_MANIFEST",
  digestMismatch: "RUNSC_QUALIFICATION_BUNDLE_DIGEST_MISMATCH",
  entryDrift: "RUNSC_QUALIFICATION_BUNDLE_ENTRY_DRIFT",
  cohortMismatch: "RUNSC_QUALIFICATION_BUNDLE_COHORT_MISMATCH",
} as const;

export type QualificationBundleErrorCode =
  (typeof QUALIFICATION_BUNDLE_ERROR_CODES)[keyof typeof QUALIFICATION_BUNDLE_ERROR_CODES];

/**
 * Stable error codes for the strict, all-passed fleet-admission validator. This
 * gate is NON-ADMITTING tooling in SBX1.2: it decides whether a bundle+evidence
 * pair *satisfies the V3 contract*, which SBX1.5 later uses to actually admit a
 * box. It never admits a production image itself.
 */
export const FLEET_ADMISSION_ERROR_CODES = {
  evidenceRejected: "RUNSC_FLEET_ADMISSION_EVIDENCE_REJECTED",
  bundleRejected: "RUNSC_FLEET_ADMISSION_BUNDLE_REJECTED",
  probeNotPassed: "RUNSC_FLEET_ADMISSION_PROBE_NOT_PASSED",
  controlNotTrue: "RUNSC_FLEET_ADMISSION_CONTROL_NOT_TRUE",
  profileNotProduction: "RUNSC_FLEET_ADMISSION_PROFILE_NOT_PRODUCTION",
  cohortMismatch: "RUNSC_FLEET_ADMISSION_COHORT_MISMATCH",
} as const;

export type FleetAdmissionErrorCode =
  (typeof FLEET_ADMISSION_ERROR_CODES)[keyof typeof FLEET_ADMISSION_ERROR_CODES];

/** Safe, non-secret profile facts echoed back on an accepted admission check. */
export interface FleetAdmissionSafeFacts {
  readonly cohortId: string;
  readonly hostKernelRelease: string;
  readonly guestKernelRelease: string;
  readonly dockerServerVersion: string;
  readonly runtimeVersion: string;
  readonly workloadImageRepository: string;
  readonly qualificationRunId: string;
  readonly qualificationTimestamp: string;
}

export type FleetAdmissionResult =
  | {
      readonly status: "accepted";
      readonly evidenceDigest: RuntimeIsolationDigest;
      readonly bundleDigest: RuntimeIsolationDigest;
      readonly facts: FleetAdmissionSafeFacts;
    }
  | {
      readonly status: "rejected";
      readonly code: FleetAdmissionErrorCode | QualificationBundleErrorCode;
      readonly message: string;
    };

/** One checksummed artifact pinned into the cohort bundle. */
export interface QualificationBundleEntry {
  readonly role: QualificationBundleEntryRole;
  /** Bundle-relative POSIX path, e.g. `dist/providers/runsc/index.js`. */
  readonly path: string;
  readonly digest: RuntimeIsolationDigest;
  readonly bytes: number;
}

/**
 * The cohort configuration pin: the exact expected V3 profile/config the
 * qualification evidence must match. Every field is a content digest so the
 * validator can reject drift without re-deriving host facts.
 */
export interface QualificationBundleCohortPin {
  readonly expectedProfileDigest: RuntimeIsolationDigest;
  readonly expectedTestSuiteDigest: RuntimeIsolationDigest;
  readonly expectedProviderConfigDigest: RuntimeIsolationDigest;
  readonly expectedHostPolicyDigest: RuntimeIsolationDigest;
  readonly expectedDockerRuntimeRegistrationDigest: RuntimeIsolationDigest;
  readonly expectedWorkloadImageManifestDigest: RuntimeIsolationDigest;
}

export interface QualificationBundleManifest {
  readonly schemaVersion: typeof QUALIFICATION_BUNDLE_SCHEMA_VERSION;
  readonly domain: typeof QUALIFICATION_BUNDLE_DOMAIN;
  /** Cohort identity — the reviewed git sha the bundle is built from. */
  readonly cohortId: string;
  /** Entries sorted by (role, path); the parser rejects unsorted/duplicate/incomplete sets. */
  readonly entries: readonly QualificationBundleEntry[];
  readonly cohortPin: QualificationBundleCohortPin;
  /** Digest over everything above (canonical JSON). Makes the manifest immutable/self-verifying. */
  readonly manifestDigest: RuntimeIsolationDigest;
}

export type QualificationBundleVerification =
  | { readonly status: "accepted"; readonly manifestDigest: RuntimeIsolationDigest }
  | {
      readonly status: "rejected";
      readonly code: QualificationBundleErrorCode;
      readonly message: string;
    };
