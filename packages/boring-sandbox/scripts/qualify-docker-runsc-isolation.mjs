#!/usr/bin/env node

// AgentHost-006rq: hostile isolation requalification for the owner-approved
// docker-launched runsc profile (`docker run --runtime=runsc`).
//
// Unlike the direct sudo/OCI-bundle suite (qualify-runsc-isolation.mjs), this
// harness never needs root: docker is driven unprivileged via the `docker`
// group, and host cgroup files are world-readable. It launches TWO containers
// through docker (real gVisor interception, sentinel kernel 4.19.0-gvisor),
// each with its own read-only workspace, non-root workload UID/GID 65532:65532,
// docker-translated resource ceilings, and its own `--internal` bridge network
// on a distinct /30 with no route between them. It runs all 11 hostile probes
// for real and emits a redacted, content-addressed RuntimeIsolationEvidenceV2
// envelope (schema v2). Optionally attaches a cold-start latency section from
// --latency=<path> (produced by measure-cold-start-latency.mjs).

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  createDockerRuntimeIsolationEvidence,
  digestRuntimeIsolationValue,
  verifyDockerRuntimeIsolationEvidence,
} from "../dist/providers/runsc/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const DOCKER = process.env.BORING_DOCKER_BINARY ?? "docker";
const BUSYBOX_SOURCE = process.env.BORING_BUSYBOX_BINARY ?? "/usr/bin/busybox";
const PROBE_SOURCE = join(SCRIPT_DIR, "runtime-isolation-probe.c");
const BASE_IMAGE = process.env.BORING_BASE_IMAGE ?? "alpine:3.20";
const LATENCY_ARG = process.argv.find((a) => a.startsWith("--latency="));
const LATENCY_PATH = LATENCY_ARG ? LATENCY_ARG.slice("--latency=".length) : process.env.BORING_COLDSTART_LATENCY;
const WORKER_FLAG = "--agent-host-isolation-worker";
const IS_WORKER = process.argv.includes(WORKER_FLAG);

const TAG = process.pid.toString(36);
const IMAGE = `boring-agent-host-006rq:${TAG}`;
const CONTAINER_A = `agent-host-006rq-a-${process.pid}`;
const CONTAINER_B = `agent-host-006rq-b-${process.pid}`;
const NETWORK_A = `agent-host-006rq-neta-${process.pid}`;
const NETWORK_B = `agent-host-006rq-netb-${process.pid}`;
const NETWORKS = Object.freeze({
  a: { name: NETWORK_A, subnet: "10.253.240.0/30" },
  b: { name: NETWORK_B, subnet: "10.253.241.0/30" },
});
const LIMITS = Object.freeze({
  version: 2,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  memoryBytes: 134_217_728,
  pidsMax: 64,
});
const HTTP_PORT = 18080;

let stage = "initialization";
let failureStage = null;
const startedContainers = [];
const createdNetworks = [];
let imageBuilt = false;
let workRoot = null;
// Observed from docker's registered runsc runtime, never hardcoded. These bind
// the exact binary docker executes and the platform it was registered with.
let registeredRunscPath = null;
let observedPlatform = null;
let cleanupStarted = false;

