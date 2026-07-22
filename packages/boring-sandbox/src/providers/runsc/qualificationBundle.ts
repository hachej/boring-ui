// Provider-side builder + strict validator for the immutable, cohort-specific
// qualification bundle (SBX1.2). The wire types + stable error codes live in
// `src/shared/qualificationBundle.ts` (invariant-clean); the digest/build/parse
// logic lives here where `node:crypto` (via {@link digestRuntimeIsolationValue})
// is allowed.
//
// A bundle is REPRODUCIBLE: building the same cohort inputs yields the same
// `manifestDigest`. It is IMMUTABLE: any tampered entry digest, reordered/added/
// dropped entry, or altered cohort pin changes `manifestDigest`, and the parser
// re-derives and rejects the mismatch.

import {
  QUALIFICATION_BUNDLE_DOMAIN,
  QUALIFICATION_BUNDLE_ENTRY_ROLES,
  QUALIFICATION_BUNDLE_ERROR_CODES,
  QUALIFICATION_BUNDLE_SCHEMA_VERSION,
  type QualificationBundleCohortPin,
  type QualificationBundleEntry,
  type QualificationBundleEntryRole,
  type QualificationBundleManifest,
  type QualificationBundleVerification,
} from "../../shared/qualificationBundle";
import type { RuntimeIsolationDigest } from "../../shared/runtimeIsolation";

import { digestRuntimeIsolationValue } from "./isolationEvidence";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COHORT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
// Bundle-relative POSIX path: no leading slash, no `..`, no backslashes.
const BUNDLE_PATH = /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/;
const COHORT_PIN_KEYS = [
  "expectedProfileDigest", "expectedTestSuiteDigest", "expectedProviderConfigDigest",
  "expectedHostPolicyDigest", "expectedDockerRuntimeRegistrationDigest", "expectedWorkloadImageManifestDigest",
] as const;
// Roles that must appear exactly once; `qualification-helper` may appear 0+ times.
const SINGLETON_ROLES = [
  "provider-entry", "evidence-schema-source", "evidence-validator-source",
  "qualification-script", "probe-source", "probe-static-binary",
] as const;

class InvalidBundle extends Error {}
function bad(): never { throw new InvalidBundle("invalid qualification bundle manifest"); }

/**
 * Build a reproducible, immutable cohort bundle manifest. Entries are sorted by
 * `(role, path)` so the manifest — and therefore its digest — is deterministic
 * for a given input set.
 */
export function buildQualificationBundleManifest(input: {
  cohortId: string;
  entries: readonly QualificationBundleEntry[];
  cohortPin: QualificationBundleCohortPin;
}): QualificationBundleManifest {
  const cohortId = parseCohortId(input.cohortId);
  const entries = sortEntries(input.entries.map(parseEntry));
  assertCompleteRoles(entries);
  const cohortPin = parseCohortPin(input.cohortPin);
  const withoutDigest = {
    schemaVersion: QUALIFICATION_BUNDLE_SCHEMA_VERSION,
    domain: QUALIFICATION_BUNDLE_DOMAIN,
    cohortId,
    entries,
    cohortPin,
  };
  return deepFreeze({
    ...withoutDigest,
    manifestDigest: digestRuntimeIsolationValue(withoutDigest),
  });
}

/** Strict parse of a serialized bundle manifest. Throws on any deviation. */
export function parseQualificationBundleManifest(value: unknown): QualificationBundleManifest {
  const record = strictRecord(value, [
    "schemaVersion", "domain", "cohortId", "entries", "cohortPin", "manifestDigest",
  ]);
  if (record.schemaVersion !== QUALIFICATION_BUNDLE_SCHEMA_VERSION || record.domain !== QUALIFICATION_BUNDLE_DOMAIN) bad();
  if (!Array.isArray(record.entries)) bad();
  const entries = record.entries.map(parseEntry);
  assertSorted(entries);
  assertCompleteRoles(entries);
  const cohortId = parseCohortId(record.cohortId);
  const cohortPin = parseCohortPin(record.cohortPin);
  const manifestDigest = parseDigest(record.manifestDigest);
  const recomputed = digestRuntimeIsolationValue({
    schemaVersion: QUALIFICATION_BUNDLE_SCHEMA_VERSION,
    domain: QUALIFICATION_BUNDLE_DOMAIN,
    cohortId,
    entries,
    cohortPin,
  });
  if (recomputed !== manifestDigest) bad();
  return deepFreeze({
    schemaVersion: QUALIFICATION_BUNDLE_SCHEMA_VERSION,
    domain: QUALIFICATION_BUNDLE_DOMAIN,
    cohortId,
    entries,
    cohortPin,
    manifestDigest,
  });
}

