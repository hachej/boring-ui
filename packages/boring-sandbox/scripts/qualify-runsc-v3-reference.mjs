#!/usr/bin/env node

// SBX1.2 — NON-ADMITTING reference/fixture harness for the production V3
// qualification contract.
//
// =============================================================================
//  THIS HARNESS DOES NOT ADMIT ANY PRODUCTION IMAGE OR BOX.
//  It runs NO docker, NO runsc, and NO real isolation probes. It emits a
//  REFERENCE V3 evidence envelope + matching cohort bundle built from FIXED
//  placeholder digests, purely to exercise the create -> bundle -> validate
//  contract offline (CI, docs, local sanity).
//
//  Real admitting evidence comes only from the adversarial docker+runsc
//  harness (qualify-docker-runsc-isolation.mjs, evolved to V3 in SBX1.3+) on a
//  qualified host, gated by SBX1.5's protected self-hosted fleet-admission job.
// =============================================================================
//
// Usage:
//   node scripts/qualify-runsc-v3-reference.mjs > reference-v3-evidence.json
//   # optional: --bundle-out=<path> also writes the reference bundle manifest.

import { writeFileSync } from "node:fs";

import {
  RUNTIME_ISOLATION_PROBE_IDS,
  RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS,
  buildQualificationBundleManifest,
  createRuntimeIsolationEvidenceV3,
  digestRuntimeIsolationValue,
  verifyFleetAdmission,
} from "../dist/providers/runsc/index.js";

const BANNER =
  "\n============================================================\n" +
  " NON-ADMITTING REFERENCE HARNESS — emits fixture V3 evidence.\n" +
  " No docker, no runsc, no real probes. Admits NOTHING (SBX1.5).\n" +
  "============================================================\n";
process.stderr.write(BANNER);

// Fixed reference (placeholder) digests — obviously synthetic, never a real host.
const ref = (label) => `sha256:${label.repeat(64).slice(0, 64)}`;

const profile = {
  schemaVersion: 3,
  provider: "runsc",
  launcher: "docker-runsc",
  privilegeModel: "docker-runsc-nonroot",
  hostKernelRelease: "0.0.0-reference-non-admitting",
  guestKernelRelease: "4.19.0-gvisor",
  dockerServerVersion: "0.0.0-reference",
  runtimeVersion: "release-reference",
  runtimeBinaryDigest: ref("a"),
  rootfsBinaryDigest: ref("f"),
  platformMode: "systrap",
  containerCapabilities: [],
  workloadIdentity: "uid-65532-gid-65532",
  networkPolicy: "none",
  workspaceMountPolicy: "readwrite-workspace-only",
  workspaceQuota: { bytesQuota: 1_073_741_824, inodeQuota: 65_536 },
  cgroupPolicy: { version: 2, cpuQuotaMicros: 50_000, cpuPeriodMicros: 100_000, memoryBytes: 134_217_728, pidsMax: 64 },
  workloadImage: {
    repository: "reference.invalid/non-admitting-fixture",
    repositoryDigest: ref("2"),
    manifestDigest: ref("3"),
    architecture: "amd64",
  },
  dockerRuntimeRegistrationDigest: ref("4"),
  providerConfigDigest: ref("b"),
  hostPolicyDigest: ref("c"),
};

const testSuiteDigest = ref("d");
const bundle = buildQualificationBundleManifest({
  cohortId: "reference-non-admitting",
  entries: [
    { role: "provider-entry", path: "dist/providers/runsc/index.js", digest: ref("10"), bytes: 4096 },
    { role: "evidence-schema-source", path: "src/shared/runtimeIsolation.ts", digest: ref("11"), bytes: 8192 },
    { role: "evidence-validator-source", path: "src/providers/runsc/isolationEvidence.ts", digest: ref("12"), bytes: 8192 },
    { role: "qualification-script", path: "scripts/qualify-docker-runsc-isolation.mjs", digest: ref("13"), bytes: 27000 },
    { role: "probe-source", path: "scripts/runtime-isolation-probe.c", digest: ref("14"), bytes: 2900 },
    { role: "probe-static-binary", path: "bundle/runtime-isolation-probe", digest: ref("15"), bytes: 16000 },
    { role: "qualification-helper", path: "bundle/busybox", digest: ref("16"), bytes: 800000 },
  ],
  cohortPin: {
    expectedProfileDigest: digestRuntimeIsolationValue(profile),
    expectedTestSuiteDigest: testSuiteDigest,
    expectedProviderConfigDigest: profile.providerConfigDigest,
    expectedHostPolicyDigest: profile.hostPolicyDigest,
    expectedDockerRuntimeRegistrationDigest: profile.dockerRuntimeRegistrationDigest,
    expectedWorkloadImageManifestDigest: profile.workloadImage.manifestDigest,
  },
});

const evidence = createRuntimeIsolationEvidenceV3({
  profile,
  testSuiteDigest,
  qualificationBundleDigest: bundle.manifestDigest,
  qualificationRunId: "reference-run-non-admitting",
  qualificationTimestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  probes: Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, { status: "passed" }])),
  positiveControls: Object.fromEntries(RUNTIME_ISOLATION_V3_POSITIVE_CONTROL_KEYS.map((k) => [k, true])),
  coldStartLatency: null,
});

// Self-check: the reference pair must satisfy the strict contract (proves the
// contract + tooling wire together), while remaining non-admitting fixture data.
const check = verifyFleetAdmission({ bundle, evidence });
if (check.status !== "accepted") {
  process.stderr.write(`qualify-runsc-v3-reference: reference pair failed self-check [${check.code}] ${check.message}\n`);
  process.exit(1);
}

const bundleOutArg = process.argv.find((a) => a.startsWith("--bundle-out="));
if (bundleOutArg) {
  writeFileSync(bundleOutArg.slice("--bundle-out=".length), `${JSON.stringify(bundle, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
process.stderr.write(
  `qualify-runsc-v3-reference: emitted NON-ADMITTING reference evidence (evidenceDigest=${evidence.evidenceDigest})\n`,
);