if (IS_WORKER) {
try {
  stage = "host prerequisites";
  requirePrerequisites();
  stage = "cgroup v2 controllers";
  const controllers = readCgroupControllers();
  stage = "runtime version observation";
  const runtimeVersion = readRuntimeVersion();
  stage = "workspace/secret/image preparation";
  prepareArtifacts();

  stage = "runtime profile observation";
  const profile = createProfile(runtimeVersion, controllers);
  stage = "test suite digest";
  const testSuiteDigest = createTestSuiteDigest();

  stage = "sandbox a startup";
  startSandbox("a", CONTAINER_A, NETWORK_A);
  stage = "sandbox b startup";
  startSandbox("b", CONTAINER_B, NETWORK_B);

  const ipA = containerIp(CONTAINER_A, NETWORK_A);
  const ipB = containerIp(CONTAINER_B, NETWORK_B);
  const hostPidB = containerHostPid(CONTAINER_B);

  stage = "positive controls before hostile probes";
  assertRunning(CONTAINER_A);
  assertRunning(CONTAINER_B);
  assertExecOutput(CONTAINER_A, ["/bin/busybox-full", "cat", "/workspace/marker"], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/busybox-full", "cat", "/workspace/marker"], "agent-b\n");
  const siblingCanary = readFileSync(join(workRoot, "sibling-secret", "sibling-canary"), "utf8");
  assertExecOutput(CONTAINER_B, ["/bin/busybox-full", "cat", "/run/secrets/sibling-canary"], siblingCanary);
  assertExecOutput(CONTAINER_A, ["/bin/busybox-full", "wget", "-T", "5", "-qO-", `http://${ipA}:${HTTP_PORT}/marker`], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/busybox-full", "wget", "-T", "5", "-qO-", `http://${ipB}:${HTTP_PORT}/marker`], "agent-b\n");

  const probes = {};

  stage = "sibling filesystem traversal probe";
  assertExecSuccess(CONTAINER_A, ["/bin/busybox-full", "test", "!", "-e", "/sibling-workspace/marker"]);
  assertExecSuccess(CONTAINER_A, ["/bin/busybox-full", "test", "!", "-e", "/workspace/../sibling-workspace/marker"]);
  probes["sibling-filesystem-traversal"] = { status: "passed" };

  stage = "secret access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/busybox-full", "test", "!", "-e", "/run/secrets/sibling-canary"]);
  probes["secret-access"] = { status: "passed" };

  stage = "cross-workspace network probe";
  assertExecFailure(CONTAINER_A, ["/bin/busybox-full", "wget", "-T", "5", "-qO-", `http://${ipB}:${HTTP_PORT}/marker`]);
  probes["cross-workspace-network"] = { status: "passed" };

  stage = "proc probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "proc", String(hostPidB)]);
  probes["proc-pid-enumeration"] = { status: "passed" };
  stage = "signal probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "signal", String(hostPidB)]);
  probes["cross-sandbox-signal"] = { status: "passed" };
  stage = "ptrace probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "ptrace", String(hostPidB)]);
  probes["cross-sandbox-ptrace"] = { status: "passed" };

  stage = "mount access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "mount"]);
  probes["mount-access"] = { status: "passed" };
  stage = "device access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "device"]);
  probes["device-access"] = { status: "passed" };
  stage = "process escape probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "escape", join(workRoot, "host-escape-canary")]);
  probes["process-escape"] = { status: "passed" };

  stage = "resource ceiling probe";
  assertCgroupLimits(CONTAINER_A);
  assertCgroupLimits(CONTAINER_B);
  probes["resource-ceilings"] = { status: "passed" };

  stage = "positive controls after hostile probes";
  assertRunning(CONTAINER_A);
  assertRunning(CONTAINER_B);
  assertExecOutput(CONTAINER_A, ["/bin/busybox-full", "wget", "-T", "5", "-qO-", `http://${ipA}:${HTTP_PORT}/marker`], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/busybox-full", "wget", "-T", "5", "-qO-", `http://${ipB}:${HTTP_PORT}/marker`], "agent-b\n");
  assertExecOutput(CONTAINER_B, ["/bin/busybox-full", "cat", "/run/secrets/sibling-canary"], siblingCanary);

  stage = "sandbox teardown";
  const scopeA = cgroupScope(CONTAINER_A);
  const scopeB = cgroupScope(CONTAINER_B);
  teardownContainer(CONTAINER_A);
  teardownContainer(CONTAINER_B);
  startedContainers.length = 0;
  stage = "teardown verification";
  assertContainerGone(CONTAINER_A);
  assertContainerGone(CONTAINER_B);
  waitCgroupGone(scopeA);
  waitCgroupGone(scopeB);
  teardownNetworks();
  probes["teardown"] = { status: "passed" };

  stage = "content-addressed evidence assembly";
  const coldStartLatency = LATENCY_PATH ? loadColdStartLatency(LATENCY_PATH) : null;

  const evidence = createDockerRuntimeIsolationEvidence({
    profile,
    testSuiteDigest,
    probes,
    positiveControls: {
      ownMarkerReadable: true,
      attackerEndpointReachableBeforeHostileCalls: true,
      attackerEndpointReachableAfterHostileCalls: true,
      siblingEndpointReachableFromSibling: true,
      siblingCanaryReadableFromSibling: true,
      siblingAliveBeforeHostileCalls: true,
      siblingAliveAfterHostileCalls: true,
    },
    coldStartLatency,
  });
  const verification = verifyDockerRuntimeIsolationEvidence(evidence, profile, testSuiteDigest);
  if (verification.status !== "accepted" || verification.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error("fresh evidence verification failed");
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  failureStage = stage;
  process.exitCode = 1;
  if (process.env.BORING_DEBUG === "1") process.stderr.write(`DEBUG ${stage}: ${error?.stack ?? error}\n`);
} finally {
  const cleanupIncomplete = cleanupResources();
  if (cleanupIncomplete && failureStage === null) {
    failureStage = "final cleanup";
    process.exitCode = 1;
  }
  if (failureStage !== null) reportFailure(cleanupIncomplete);
}
} else {
  await superviseWorker();
}

async function superviseWorker() {
  const supervisedWorkRoot = join(tmpdir(), `boring-agent-host-006rq-supervised-${process.pid}`);
  const workerArgs = [fileURLToPath(import.meta.url), WORKER_FLAG, ...process.argv.slice(2)];
  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    env: { ...process.env, BORING_AGENT_HOST_006_WORK_ROOT: supervisedWorkRoot },
    shell: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let stopping = false;
  let escalation;
  let forcedSettle;
  let settleWorker;
  const signalGroup = (signal) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error?.code !== "ESRCH") process.exitCode = 1; }
  };
  const forceStop = () => {
    signalGroup("SIGKILL");
    if (!forcedSettle) forcedSettle = setTimeout(() => settleWorker?.(null), 10_000);
  };
  const interrupted = () => {
    if (stopping) { forceStop(); return; }
    stopping = true;
    signalGroup("SIGTERM");
    escalation = setTimeout(forceStop, 5_000);
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const deadline = setTimeout(interrupted, 30 * 60 * 1000);
  const code = await new Promise((accept) => {
    settleWorker = accept;
    child.once("error", () => accept(null));
    child.once("close", accept);
  });
  clearTimeout(deadline);
  if (escalation) clearTimeout(escalation);
  if (forcedSettle) clearTimeout(forcedSettle);
  const cleanupIncomplete = child.pid ? await cleanupSupervisedResources(child.pid, supervisedWorkRoot) : true;
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  if (cleanupIncomplete) {
    process.stderr.write(`${JSON.stringify({ code: RUNTIME_ISOLATION_ERROR_CODES.probeFailed, message: "docker-runsc isolation watchdog cleanup incomplete" })}\n`);
  }
  if (code !== 0 || stopping || cleanupIncomplete) process.exitCode = stopping ? 130 : 1;
}