/**
 * Validate a bundle manifest against the immutable format: schema/shape,
 * complete role set, and a `manifestDigest` that verifies against its content.
 * A drifted/incomplete/tampered bundle is rejected with a stable code.
 */
export function verifyQualificationBundle(value: unknown): QualificationBundleVerification {
  let manifest: QualificationBundleManifest;
  try {
    manifest = parseManifestShapeOnly(value);
  } catch {
    return { status: "rejected", code: QUALIFICATION_BUNDLE_ERROR_CODES.invalidManifest, message: "qualification bundle manifest is invalid" };
  }
  const { manifestDigest, ...withoutDigest } = manifest;
  if (digestRuntimeIsolationValue(withoutDigest) !== manifestDigest) {
    return { status: "rejected", code: QUALIFICATION_BUNDLE_ERROR_CODES.digestMismatch, message: "qualification bundle manifest digest does not verify" };
  }
  try {
    assertSorted(manifest.entries);
    assertCompleteRoles(manifest.entries);
  } catch {
    return { status: "rejected", code: QUALIFICATION_BUNDLE_ERROR_CODES.entryDrift, message: "qualification bundle entries drifted" };
  }
  return { status: "accepted", manifestDigest };
}

// Parse structure/shape but do NOT recompute the digest (so verify* can classify
// a shape-valid-but-digest-mismatched manifest as `digestMismatch`, not `invalidManifest`).
function parseManifestShapeOnly(value: unknown): QualificationBundleManifest {
  const record = strictRecord(value, [
    "schemaVersion", "domain", "cohortId", "entries", "cohortPin", "manifestDigest",
  ]);
  if (record.schemaVersion !== QUALIFICATION_BUNDLE_SCHEMA_VERSION || record.domain !== QUALIFICATION_BUNDLE_DOMAIN) bad();
  if (!Array.isArray(record.entries)) bad();
  return {
    schemaVersion: QUALIFICATION_BUNDLE_SCHEMA_VERSION,
    domain: QUALIFICATION_BUNDLE_DOMAIN,
    cohortId: parseCohortId(record.cohortId),
    entries: record.entries.map(parseEntry),
    cohortPin: parseCohortPin(record.cohortPin),
    manifestDigest: parseDigest(record.manifestDigest),
  };
}

function parseEntry(value: unknown): QualificationBundleEntry {
  const e = strictRecord(value, ["role", "path", "digest", "bytes"]);
  if (!QUALIFICATION_BUNDLE_ENTRY_ROLES.includes(e.role as QualificationBundleEntryRole)) bad();
  if (typeof e.path !== "string" || !BUNDLE_PATH.test(e.path) || e.path.includes("..")) bad();
  if (!Number.isInteger(e.bytes) || (e.bytes as number) < 0 || (e.bytes as number) > 4_294_967_296) bad();
  return deepFreeze({
    role: e.role as QualificationBundleEntryRole,
    path: e.path,
    digest: parseDigest(e.digest),
    bytes: e.bytes as number,
  });
}

function parseCohortPin(value: unknown): QualificationBundleCohortPin {
  const p = strictRecord(value, COHORT_PIN_KEYS);
  return deepFreeze({
    expectedProfileDigest: parseDigest(p.expectedProfileDigest),
    expectedTestSuiteDigest: parseDigest(p.expectedTestSuiteDigest),
    expectedProviderConfigDigest: parseDigest(p.expectedProviderConfigDigest),
    expectedHostPolicyDigest: parseDigest(p.expectedHostPolicyDigest),
    expectedDockerRuntimeRegistrationDigest: parseDigest(p.expectedDockerRuntimeRegistrationDigest),
    expectedWorkloadImageManifestDigest: parseDigest(p.expectedWorkloadImageManifestDigest),
  });
}

function sortEntries(entries: readonly QualificationBundleEntry[]): QualificationBundleEntry[] {
  return [...entries].sort((a, b) => (a.role === b.role ? compare(a.path, b.path) : compare(a.role, b.role)));
}

function assertSorted(entries: readonly QualificationBundleEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const order = prev.role === cur.role ? compare(prev.path, cur.path) : compare(prev.role, cur.role);
    if (order >= 0) bad(); // unsorted OR duplicate (role,path)
  }
}

function assertCompleteRoles(entries: readonly QualificationBundleEntry[]): void {
  for (const role of SINGLETON_ROLES) {
    if (entries.filter((e) => e.role === role).length !== 1) bad();
  }
  if (entries.filter((e) => e.role === "qualification-helper").length < 1) bad();
}

function parseCohortId(value: unknown): string {
  if (typeof value !== "string" || !COHORT_ID.test(value)) bad();
  return value;
}

function parseDigest(value: unknown): RuntimeIsolationDigest {
  if (typeof value !== "string" || !DIGEST.test(value)) bad();
  return value as RuntimeIsolationDigest;
}

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) bad();
  return record;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
