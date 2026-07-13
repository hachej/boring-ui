import { createHash } from "node:crypto";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  type RuntimeIsolationDigest,
  type RuntimeIsolationErrorCode,
  type RuntimeIsolationEvidenceV1,
  type RuntimeIsolationEvidenceVerification,
  type RuntimeIsolationProfileV1,
} from "../../shared/runtimeIsolation";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_FACT = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;
const PROFILE_KEYS = [
  "schemaVersion", "provider", "kernelRelease", "runtimeVersion",
  "runtimeBinaryDigest", "rootfsBinaryDigest", "platformMode", "privilegeModel", "containerCapabilities", "workloadIdentity",
  "networkPolicy", "cgroupPolicy", "providerConfigDigest", "hostPolicyDigest",
] as const;

export function digestRuntimeIsolationValue(value: unknown): RuntimeIsolationDigest {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function createRuntimeIsolationEvidence(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  probes: unknown;
  positiveControls: unknown;
}): RuntimeIsolationEvidenceV1 {
  const profile = parseProfile(input.profile);
  const testSuiteDigest = parseDigest(input.testSuiteDigest);
  const probes = parseProbes(input.probes);
  const positiveControls = parsePositiveControls(input.positiveControls);
  const withoutDigest = {
    schemaVersion: 1 as const,
    domain: "boring-runtime-isolation-evidence:v1" as const,
    profile,
    profileDigest: digestRuntimeIsolationValue(profile),
    testSuiteDigest,
    probes,
    positiveControls,
    redaction: {
      containsHostPaths: false as const,
      containsSecrets: false as const,
      containsHostPids: false as const,
    },
  };
  return deepFreeze({ ...withoutDigest, evidenceDigest: digestRuntimeIsolationValue(withoutDigest) });
}

export function verifyRuntimeIsolationEvidence(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification {
  let evidence: RuntimeIsolationEvidenceV1;
  try {
    evidence = parseEvidence(value);
  } catch {
    return rejected(RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid, "runtime isolation evidence is invalid");
  }
  try {
    const profile = parseProfile(observedProfile);
    const suiteDigest = parseDigest(observedTestSuiteDigest);
    if (evidence.testSuiteDigest !== suiteDigest || evidence.profileDigest !== digestRuntimeIsolationValue(profile)) {
      return rejected(RUNTIME_ISOLATION_ERROR_CODES.profileDrift, "runtime isolation qualification drifted");
    }
    if (canonicalJson(evidence.profile) !== canonicalJson(profile)) {
      return rejected(RUNTIME_ISOLATION_ERROR_CODES.profileDrift, "runtime isolation qualification drifted");
    }
    const { evidenceDigest, ...withoutDigest } = evidence;
    if (evidenceDigest !== digestRuntimeIsolationValue(withoutDigest)) {
      return rejected(RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid, "runtime isolation evidence digest is invalid");
    }
    return { status: "accepted", evidenceDigest };
  } catch {
    return rejected(RUNTIME_ISOLATION_ERROR_CODES.profileDrift, "runtime isolation qualification drifted");
  }
}

function parseEvidence(value: unknown): RuntimeIsolationEvidenceV1 {
  const record = strictRecord(value, [
    "schemaVersion", "domain", "profile", "profileDigest", "testSuiteDigest", "probes",
    "positiveControls", "redaction", "evidenceDigest",
  ]);
  if (record.schemaVersion !== 1 || record.domain !== "boring-runtime-isolation-evidence:v1") invalid();
  const redaction = strictRecord(record.redaction, ["containsHostPaths", "containsSecrets", "containsHostPids"]);
  if (redaction.containsHostPaths !== false || redaction.containsSecrets !== false || redaction.containsHostPids !== false) invalid();
  return {
    schemaVersion: 1,
    domain: "boring-runtime-isolation-evidence:v1",
    profile: parseProfile(record.profile),
    profileDigest: parseDigest(record.profileDigest),
    testSuiteDigest: parseDigest(record.testSuiteDigest),
    probes: parseProbes(record.probes),
    positiveControls: parsePositiveControls(record.positiveControls),
    redaction: { containsHostPaths: false, containsSecrets: false, containsHostPids: false },
    evidenceDigest: parseDigest(record.evidenceDigest),
  };
}

function parseProfile(value: unknown): RuntimeIsolationProfileV1 {
  const p = strictRecord(value, PROFILE_KEYS);
  const limits = strictRecord(p.cgroupPolicy, ["version", "cpuQuotaMicros", "cpuPeriodMicros", "memoryBytes", "pidsMax"]);
  if (
    p.schemaVersion !== 1 || p.provider !== "runsc" || p.platformMode !== "systrap" ||
    p.privilegeModel !== "sudo-root" || p.workloadIdentity !== "uid-65532-gid-65532" ||
    p.networkPolicy !== "isolated-veth-no-default-route" || limits.version !== 2 ||
    limits.cpuQuotaMicros !== 50_000 || limits.cpuPeriodMicros !== 100_000 ||
    limits.memoryBytes !== 134_217_728 || limits.pidsMax !== 64 ||
    !Array.isArray(p.containerCapabilities) || p.containerCapabilities.length !== 0
  ) invalid();
  for (const fact of [p.kernelRelease, p.runtimeVersion]) {
    if (typeof fact !== "string" || !SAFE_FACT.test(fact)) invalid();
  }
  return deepFreeze({
    schemaVersion: 1, provider: "runsc", kernelRelease: p.kernelRelease as string,
    runtimeVersion: p.runtimeVersion as string,
    runtimeBinaryDigest: parseDigest(p.runtimeBinaryDigest), rootfsBinaryDigest: parseDigest(p.rootfsBinaryDigest),
    platformMode: "systrap", privilegeModel: "sudo-root",
    containerCapabilities: [], workloadIdentity: "uid-65532-gid-65532", networkPolicy: "isolated-veth-no-default-route",
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    providerConfigDigest: parseDigest(p.providerConfigDigest), hostPolicyDigest: parseDigest(p.hostPolicyDigest),
  });
}

function parseProbes(value: unknown): RuntimeIsolationEvidenceV1["probes"] {
  const p = strictRecord(value, RUNTIME_ISOLATION_PROBE_IDS);
  for (const id of RUNTIME_ISOLATION_PROBE_IDS) if (p[id] !== "passed") invalid();
  return deepFreeze(Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, "passed"])) as unknown as RuntimeIsolationEvidenceV1["probes"]);
}

function parsePositiveControls(value: unknown): RuntimeIsolationEvidenceV1["positiveControls"] {
  const keys = [
    "ownMarkerReadable",
    "attackerEndpointReachableBeforeHostileCalls",
    "attackerEndpointReachableAfterHostileCalls",
    "siblingEndpointReachableFromSibling",
    "siblingCanaryReadableFromSibling",
    "siblingAliveBeforeHostileCalls",
    "siblingAliveAfterHostileCalls",
  ] as const;
  const controls = strictRecord(value, keys);
  for (const key of keys) if (controls[key] !== true) invalid();
  return deepFreeze(Object.fromEntries(keys.map((key) => [key, true])) as unknown as RuntimeIsolationEvidenceV1["positiveControls"]);
}

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return record;
}

function parseDigest(value: unknown): RuntimeIsolationDigest {
  if (typeof value !== "string" || !DIGEST.test(value)) invalid();
  return value as RuntimeIsolationDigest;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(): never { throw new Error("invalid runtime isolation evidence"); }
function rejected(code: RuntimeIsolationErrorCode, message: string): RuntimeIsolationEvidenceVerification {
  return { status: "rejected", code, message };
}