async function cleanupSupervisedResources(pid, supervisedWorkRoot) {
  const run = (args) => new Promise((accept) => {
    const child = spawn(DOCKER, args, { shell: false, stdio: "ignore" });
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timeout); accept(result); } };
    const timeout = setTimeout(() => { child.kill("SIGKILL"); finish({ status: null, failed: true }); }, 30_000);
    child.once("error", () => finish({ status: null, failed: true }));
    child.once("close", (status) => finish({ status, failed: false }));
  });
  const containers = [`agent-host-006rq-a-${pid}`, `agent-host-006rq-b-${pid}`];
  const networks = [`agent-host-006rq-neta-${pid}`, `agent-host-006rq-netb-${pid}`];
  for (let attempt = 0; attempt < 2; attempt++) {
    await Promise.all(containers.map((name) => run(["rm", "-f", name])));
    await Promise.all([...networks.map((name) => run(["network", "rm", "-f", name])), run(["image", "rm", "-f", `boring-agent-host-006rq:${pid.toString(36)}`])]);
  }
  const inspections = await Promise.all([
    ...containers.map((name) => run(["inspect", name])),
    ...networks.map((name) => run(["network", "inspect", name])),
    run(["image", "inspect", `boring-agent-host-006rq:${pid.toString(36)}`]),
  ]);
  let incomplete = inspections.some((result) => result.failed || result.status === 0);
  try { if (existsSync(supervisedWorkRoot)) rmSync(supervisedWorkRoot, { recursive: true, force: true }); } catch { incomplete = true; }
  if (existsSync(supervisedWorkRoot)) incomplete = true;
  return incomplete;
}

