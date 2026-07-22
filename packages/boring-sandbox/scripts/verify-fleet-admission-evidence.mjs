#!/usr/bin/env node

// SBX1.2 — strict, all-passed fleet-admission validator CLI.
//
// Usage:
//   node scripts/verify-fleet-admission-evidence.mjs <bundle.json> <evidence.json>
//
// Validates a qualification bundle manifest + V3 evidence envelope against the
// production V3 contract: bundle immutability, evidence self-consistency, the
// production profile shape, all eleven probes `passed` (`unproven` rejected),
// all eleven positive controls true, redaction flags false, and cohort binding.
// Exit code 0 and the accepted evidence/bundle digests + safe profile facts on
// stdout only when EVERY check passes; non-zero with a stable error code
// otherwise. Diagnostics go to stderr.
//
// NON-ADMITTING: a 0 exit means "this evidence satisfies the V3 contract". It
// does NOT admit a production image or a box — that is SBX1.5's fleet-admission
// gate. This tool also does not implement the runsc runtime (SBX1.3) or the
// daemon (SBX1.4).

import { readFileSync } from "node:fs";

import { verifyFleetAdmission } from "../dist/providers/runsc/index.js";

function fail(message) {
  process.stderr.write(`verify-fleet-admission-evidence: ${message}\n`);
  process.exit(2);
}

const [bundlePath, evidencePath] = process.argv.slice(2);
if (!bundlePath || !evidencePath) {
  fail("usage: verify-fleet-admission-evidence.mjs <bundle.json> <evidence.json>");
}

let bundle;
let evidence;
try {
  bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
} catch (error) {
  fail(`cannot read bundle: ${error.message}`);
}
try {
  evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
} catch (error) {
  fail(`cannot read evidence: ${error.message}`);
}

const result = verifyFleetAdmission({ bundle, evidence });
if (result.status === "rejected") {
  process.stderr.write(`verify-fleet-admission-evidence: REJECTED [${result.code}] ${result.message}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  status: "accepted",
  evidenceDigest: result.evidenceDigest,
  bundleDigest: result.bundleDigest,
  facts: result.facts,
}, null, 2)}\n`);
process.stderr.write("verify-fleet-admission-evidence: NON-ADMITTING contract check passed (SBX1.5 admits boxes, not this tool)\n");
