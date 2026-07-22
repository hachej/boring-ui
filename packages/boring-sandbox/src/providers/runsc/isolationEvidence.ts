import { createHash } from "node:crypto";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  type RuntimeIsolationColdStartEvidence,
  type RuntimeIsolationColdStartSample,
  type RuntimeIsolationDigest,
  type RuntimeIsolationErrorCode,
  type RuntimeIsolationEvidenceV1,
  type RuntimeIsolationEvidenceV2,
  type RuntimeIsolationEvidenceVerification,
  type RuntimeIsolationProbeOutcome,
  type RuntimeIsolationProfileV1,
  type RuntimeIsolationProfileV2,
  type RuntimeIsolationEvidenceV3,
  type RuntimeIsolationProfileV3,
  type RuntimeIsolationWorkloadImage,
  type RuntimeIsolationWorkspaceQuota,
  RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS,
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

// --- Schema v2: docker-launched runsc profile (additive; v1 above is untouched) ---

const SAFE_TEXT = /^[a-zA-Z0-9 ._:;@,/()+=%-]{1,512}$/;
const PROFILE_V2_KEYS = [
  "schemaVersion", "provider", "launcher", "privilegeModel", "kernelRelease", "runtimeVersion",
  "runtimeBinaryDigest", "rootfsBinaryDigest", "platformMode", "containerCapabilities", "workloadIdentity",
  "networkPolicy", "cgroupPolicy", "providerConfigDigest", "hostPolicyDigest",
] as const;
const LATENCY_RUNTIMES = ["runsc", "runc"] as const;
const LATENCY_CACHE_STATES = ["warm", "cold"] as const;
const LATENCY_SAMPLE_KEYS = [
  "runtime", "cacheState", "n", "p50Ms", "p95Ms", "meanMs", "minMs", "maxMs", "stdevMs",
] as const;

export function createDockerRuntimeIsolationEvidence(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  probes: unknown;
  positiveControls: unknown;
  coldStartLatency?: unknown;
}): RuntimeIsolationEvidenceV2 {
  const profile = parseProfileV2(input.profile);
  const testSuiteDigest = parseDigest(input.testSuiteDigest);
  const probes = parseProbesV2(input.probes);
  const positiveControls = parsePositiveControls(input.positiveControls);
  const coldStartLatency =
    input.coldStartLatency === undefined || input.coldStartLatency === null
      ? null
      : parseColdStartLatency(input.coldStartLatency);
  const withoutDigest = {
    schemaVersion: 2 as const,
    domain: "boring-runtime-isolation-evidence:v2" as const,
    profile,
    profileDigest: digestRuntimeIsolationValue(profile),
    testSuiteDigest,
    probes,
    positiveControls,
    coldStartLatency,
    redaction: {
      containsHostPaths: false as const,
      containsSecrets: false as const,
      containsHostPids: false as const,
    },
  };
  return deepFreeze({ ...withoutDigest, evidenceDigest: digestRuntimeIsolationValue(withoutDigest) });
}