function cleanupResources() {
  if (cleanupStarted) return false;
  cleanupStarted = true;
  let cleanupIncomplete = false;
  for (const id of startedContainers.reverse()) {
    try {
      teardownContainer(id, true);
    } catch {
      cleanupIncomplete = true;
    }
  }
  for (const name of createdNetworks.reverse()) {
    try {
      const result = docker(["network", "rm", name], { allowFailure: true });
      if (result.status !== 0 && docker(["network", "inspect", name], { allowFailure: true }).status === 0) cleanupIncomplete = true;
    } catch {
      cleanupIncomplete = true;
    }
  }
  if (imageBuilt) {
    try {
      const result = docker(["image", "rm", "-f", IMAGE], { allowFailure: true });
      if (result.status !== 0 && docker(["image", "inspect", IMAGE], { allowFailure: true }).status === 0) cleanupIncomplete = true;
    } catch { cleanupIncomplete = true; }
  }
  try {
    if (workRoot && existsSync(workRoot)) rmSync(workRoot, { recursive: true, force: true });
  } catch {
    cleanupIncomplete = true;
  }
  return cleanupIncomplete;
}

function reportFailure(cleanupIncomplete) {
  const suffix = cleanupIncomplete ? "; cleanup incomplete" : "";
  process.stderr.write(
    `${JSON.stringify({ code: RUNTIME_ISOLATION_ERROR_CODES.probeFailed, message: `docker-runsc isolation requalification failed during ${failureStage}${suffix}` })}\n`,
  );
}

function requirePrerequisites() {
  for (const path of [BUSYBOX_SOURCE, PROBE_SOURCE]) {
    if (!lstatSync(path).isFile()) throw new Error("required file unavailable");
  }
  if (!existsSync("/sys/fs/cgroup/cgroup.controllers")) throw new Error("cgroup v2 unavailable");

  // Read docker's REGISTERED runsc runtime — the binary docker actually
  // executes and the platform flag it was registered with. The evidence binds
  // this, not a coincidentally-same host file. BORING_RUNSC_BINARY, when set,
  // is only accepted if it matches the registered path.
  const runtimes = JSON.parse(docker(["info", "--format", "{{json .Runtimes}}"]).stdout);
  const runsc = runtimes?.runsc;
  if (!runsc || typeof runsc.path !== "string" || !runsc.path.startsWith("/")) {
    throw new Error("runsc runtime is not registered with docker");
  }
  registeredRunscPath = runsc.path;
  if (process.env.BORING_RUNSC_BINARY && process.env.BORING_RUNSC_BINARY !== registeredRunscPath) {
    throw new Error("BORING_RUNSC_BINARY does not match docker's registered runsc path");
  }
  if (!lstatSync(registeredRunscPath).isFile()) throw new Error("registered runsc binary unavailable");

  // Observe the platform from the runtime's registered args; never hardcode it.
  const args = Array.isArray(runsc.runtimeArgs) ? runsc.runtimeArgs : [];
  const platformArg = args.map((a) => /^--platform=([a-z0-9_-]{1,32})$/.exec(String(a))).find(Boolean);
  observedPlatform = platformArg ? platformArg[1] : null;
  if (observedPlatform === null) throw new Error("runsc platform not observable from registered runtime args");

  if (docker(["image", "inspect", BASE_IMAGE], { allowFailure: true }).status !== 0) {
    if (docker(["pull", BASE_IMAGE], { allowFailure: true, timeoutMs: 120_000 }).status !== 0) {
      throw new Error("base image unavailable and cannot be pulled");
    }
  }
}

