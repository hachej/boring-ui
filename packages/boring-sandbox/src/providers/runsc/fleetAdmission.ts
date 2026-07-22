// Strict, all-passed fleet-admission validator (SBX1.2).
//
// Given an immutable cohort bundle manifest and a V3 qualification evidence
// envelope, decide whether the pair SATISFIES the production V3 contract:
//   - the bundle manifest verifies (immutable, complete, digest-consistent);
//   - the evidence is a well-formed, self-consistent V3 envelope;
//   - the profile is exactly the production shape (docker+runsc, non-root,
//     systrap, uid/gid 65532, no caps, `--network none`,
//     readwrite-workspace-only, fixed bytes/inode quota);
//   - all ELEVEN isolation-configuration probes are `passed` (`unproven` is
//     rejected — the general parser may keep `unproven` for research output,
//     this gate is deliberately stricter);
//   - all eleven positive controls (seven V2 + four V3) are true;
//   - all three redaction flags are false;
//   - the evidence binds to THIS bundle: its `qualificationBundleDigest` equals
//     the manifest digest, and the cohort pin digests match the evidence's
//     profile/test-suite/provider/host/runtime-registration/image digests.
//
// IMPORTANT: this is NON-ADMITTING tooling. Returning `accepted` means the
// evidence satisfies the contract; it does NOT admit a production image or a
// box. Actual fleet admission (bundle publication + candidate-box gate) is
// SBX1.5. This validator also does not implement the runsc worker runtime
// (SBX1.3) or the daemon (SBX1.4).

import {
  FLEET_ADMISSION_ERROR_CODES,
  type FleetAdmissionErrorCode,
  type FleetAdmissionResult,
  type QualificationBundleManifest,
} from "../../shared/qualificationBundle";
import {
  RUNTIME_ISOLATION_PROBE_IDS,
  RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS,
  type RuntimeIsolationEvidenceV3,
} from "../../shared/runtimeIsolation";

import { digestRuntimeIsolationValue, parseRuntimeIsolationEvidenceV3 } from "./isolationEvidence";
import { parseQualificationBundleManifest, verifyQualificationBundle } from "./qualificationBundle";

/**
 * Validate a bundle + V3 evidence pair against the strict production contract.
 * Every check must pass; the first failure returns a stable rejection code.
 * NON-ADMITTING: acceptance means "the contract is satisfied", not "admit this box".
 */
export function verifyFleetAdmission(input: {
  bundle: unknown;
  evidence: unknown;
}): FleetAdmissionResult {
  const bundleResult = verifyQualificationBundle(input.bundle);
  if (bundleResult.status === "rejected") {
    return { status: "rejected", code: bundleResult.code, message: `qualification bundle rejected: ${bundleResult.message}` };
  }
  // Re-parse to a typed manifest (verifyQualificationBundle already proved it valid).
  const manifest: QualificationBundleManifest = parseQualificationBundleManifest(input.bundle);

  let evidence: RuntimeIsolationEvidenceV3;
  try {
    evidence = parseRuntimeIsolationEvidenceV3(input.evidence);
  } catch {
    return reject("evidenceRejected", "qualification evidence is not a valid V3 envelope");
  }

  // Self-consistency: recompute the evidence digest over its own content.
  const { evidenceDigest, ...withoutDigest } = evidence;
  if (digestRuntimeIsolationValue(withoutDigest) !== evidenceDigest) {
    return reject("evidenceRejected", "qualification evidence digest does not verify");
  }
  if (evidence.profileDigest !== digestRuntimeIsolationValue(evidence.profile)) {
    return reject("evidenceRejected", "qualification evidence profile digest does not verify");
  }

  // Production profile shape. The strict V3 parser already fixes the literals,
  // but we re-assert the security-critical ones for an explicit, coded failure.
  const p = evidence.profile;
  if (
    p.launcher !== "docker-runsc" || p.privilegeModel !== "docker-runsc-nonroot" ||
    p.platformMode !== "systrap" || p.workloadIdentity !== "uid-65532-gid-65532" ||
    p.containerCapabilities.length !== 0 || p.networkPolicy !== "none" ||
    p.workspaceMountPolicy !== "readwrite-workspace-only" ||
    p.guestKernelRelease !== "4.19.0-gvisor"
  ) {
    return reject("profileNotProduction", "qualification profile is not the production V3 shape");
  }

  // All eleven probes must be `passed`; `unproven` is rejected for admission.
  for (const id of RUNTIME_ISOLATION_PROBE_IDS) {
    if (evidence.probes[id]?.status !== "passed") {
      return reject("probeNotPassed", `isolation probe not passed: ${id}`);
    }
  }

  // All eleven positive controls (seven V2 + four V3) must be true.
  for (const key of RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS) {
    if (evidence.positiveControls[key] !== true) {
      return reject("controlNotTrue", `positive control not satisfied: ${key}`);
    }
  }

  // Redaction flags must all be false (no host paths / secrets / host pids).
  if (
    evidence.redaction.containsHostPaths !== false ||
    evidence.redaction.containsSecrets !== false ||
    evidence.redaction.containsHostPids !== false
  ) {
    return reject("evidenceRejected", "qualification evidence is not redacted");
  }

  // Cohort binding: evidence must be pinned to THIS bundle and its cohort pin.
  const pin = manifest.cohortPin;
  if (evidence.qualificationBundleDigest !== manifest.manifestDigest) {
    return reject("cohortMismatch", "evidence is not bound to this qualification bundle");
  }
  if (
    evidence.profileDigest !== pin.expectedProfileDigest ||
    evidence.testSuiteDigest !== pin.expectedTestSuiteDigest ||
    p.providerConfigDigest !== pin.expectedProviderConfigDigest ||
    p.hostPolicyDigest !== pin.expectedHostPolicyDigest ||
    p.dockerRuntimeRegistrationDigest !== pin.expectedDockerRuntimeRegistrationDigest ||
    p.workloadImage.manifestDigest !== pin.expectedWorkloadImageManifestDigest
  ) {
    return reject("cohortMismatch", "evidence does not match the bundle cohort pin");
  }

  return {
    status: "accepted",
    evidenceDigest,
    bundleDigest: manifest.manifestDigest,
    facts: {
      cohortId: manifest.cohortId,
      hostKernelRelease: p.hostKernelRelease,
      guestKernelRelease: p.guestKernelRelease,
      dockerServerVersion: p.dockerServerVersion,
      runtimeVersion: p.runtimeVersion,
      workloadImageRepository: p.workloadImage.repository,
      qualificationRunId: evidence.qualificationRunId,
      qualificationTimestamp: evidence.qualificationTimestamp,
    },
  };
}

function reject(code: keyof typeof FLEET_ADMISSION_ERROR_CODES, message: string): FleetAdmissionResult {
  return { status: "rejected", code: FLEET_ADMISSION_ERROR_CODES[code] as FleetAdmissionErrorCode, message };
}