export function verifyDockerRuntimeIsolationEvidence(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification {
  let evidence: RuntimeIsolationEvidenceV2;
  try {
    evidence = parseEvidenceV2(value);
  } catch {
    return rejected(RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid, "runtime isolation evidence is invalid");
  }
  try {
    const profile = parseProfileV2(observedProfile);
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

function parseEvidenceV2(value: unknown): RuntimeIsolationEvidenceV2 {
  const record = strictRecord(value, [
    "schemaVersion", "domain", "profile", "profileDigest", "testSuiteDigest", "probes",
    "positiveControls", "coldStartLatency", "redaction", "evidenceDigest",
  ]);
  if (record.schemaVersion !== 2 || record.domain !== "boring-runtime-isolation-evidence:v2") invalid();
  const redaction = strictRecord(record.redaction, ["containsHostPaths", "containsSecrets", "containsHostPids"]);
  if (redaction.containsHostPaths !== false || redaction.containsSecrets !== false || redaction.containsHostPids !== false) invalid();
  return {
    schemaVersion: 2,
    domain: "boring-runtime-isolation-evidence:v2",
    profile: parseProfileV2(record.profile),
    profileDigest: parseDigest(record.profileDigest),
    testSuiteDigest: parseDigest(record.testSuiteDigest),
    probes: parseProbesV2(record.probes),
    positiveControls: parsePositiveControls(record.positiveControls),
    coldStartLatency: record.coldStartLatency === null ? null : parseColdStartLatency(record.coldStartLatency),
    redaction: { containsHostPaths: false, containsSecrets: false, containsHostPids: false },
    evidenceDigest: parseDigest(record.evidenceDigest),
  };
}

function parseProfileV2(value: unknown): RuntimeIsolationProfileV2 {
  const p = strictRecord(value, PROFILE_V2_KEYS);
  const limits = strictRecord(p.cgroupPolicy, ["version", "cpuQuotaMicros", "cpuPeriodMicros", "memoryBytes", "pidsMax"]);
  if (
    p.schemaVersion !== 2 || p.provider !== "runsc" || p.launcher !== "docker-runsc" ||
    p.privilegeModel !== "docker-runsc-nonroot" || p.platformMode !== "systrap" ||
    p.workloadIdentity !== "uid-65532-gid-65532" ||
    p.networkPolicy !== "isolated-internal-bridge-no-default-route" || limits.version !== 2 ||
    limits.cpuQuotaMicros !== 50_000 || limits.cpuPeriodMicros !== 100_000 ||
    limits.memoryBytes !== 134_217_728 || limits.pidsMax !== 64 ||
    !Array.isArray(p.containerCapabilities) || p.containerCapabilities.length !== 0
  ) invalid();
  for (const fact of [p.kernelRelease, p.runtimeVersion]) {
    if (typeof fact !== "string" || !SAFE_FACT.test(fact)) invalid();
  }
  return deepFreeze({
    schemaVersion: 2, provider: "runsc", launcher: "docker-runsc", privilegeModel: "docker-runsc-nonroot",
    kernelRelease: p.kernelRelease as string, runtimeVersion: p.runtimeVersion as string,
    runtimeBinaryDigest: parseDigest(p.runtimeBinaryDigest), rootfsBinaryDigest: parseDigest(p.rootfsBinaryDigest),
    platformMode: "systrap", containerCapabilities: [], workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "isolated-internal-bridge-no-default-route",
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    providerConfigDigest: parseDigest(p.providerConfigDigest), hostPolicyDigest: parseDigest(p.hostPolicyDigest),
  });
}

function parseProbesV2(value: unknown): RuntimeIsolationEvidenceV2["probes"] {
  const p = strictRecord(value, RUNTIME_ISOLATION_PROBE_IDS);
  const parsed: Record<string, RuntimeIsolationProbeOutcome> = {};
  for (const id of RUNTIME_ISOLATION_PROBE_IDS) {
    parsed[id] = parseProbeOutcome(p[id]);
  }
  return deepFreeze(parsed as unknown as RuntimeIsolationEvidenceV2["probes"]);
}

function parseProbeOutcome(value: unknown): RuntimeIsolationProbeOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (record.status === "passed") {
    strictRecord(value, ["status"]);
    return { status: "passed" };
  }
  if (record.status === "unproven") {
    const parsed = strictRecord(value, ["status", "reason"]);
    if (typeof parsed.reason !== "string" || !SAFE_TEXT.test(parsed.reason)) invalid();
    return { status: "unproven", reason: parsed.reason };
  }
  return invalid();
}

function parseColdStartLatency(value: unknown): RuntimeIsolationColdStartEvidence {
  const record = strictRecord(value, ["image", "imageDigest", "command", "methodology", "samples"]);
  for (const text of [record.image, record.command, record.methodology]) {
    if (typeof text !== "string" || !SAFE_TEXT.test(text)) invalid();
  }
  if (!Array.isArray(record.samples) || record.samples.length < 1 || record.samples.length > 8) invalid();
  const samples = record.samples.map(parseColdStartSample);
  return deepFreeze({
    image: record.image as string,
    imageDigest: parseDigest(record.imageDigest),
    command: record.command as string,
    methodology: record.methodology as string,
    samples,
  });
}

function parseColdStartSample(value: unknown): RuntimeIsolationColdStartSample {
  const s = strictRecord(value, LATENCY_SAMPLE_KEYS);
  if (!LATENCY_RUNTIMES.includes(s.runtime as never)) invalid();
  if (!LATENCY_CACHE_STATES.includes(s.cacheState as never)) invalid();
  if (!Number.isInteger(s.n) || (s.n as number) < 1 || (s.n as number) > 100_000) invalid();
  for (const metric of [s.p50Ms, s.p95Ms, s.meanMs, s.minMs, s.maxMs, s.stdevMs]) {
    if (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0 || metric > 3_600_000) invalid();
  }
  return deepFreeze({
    runtime: s.runtime as RuntimeIsolationColdStartSample["runtime"],
    cacheState: s.cacheState as RuntimeIsolationColdStartSample["cacheState"],
    n: s.n as number,
    p50Ms: s.p50Ms as number, p95Ms: s.p95Ms as number, meanMs: s.meanMs as number,
    minMs: s.minMs as number, maxMs: s.maxMs as number, stdevMs: s.stdevMs as number,
  });
}

function invalid(): never { throw new Error("invalid runtime isolation evidence"); }
function rejected(code: RuntimeIsolationErrorCode, message: string): RuntimeIsolationEvidenceVerification {
  return { status: "rejected", code, message };
}

// --- Schema v3: the production docker+runsc profile (SBX1.2; additive) --------

const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
// Reference cohort quota literals: 1 GiB and 64Ki inodes on the writable workspace.
const WORKSPACE_QUOTA = Object.freeze({ bytesQuota: 1_073_741_824, inodeQuota: 65_536 });
const PROFILE_V3_KEYS = [
  "schemaVersion", "provider", "launcher", "privilegeModel", "hostKernelRelease", "guestKernelRelease",
  "dockerServerVersion", "runtimeVersion", "runtimeBinaryDigest", "rootfsBinaryDigest", "platformMode",
  "containerCapabilities", "workloadIdentity", "networkPolicy", "workspaceMountPolicy", "workspaceQuota",
  "cgroupPolicy", "workloadImage", "dockerRuntimeRegistrationDigest", "providerConfigDigest", "hostPolicyDigest",
] as const;
const EVIDENCE_V3_KEYS = [
  "schemaVersion", "domain", "profile", "profileDigest", "testSuiteDigest", "qualificationBundleDigest",
  "qualificationRunId", "qualificationTimestamp", "probes", "positiveControls", "coldStartLatency",
  "redaction", "evidenceDigest",
] as const;

export function createRuntimeIsolationEvidenceV3(input: {
  profile: unknown;
  testSuiteDigest: unknown;
  qualificationBundleDigest: unknown;
  qualificationRunId: unknown;
  qualificationTimestamp: unknown;
  probes: unknown;
  positiveControls: unknown;
  coldStartLatency?: unknown;
}): RuntimeIsolationEvidenceV3 {
  const profile = parseProfileV3(input.profile);
  const testSuiteDigest = parseDigest(input.testSuiteDigest);
  const qualificationBundleDigest = parseDigest(input.qualificationBundleDigest);
  const qualificationRunId = parseRunId(input.qualificationRunId);
  const qualificationTimestamp = parseTimestamp(input.qualificationTimestamp);
  const probes = parseProbesV2(input.probes);
  const positiveControls = parsePositiveControlsV3(input.positiveControls);
  const coldStartLatency =
    input.coldStartLatency === undefined || input.coldStartLatency === null
      ? null
      : parseColdStartLatency(input.coldStartLatency);
  const withoutDigest = {
    schemaVersion: 3 as const,
    domain: "boring-runtime-isolation-evidence:v3" as const,
    profile,
    profileDigest: digestRuntimeIsolationValue(profile),
    testSuiteDigest,
    qualificationBundleDigest,
    qualificationRunId,
    qualificationTimestamp,
    probes,
    positiveControls,
    coldStartLatency,
    redaction: {
      containsHostPaths: false as const,
      containsSecrets: false as const,
      containsHostPids: false as const,
    },
  };
  return deepFreeze({ ...withoutDigest, evidenceDigest: digestRuntimeIsolationValue(withoutDigest) });
}

/**
 * General V3 evidence parse + self-consistency verification (profile/testsuite
 * drift, digest integrity). Like the V1/V2 verifiers this can still accept
 * `unproven` probes for honest research output; the strict fleet-admission gate
 * ({@link verifyFleetAdmission}) is deliberately stricter and rejects them.
 */
export function verifyRuntimeIsolationEvidenceV3(
  value: unknown,
  observedProfile: unknown,
  observedTestSuiteDigest: unknown,
): RuntimeIsolationEvidenceVerification {
  let evidence: RuntimeIsolationEvidenceV3;
  try {
    evidence = parseEvidenceV3(value);
  } catch {
    return rejected(RUNTIME_ISOLATION_ERROR_CODES.evidenceInvalid, "runtime isolation evidence is invalid");
  }
  try {
    const profile = parseProfileV3(observedProfile);
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

/** Strict parse of a V3 evidence envelope. Throws (via {@link invalid}) on any deviation. */
export function parseRuntimeIsolationEvidenceV3(value: unknown): RuntimeIsolationEvidenceV3 {
  return parseEvidenceV3(value);
}

function parseEvidenceV3(value: unknown): RuntimeIsolationEvidenceV3 {
  const record = strictRecord(value, EVIDENCE_V3_KEYS);
  if (record.schemaVersion !== 3 || record.domain !== "boring-runtime-isolation-evidence:v3") invalid();
  const redaction = strictRecord(record.redaction, ["containsHostPaths", "containsSecrets", "containsHostPids"]);
  if (redaction.containsHostPaths !== false || redaction.containsSecrets !== false || redaction.containsHostPids !== false) invalid();
  return {
    schemaVersion: 3,
    domain: "boring-runtime-isolation-evidence:v3",
    profile: parseProfileV3(record.profile),
    profileDigest: parseDigest(record.profileDigest),
    testSuiteDigest: parseDigest(record.testSuiteDigest),
    qualificationBundleDigest: parseDigest(record.qualificationBundleDigest),
    qualificationRunId: parseRunId(record.qualificationRunId),
    qualificationTimestamp: parseTimestamp(record.qualificationTimestamp),
    probes: parseProbesV2(record.probes),
    positiveControls: parsePositiveControlsV3(record.positiveControls),
    coldStartLatency: record.coldStartLatency === null ? null : parseColdStartLatency(record.coldStartLatency),
    redaction: { containsHostPaths: false, containsSecrets: false, containsHostPids: false },
    evidenceDigest: parseDigest(record.evidenceDigest),
  };
}

function parseProfileV3(value: unknown): RuntimeIsolationProfileV3 {
  const p = strictRecord(value, PROFILE_V3_KEYS);
  const limits = strictRecord(p.cgroupPolicy, ["version", "cpuQuotaMicros", "cpuPeriodMicros", "memoryBytes", "pidsMax"]);
  const quota = parseWorkspaceQuota(p.workspaceQuota);
  const workloadImage = parseWorkloadImage(p.workloadImage);
  if (
    p.schemaVersion !== 3 || p.provider !== "runsc" || p.launcher !== "docker-runsc" ||
    p.privilegeModel !== "docker-runsc-nonroot" || p.platformMode !== "systrap" ||
    p.guestKernelRelease !== "4.19.0-gvisor" ||
    p.workloadIdentity !== "uid-65532-gid-65532" ||
    p.networkPolicy !== "none" || p.workspaceMountPolicy !== "readwrite-workspace-only" ||
    limits.version !== 2 || limits.cpuQuotaMicros !== 50_000 || limits.cpuPeriodMicros !== 100_000 ||
    limits.memoryBytes !== 134_217_728 || limits.pidsMax !== 64 ||
    !Array.isArray(p.containerCapabilities) || p.containerCapabilities.length !== 0
  ) invalid();
  for (const fact of [p.hostKernelRelease, p.dockerServerVersion, p.runtimeVersion]) {
    if (typeof fact !== "string" || !SAFE_FACT.test(fact)) invalid();
  }
  return deepFreeze({
    schemaVersion: 3, provider: "runsc", launcher: "docker-runsc", privilegeModel: "docker-runsc-nonroot",
    hostKernelRelease: p.hostKernelRelease as string, guestKernelRelease: "4.19.0-gvisor",
    dockerServerVersion: p.dockerServerVersion as string, runtimeVersion: p.runtimeVersion as string,
    runtimeBinaryDigest: parseDigest(p.runtimeBinaryDigest), rootfsBinaryDigest: parseDigest(p.rootfsBinaryDigest),
    platformMode: "systrap", containerCapabilities: [], workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "none", workspaceMountPolicy: "readwrite-workspace-only", workspaceQuota: quota,
    cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
    workloadImage,
    dockerRuntimeRegistrationDigest: parseDigest(p.dockerRuntimeRegistrationDigest),
    providerConfigDigest: parseDigest(p.providerConfigDigest), hostPolicyDigest: parseDigest(p.hostPolicyDigest),
  });
}

function parseWorkspaceQuota(value: unknown): RuntimeIsolationWorkspaceQuota {
  const q = strictRecord(value, ["bytesQuota", "inodeQuota"]);
  if (q.bytesQuota !== WORKSPACE_QUOTA.bytesQuota || q.inodeQuota !== WORKSPACE_QUOTA.inodeQuota) invalid();
  return deepFreeze({ bytesQuota: WORKSPACE_QUOTA.bytesQuota, inodeQuota: WORKSPACE_QUOTA.inodeQuota });
}

function parseWorkloadImage(value: unknown): RuntimeIsolationWorkloadImage {
  const i = strictRecord(value, ["repository", "repositoryDigest", "manifestDigest", "architecture"]);
  // Repository may contain registry host + path separators (`/`, `:`, `.`, `-`).
  if (typeof i.repository !== "string" || !SAFE_TEXT.test(i.repository)) invalid();
  if (typeof i.architecture !== "string" || !SAFE_FACT.test(i.architecture)) invalid();
  return deepFreeze({
    repository: i.repository as string,
    repositoryDigest: parseDigest(i.repositoryDigest),
    manifestDigest: parseDigest(i.manifestDigest),
    architecture: i.architecture as string,
  });
}

function parsePositiveControlsV3(value: unknown): RuntimeIsolationEvidenceV3["positiveControls"] {
  const keys = RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS;
  const controls = strictRecord(value, keys);
  for (const key of keys) if (controls[key] !== true) invalid();
  return deepFreeze(
    Object.fromEntries(keys.map((key) => [key, true])) as unknown as RuntimeIsolationEvidenceV3["positiveControls"],
  );
}

function parseRunId(value: unknown): string {
  if (typeof value !== "string" || !RUN_ID.test(value)) invalid();
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) invalid();
  return value;
}