function readCgroupControllers() {
  const controllers = readFileSync("/sys/fs/cgroup/cgroup.controllers", "utf8").trim().split(/\s+/).sort();
  for (const required of ["cpu", "memory", "pids"]) if (!controllers.includes(required)) throw new Error("required cgroup controller absent");
  return controllers;
}

function readRuntimeVersion() {
  const result = spawnSync(registeredRunscPath, ["--version"], { encoding: "utf8", timeout: 30_000 });
  const line = (result.stdout ?? "").split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = /^runsc version ([a-zA-Z0-9._+-]{1,128})$/.exec(line);
  if (!match?.[1]) throw new Error("invalid runtime version");
  return match[1];
}

function prepareArtifacts() {
  const supervised = process.env.BORING_AGENT_HOST_006_WORK_ROOT;
  if (supervised) {
    const expectedPrefix = join(tmpdir(), "boring-agent-host-006rq-supervised-");
    if (!resolve(supervised).startsWith(expectedPrefix) || resolve(supervised) !== supervised) throw new Error("invalid supervised work root");
    mkdirSync(supervised, { mode: 0o700 });
    workRoot = supervised;
  } else {
    workRoot = mkdtempSync(join(tmpdir(), "boring-agent-host-006rq-"));
  }
  const buildDir = join(workRoot, "image");
  mkdirSync(buildDir, { mode: 0o700 });
  copyFileSync(BUSYBOX_SOURCE, join(buildDir, "busybox"));
  command("/usr/bin/gcc", ["-O2", "-static", "-s", "-o", join(buildDir, "isolation-probe"), PROBE_SOURCE]);
  writeFileSync(
    join(buildDir, "Dockerfile"),
    [
      `FROM ${BASE_IMAGE}`,
      "COPY busybox /bin/busybox-full",
      "COPY isolation-probe /bin/isolation-probe",
      "RUN /bin/busybox-full chmod 0555 /bin/busybox-full /bin/isolation-probe && /bin/busybox-full ln -sf /bin/busybox-full /bin/httpd",
      "",
    ].join("\n"),
  );
  docker(["build", "-q", "-t", IMAGE, buildDir], { timeoutMs: 180_000, discardOutput: true });
  imageBuilt = true;

  for (const id of ["a", "b"]) {
    const ws = join(workRoot, `workspace-${id}`);
    mkdirSync(ws, { mode: 0o755 });
    writeFileSync(join(ws, "marker"), `agent-${id}\n`, { mode: 0o444 });
  }
  const secretDir = join(workRoot, "sibling-secret");
  mkdirSync(secretDir, { mode: 0o755 });
  writeFileSync(join(secretDir, "sibling-canary"), `${randomHex()}\n`, { mode: 0o444 });
  writeFileSync(join(workRoot, "host-escape-canary"), `${randomHex()}\n`, { mode: 0o444 });

  for (const id of ["a", "b"]) {
    const net = NETWORKS[id];
    docker(["network", "create", "--internal", "--subnet", net.subnet, net.name], { discardOutput: true });
    createdNetworks.push(net.name);
    const inspected = JSON.parse(docker(["network", "inspect", net.name]).stdout)[0];
    if (inspected?.Internal !== true) throw new Error("network is not internal");
    if (inspected?.IPAM?.Config?.[0]?.Subnet !== net.subnet) throw new Error("network subnet mismatch");
  }
}

function startSandbox(id, containerId, networkName) {
  const args = [
    "run", "-d", "--name", containerId,
    "--runtime=runsc",
    "--user", "65532:65532",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--cpus", "0.5",
    "--memory", "128m",
    "--pids-limit", "64",
    "--network", networkName,
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m",
    "-v", `${join(workRoot, `workspace-${id}`)}:/workspace:ro`,
  ];
  if (id === "b") args.push("-v", `${join(workRoot, "sibling-secret")}:/run/secrets:ro`);
  args.push(IMAGE, "/bin/httpd", "-f", "-p", `0.0.0.0:${HTTP_PORT}`, "-h", "/workspace");
  startedContainers.push(containerId);
  docker(args, { timeoutMs: 120_000, discardOutput: true });
  waitRunning(containerId);
  assertCgroupLimits(containerId);
}

