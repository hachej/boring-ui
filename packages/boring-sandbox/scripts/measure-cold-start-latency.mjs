#!/usr/bin/env node

// D1-006rq: cold-start latency harness for the docker-launched runsc profile.
//
// Measures wall-clock container start latency for `docker run --runtime=runsc`
// (runtime under test) versus `docker run --runtime=runc` (baseline), using the
// same realistic agent image and the same trivial workload command (`true`) so
// the measurement captures engine + sandbox startup, not workload time. Each of
// the four {runsc,runc} x {warm,cold} cells is sampled n>=20 times.
//
//   warm: image resident and page cache hot; back-to-back runs.
//   cold: host page cache dropped once before the batch via
//         `sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'`. Per-run cache drop
//         for a still-resident image is largely theoretical (the kernel repopulates
//         cache as soon as the image bytes are read), so this harness drops caches
//         once at the head of each cold batch and reports that honestly rather than
//         claiming a fully cold filesystem for every individual run.
//
// Emits a JSON document with raw sample arrays plus computed stats, and a
// `evidence` section shaped as RuntimeIsolationColdStartEvidence for embedding
// into the signed isolation evidence (via qualify-docker-runsc-isolation.mjs
// --latency=<path>). Actually run on the host; numbers are real.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DOCKER = process.env.BORING_DOCKER_BINARY ?? "docker";
const IMAGE = process.env.BORING_LATENCY_IMAGE ?? "node:20-slim";
const COMMAND = "true";
const RUNTIMES = ["runsc", "runc"];
const CACHE_STATES = ["warm", "cold"];
const N_ARG = process.argv.find((a) => a.startsWith("--n="));
const N = Math.max(20, N_ARG ? Number.parseInt(N_ARG.slice("--n=".length), 10) || 0 : 20);
const OUT_ARG = process.argv.find((a) => a.startsWith("--out="));
const OUT_PATH = OUT_ARG ? OUT_ARG.slice("--out=".length) : null;
const WARMUP = 3;

main();

function main() {
  ensureImage();
  const imageDigest = imageContentDigest();
  const cells = [];
  const samplesByCell = {};

  for (const runtime of RUNTIMES) {
    // warmups (not recorded) to stabilize runtime daemon paths.
    for (let i = 0; i < WARMUP; i++) timeRun(runtime);
    for (const cacheState of CACHE_STATES) {
      if (cacheState === "cold") dropPageCache();
      const samples = [];
      for (let i = 0; i < N; i++) {
        if (cacheState === "cold" && i === 0) dropPageCache();
        samples.push(timeRun(runtime));
      }
      samplesByCell[`${runtime}:${cacheState}`] = samples;
      cells.push({ runtime, cacheState, n: samples.length, ...stats(samples) });
      process.stderr.write(
        `${runtime}/${cacheState}: n=${samples.length} p50=${round(percentile(samples, 50))}ms p95=${round(percentile(samples, 95))}ms\n`,
      );
    }
  }

  const document = {
    schemaVersion: 1,
    kind: "docker-runsc-cold-start-latency",
    host: { kernelRelease: hostKernel(), measuredAtUnixSeconds: Math.floor(Date.now() / 1000) },
    dropCachesUsed: CACHE_STATES.includes("cold"),
    evidence: {
      image: IMAGE,
      imageDigest,
      command: COMMAND,
      methodology:
        `docker run --rm --runtime=RUNTIME ${IMAGE} ${COMMAND}; wall-clock from spawn to exit via process.hrtime; ` +
        `n=${N} per cell; ${WARMUP} unrecorded warmups per runtime; cold drops page cache at batch head`,
      samples: cells.map((c) => ({
        runtime: c.runtime,
        cacheState: c.cacheState,
        n: c.n,
        p50Ms: round(c.p50Ms),
        p95Ms: round(c.p95Ms),
        meanMs: round(c.meanMs),
        minMs: round(c.minMs),
        maxMs: round(c.maxMs),
        stdevMs: round(c.stdevMs),
      })),
    },
    rawSamplesMs: samplesByCell,
  };

  const json = `${JSON.stringify(document, null, 2)}\n`;
  if (OUT_PATH) writeFileSync(OUT_PATH, json);
  process.stdout.write(json);
}

function ensureImage() {
  if (command(DOCKER, ["image", "inspect", IMAGE], { allowFailure: true }).status !== 0) {
    if (command(DOCKER, ["pull", IMAGE], { allowFailure: true, timeoutMs: 300_000 }).status !== 0) {
      throw new Error(`latency image unavailable and cannot be pulled: ${IMAGE}`);
    }
  }
}

function imageContentDigest() {
  const id = command(DOCKER, ["image", "inspect", "-f", "{{.Id}}", IMAGE]).stdout.trim();
  const match = /^sha256:([a-f0-9]{64})$/.exec(id);
  if (match) return id;
  // Fall back to hashing the image id string if the engine reports a non-sha256 id.
  return `sha256:${createHash("sha256").update(id).digest("hex")}`;
}

function timeRun(runtime) {
  const start = process.hrtime.bigint();
  const result = spawnSync(DOCKER, ["run", "--rm", `--runtime=${runtime}`, IMAGE, COMMAND], {
    encoding: "utf8",
    timeout: 120_000,
    stdio: "ignore",
  });
  const end = process.hrtime.bigint();
  if (result.error || result.signal || (result.status ?? 255) !== 0) {
    throw new Error(`docker run failed for runtime=${runtime}`);
  }
  return Number(end - start) / 1_000_000;
}

function dropPageCache() {
  let lastStderr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync("sudo", ["-n", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (!result.error && (result.status ?? 255) === 0) return;
    lastStderr = result.stderr ?? result.error?.message ?? "";
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`failed to drop page cache (passwordless sudo required for cold measurements): ${lastStderr.trim()}`);
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const variance = samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
  return {
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    meanMs: mean,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    stdevMs: Math.sqrt(variance),
  };
}

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function hostKernel() {
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8").trim();
  } catch {
    return "unavailable";
  }
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeoutMs ?? 30_000,
  });
  const status = result.status ?? 255;
  if (result.error || result.signal || (!options.allowFailure && status !== 0)) throw new Error("host command failed");
  return { status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
