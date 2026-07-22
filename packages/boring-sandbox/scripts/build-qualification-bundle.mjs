#!/usr/bin/env node

// SBX1.2 — reproducible builder for the immutable, cohort-specific qualification
// bundle manifest. Given a cohort spec (cohort id, the files to pin by role, and
// the cohort pin digests), it checksums each file on disk and emits a
// content-addressed, self-verifying manifest to stdout.
//
// Usage:
//   node scripts/build-qualification-bundle.mjs <cohort-spec.json> > bundle.json
//
// The spec is:
//   {
//     "cohortId": "<reviewed-git-sha>",
//     "root": "<dir the entry paths are relative to>",   // optional, defaults to package root
//     "files": [ { "role": "provider-entry", "path": "dist/providers/runsc/index.js" }, ... ],
//     "cohortPin": { "expectedProfileDigest": "sha256:...", ... }
//   }
//
// Reproducible: the same files + spec always yield the same manifestDigest.
// This is an ordinary release manifest, NOT a content-addressed store or a
// publication journal, and building it admits NOTHING (admission is SBX1.5).

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildQualificationBundleManifest } from "../dist/providers/runsc/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");

function fail(message) {
  process.stderr.write(`build-qualification-bundle: ${message}\n`);
  process.exit(1);
}

const specPath = process.argv[2];
if (!specPath) fail("usage: build-qualification-bundle.mjs <cohort-spec.json>");

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  fail(`cannot read cohort spec: ${error.message}`);
}

const root = spec.root ? resolve(dirname(resolve(specPath)), spec.root) : PACKAGE_ROOT;
if (!Array.isArray(spec.files) || spec.files.length === 0) fail("spec.files must be a non-empty array");

const entries = spec.files.map((file) => {
  if (!file || typeof file.role !== "string" || typeof file.path !== "string") {
    fail("each file needs a string role and path");
  }
  const abs = join(root, file.path);
  let bytes;
  let digest;
  try {
    const contents = readFileSync(abs);
    bytes = statSync(abs).size;
    digest = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
  } catch (error) {
    fail(`cannot checksum ${file.path}: ${error.message}`);
  }
  return { role: file.role, path: file.path, digest, bytes };
});

let manifest;
try {
  manifest = buildQualificationBundleManifest({
    cohortId: spec.cohortId,
    entries,
    cohortPin: spec.cohortPin,
  });
} catch (error) {
  fail(`invalid cohort bundle: ${error.message}`);
}

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
process.stderr.write(`build-qualification-bundle: cohort=${manifest.cohortId} manifestDigest=${manifest.manifestDigest}\n`);