function waitRunning(containerId) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = docker(["inspect", "-f", "{{.State.Running}}", containerId], { allowFailure: true });
    if (state.status === 0 && state.stdout.trim() === "true") return;
    sleepMs(50);
  }
  throw new Error("sandbox did not reach running state");
}

function assertRunning(containerId) {
  const state = docker(["inspect", "-f", "{{.State.Running}}", containerId], { allowFailure: true });
  if (state.status !== 0 || state.stdout.trim() !== "true") throw new Error("sandbox is not running");
}

function containerIp(containerId, networkName) {
  const ip = docker(["inspect", "-f", `{{(index .NetworkSettings.Networks "${networkName}").IPAddress}}`, containerId]).stdout.trim();
  if (!/^10\.253\.24[01]\.[0-9]{1,3}$/.test(ip)) throw new Error("unexpected container address");
  return ip;
}

function containerHostPid(containerId) {
  const value = Number.parseInt(docker(["inspect", "-f", "{{.State.Pid}}", containerId]).stdout.trim(), 10);
  if (!Number.isInteger(value) || value <= 1 || value > 2 ** 30) throw new Error("invalid container host pid");
  return value;
}

function cgroupScope(containerId) {
  const hostPid = containerHostPid(containerId);
  const line = readFileSync(`/proc/${hostPid}/cgroup`, "utf8").trim().split(/\r?\n/).find((l) => l.startsWith("0::"));
  if (!line) throw new Error("cgroup v2 path unavailable");
  const path = line.slice("0::".length).replace(/^\//, "");
  if (!/^[a-zA-Z0-9._/-]+\.scope$/.test(path)) throw new Error("unexpected cgroup scope");
  return path;
}

function assertCgroupLimits(containerId) {
  const scope = cgroupScope(containerId);
  const root = join("/sys/fs/cgroup", scope);
  if (readFileSync(join(root, "cpu.max"), "utf8").trim() !== `${LIMITS.cpuQuotaMicros} ${LIMITS.cpuPeriodMicros}`) throw new Error("cpu limit mismatch");
  if (readFileSync(join(root, "memory.max"), "utf8").trim() !== String(LIMITS.memoryBytes)) throw new Error("memory limit mismatch");
  if (readFileSync(join(root, "pids.max"), "utf8").trim() !== String(LIMITS.pidsMax)) throw new Error("pid limit mismatch");
  const hostPid = containerHostPid(containerId);
  const members = readFileSync(join(root, "cgroup.procs"), "utf8").trim().split(/\s+/).map(Number);
  if (!members.includes(hostPid)) throw new Error("sandbox is outside the qualified cgroup");
}

function execResult(containerId, args) {
  return docker(["exec", "--user", "65532:65532", containerId, ...args], { allowFailure: true, timeoutMs: 30_000 });
}

function assertExecSuccess(containerId, args) {
  if (execResult(containerId, args).status !== 0) throw new Error("sandbox command failed");
}

function assertExecFailure(containerId, args) {
  if (execResult(containerId, args).status === 0) throw new Error("sandbox command unexpectedly succeeded");
}

function assertExecOutput(containerId, args, expected) {
  const result = execResult(containerId, args);
  if (result.status !== 0 || result.stdout !== expected) throw new Error("sandbox output mismatch");
}

function teardownContainer(containerId, tolerateFailure = false) {
  docker(["rm", "-f", containerId], { allowFailure: tolerateFailure, discardOutput: true });
}

function assertContainerGone(containerId) {
  if (docker(["inspect", containerId], { allowFailure: true }).status === 0) throw new Error("sandbox survived teardown");
}

function waitCgroupGone(scope) {
  const path = join("/sys/fs/cgroup", scope);
  for (let attempt = 0; attempt < 300 && existsSync(path); attempt++) sleepMs(50);
  if (existsSync(path)) throw new Error("sandbox cgroup survived teardown");
}

function teardownNetworks() {
  for (const name of [NETWORK_A, NETWORK_B]) {
    docker(["network", "rm", name], { discardOutput: true });
    if (docker(["network", "inspect", name], { allowFailure: true }).status === 0) throw new Error("network survived teardown");
  }
  createdNetworks.length = 0;
}

function createProfile(runtimeVersion, controllers) {
  const policy = {
    launcher: "docker-runsc",
    dockerRunFlags: ["runtime=runsc", "user=65532:65532", "read-only", "cap-drop=ALL", "security-opt=no-new-privileges", "cpus=0.5", "memory=128m", "pids-limit=64"],
    networkTopology: {
      mode: "two-internal-docker-bridges-distinct-subnets",
      subnets: [NETWORKS.a.subnet, NETWORKS.b.subnet],
      internal: true,
      defaultRoute: false,
    },
    workloadIdentity: "uid-65532-gid-65532",
    containerCapabilities: [],
    rootReadonly: true,
    workspaceMount: "readonly",
    siblingSecretMount: "sandbox-b-only-readonly",
    cgroupPolicy: LIMITS,
  };
  return {
    schemaVersion: 2,
    provider: "runsc",
    launcher: "docker-runsc",
    privilegeModel: "docker-runsc-nonroot",
    kernelRelease: readGuestKernelRelease(),
    runtimeVersion,
    runtimeBinaryDigest: digestFile(registeredRunscPath),
    rootfsBinaryDigest: digestFile(BUSYBOX_SOURCE),
    platformMode: observedPlatform,
    containerCapabilities: [],
    workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "isolated-internal-bridge-no-default-route",
    cgroupPolicy: LIMITS,
    providerConfigDigest: digestRuntimeIsolationValue(policy),
    hostPolicyDigest: digestRuntimeIsolationValue({
      cgroupVersion: 2,
      controllers,
      launcherPrivilege: "docker-group-nonroot",
      dockerRunscRegistered: true,
      registeredRuntimePlatform: observedPlatform,
      networkPolicy: "isolated-internal-bridge-no-default-route",
      networkSubnets: [NETWORKS.a.subnet, NETWORKS.b.subnet],
      hostIpv4Forwarding: readFileSync("/proc/sys/net/ipv4/ip_forward", "utf8").trim(),
      activeLsms: readOptional("/sys/kernel/security/lsm"),
      appArmorEnabled: readOptional("/sys/module/apparmor/parameters/enabled"),
      ptraceScope: readOptional("/proc/sys/kernel/yama/ptrace_scope"),
      seccompActions: readOptional("/proc/sys/kernel/seccomp/actions_avail"),
    }),
  };
}

function readGuestKernelRelease() {
  const value = docker(["run", "--rm", "--runtime=runsc", "--network", "none", IMAGE, "/bin/busybox-full", "uname", "-r"]).stdout.trim();
  if (value !== "4.19.0-gvisor") throw new Error("gvisor sentinel kernel not observed");
  return value;
}

function loadColdStartLatency(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const evidence = parsed?.evidence ?? parsed;
  const keys = ["image", "imageDigest", "command", "methodology", "samples"];
  const out = {};
  for (const key of keys) out[key] = evidence?.[key];
  return out;
}

function createTestSuiteDigest() {
  return digestRuntimeIsolationValue({
    harness: digestFile(fileURLToPath(import.meta.url)),
    hostileProbeSource: digestFile(PROBE_SOURCE),
    evidenceImplementationSource: digestFile(join(PACKAGE_ROOT, "src", "providers", "runsc", "isolationEvidence.ts")),
    evidenceSchemaSource: digestFile(join(PACKAGE_ROOT, "src", "shared", "runtimeIsolation.ts")),
    compiledProviderEntry: digestFile(join(PACKAGE_ROOT, "dist", "providers", "runsc", "index.js")),
  });
}

function digestFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function randomHex() {
  return createHash("sha256").update(`${process.pid}:${process.hrtime.bigint()}:${Math.random()}`).digest("hex");
}

function readOptional(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "unavailable";
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function docker(args, options = {}) {
  return command(DOCKER, args, options);
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: options.timeoutMs ?? 30_000,
    stdio: options.discardOutput ? "ignore" : "pipe",
  });
  const status = result.status ?? 255;
  if (result.error || result.signal || (!options.allowFailure && status !== 0)) throw new Error("host command failed");
  return { status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
