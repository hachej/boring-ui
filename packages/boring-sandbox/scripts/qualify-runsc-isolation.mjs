#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_ISOLATION_ERROR_CODES,
  RUNTIME_ISOLATION_PROBE_IDS,
  createRuntimeIsolationEvidence,
  digestRuntimeIsolationValue,
  verifyRuntimeIsolationEvidence,
} from "../dist/providers/runsc/index.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const RUNSC_SOURCE = process.env.BORING_RUNSC_BINARY;
const BUSYBOX_SOURCE = "/usr/bin/busybox";
const WORK_ROOT = `/var/tmp/boring-agent-host-006a-${process.pid}`;
const RUNSC_ROOT = join(WORK_ROOT, "runsc-root");
const RUNSC = join(WORK_ROOT, "runsc");
const ROOTFS = join(WORK_ROOT, "rootfs");
const PROBE_SOURCE = join(SCRIPT_DIR, "runtime-isolation-probe.c");
const PROBE_BINARY = join(ROOTFS, "bin", "isolation-probe");
const NETWORK_SUFFIX = process.pid.toString(36);
const NETWORKS = Object.freeze({
  a: { namespace: `agent-hosta-${NETWORK_SUFFIX}`, hostInterface: `h1${NETWORK_SUFFIX}`, guestInterface: `g1${NETWORK_SUFFIX}`, hostAddress: "10.252.0.1", guestAddress: "10.252.0.2", cidr: "10.252.0.0/30" },
  b: { namespace: `agent-hostb-${NETWORK_SUFFIX}`, hostInterface: `h2${NETWORK_SUFFIX}`, guestInterface: `g2${NETWORK_SUFFIX}`, hostAddress: "10.252.0.5", guestAddress: "10.252.0.6", cidr: "10.252.0.4/30" },
});
const CONTAINER_A = `agent-host-006a-a-${process.pid}`;
const CONTAINER_B = `agent-host-006a-b-${process.pid}`;
const CGROUP_A = `/boring-agent-host-006a-${process.pid}-a`;
const CGROUP_B = `/boring-agent-host-006a-${process.pid}-b`;
const LIMITS = Object.freeze({
  version: 2,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  memoryBytes: 134_217_728,
  pidsMax: 64,
});

let stage = "initialization";
let failureStage = null;
let privilegeObservation = null;
const started = [];
const createdNetworkNamespaces = [];

try {
  stage = "host prerequisites";
  requireRoot();
  stage = "ephemeral OCI bundle preparation";
  prepareFilesystem();
  stage = "runtime version observation";
  const runtimeVersion = readRuntimeVersion();
  stage = "runtime profile observation";
  const profile = createProfile(runtimeVersion);
  stage = "test suite digest";
  const testSuiteDigest = createTestSuiteDigest();

  stage = "sandbox a startup";
  startSandbox("a", CONTAINER_A, CGROUP_A);
  stage = "sandbox b startup";
  startSandbox("b", CONTAINER_B, CGROUP_B);

  stage = "positive controls before hostile probes";
  const siblingHostPid = readContainerHostPid(CONTAINER_B);
  assertRunning(CONTAINER_A);
  assertRunning(CONTAINER_B);
  assertExecOutput(CONTAINER_A, ["/bin/cat", "/workspace/marker"], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/cat", "/workspace/marker"], "agent-b\n");
  const siblingCanary = readFileSync(join(WORK_ROOT, "sibling-secret", "sibling-canary"), "utf8");
  assertExecOutput(CONTAINER_B, ["/bin/cat", "/run/secrets/sibling-canary"], siblingCanary);
  assertExecOutput(CONTAINER_A, ["/bin/wget", "-qO-", `http://${NETWORKS.a.guestAddress}:18080/marker`], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/wget", "-qO-", `http://${NETWORKS.b.guestAddress}:18080/marker`], "agent-b\n");

  stage = "sibling filesystem traversal probe";
  assertExecSuccess(CONTAINER_A, ["/bin/test", "!", "-e", "/sibling-workspace/marker"]);
  assertExecSuccess(CONTAINER_A, ["/bin/test", "!", "-e", "/workspace/../sibling-workspace/marker"]);
  stage = "secret access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/test", "!", "-e", "/run/secrets/sibling-canary"]);
  stage = "cross-workspace network probe";
  assertExecFailure(CONTAINER_A, ["/bin/wget", "-qO-", `http://${NETWORKS.b.guestAddress}:18080/marker`]);
  for (const command of ["proc", "signal", "ptrace"]) {
    stage = `${command} probe`;
    assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", command, String(siblingHostPid)]);
  }
  stage = "mount access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "mount"]);
  stage = "device access probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "device"]);
  stage = "process escape probe";
  assertExecSuccess(CONTAINER_A, ["/bin/isolation-probe", "escape", join(WORK_ROOT, "host-escape-canary")]);
  stage = "resource ceiling probe";
  assertCgroupLimits(CGROUP_A, CONTAINER_A);
  assertCgroupLimits(CGROUP_B, CONTAINER_B);

  stage = "positive controls after hostile probes";
  assertRunning(CONTAINER_A);
  assertRunning(CONTAINER_B);
  assertExecOutput(CONTAINER_A, ["/bin/wget", "-qO-", `http://${NETWORKS.a.guestAddress}:18080/marker`], "agent-a\n");
  assertExecOutput(CONTAINER_B, ["/bin/wget", "-qO-", `http://${NETWORKS.b.guestAddress}:18080/marker`], "agent-b\n");
  assertExecOutput(CONTAINER_B, ["/bin/cat", "/run/secrets/sibling-canary"], siblingCanary);

  stage = "sandbox teardown";
  teardownContainer(CONTAINER_A);
  teardownContainer(CONTAINER_B);
  stage = "sandbox and cgroup teardown verification";
  assertTeardown(CONTAINER_A, CGROUP_A);
  assertTeardown(CONTAINER_B, CGROUP_B);
  started.length = 0;
  stage = "network namespace teardown verification";
  teardownNetworks();
  stage = "ephemeral runtime root teardown verification";
  rmSync(WORK_ROOT, { recursive: true });
  if (existsSync(WORK_ROOT)) throw new Error("ephemeral runtime root survived teardown");

  const probes = Object.fromEntries(RUNTIME_ISOLATION_PROBE_IDS.map((id) => [id, "passed"]));
  const evidence = createRuntimeIsolationEvidence({
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
  });
  const verification = verifyRuntimeIsolationEvidence(evidence, profile, testSuiteDigest);
  if (verification.status !== "accepted" || verification.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error("fresh evidence verification failed");
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch {
  failureStage = stage;
  process.exitCode = 1;
} finally {
  let cleanupIncomplete = false;
  for (const id of started.reverse()) {
    try {
      teardownContainer(id, true);
    } catch {
      cleanupIncomplete = true;
    }
  }
  for (const network of Object.values(NETWORKS)) {
    try {
      command("/usr/sbin/ip", ["link", "delete", network.hostInterface], { allowFailure: true });
    } catch {
      cleanupIncomplete = true;
    }
  }
  for (const namespace of createdNetworkNamespaces.reverse()) {
    try {
      command("/usr/sbin/ip", ["netns", "delete", namespace], { allowFailure: true });
    } catch {
      cleanupIncomplete = true;
    }
  }
  for (const network of Object.values(NETWORKS)) {
    try {
      command("/usr/sbin/ip", ["link", "delete", network.hostInterface], { allowFailure: true });
    } catch {
      cleanupIncomplete = true;
    }
  }
  try {
    if (existsSync(WORK_ROOT)) rmSync(WORK_ROOT, { recursive: true, force: true });
  } catch {
    cleanupIncomplete = true;
  }
  cleanupIncomplete ||= [CGROUP_A, CGROUP_B].some((path) => existsSync(join("/sys/fs/cgroup", path)));
  cleanupIncomplete ||= Object.values(NETWORKS).some(
    (network) => existsSync(`/sys/class/net/${network.hostInterface}`) || existsSync(`/var/run/netns/${network.namespace}`),
  );
  cleanupIncomplete ||= existsSync(WORK_ROOT);
  if (failureStage !== null) {
    const suffix = cleanupIncomplete ? "; cleanup incomplete" : "";
    process.stderr.write(`${JSON.stringify({ code: RUNTIME_ISOLATION_ERROR_CODES.probeFailed, message: `runtime isolation qualification failed during ${failureStage}${suffix}` })}\n`);
  }
}

function requireRoot() {
  if (process.geteuid?.() !== 0) throw new Error("root required");
  privilegeObservation = observeSudoPrivilegeEntry();
  if (typeof RUNSC_SOURCE !== "string" || !RUNSC_SOURCE.startsWith("/") || RUNSC_SOURCE.length > 4096) {
    throw new Error("approved runtime binary required");
  }
  for (const path of [RUNSC_SOURCE, BUSYBOX_SOURCE, PROBE_SOURCE]) {
    if (!lstatSync(path).isFile()) throw new Error("required file unavailable");
  }
  if (!existsSync("/sys/fs/cgroup/cgroup.controllers")) throw new Error("cgroup v2 unavailable");
}

function observeSudoPrivilegeEntry() {
  const parent = process.ppid;
  const parentCommand = readFileSync(`/proc/${parent}/comm`, "utf8").trim();
  const uidLine = /^Uid:\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)$/m.exec(
    readFileSync(`/proc/${parent}/status`, "utf8"),
  );
  const invokingUid = process.env.SUDO_UID;
  const invokingGid = process.env.SUDO_GID;
  if (
    parentCommand !== "sudo" ||
    uidLine === null ||
    uidLine[1] === "0" ||
    uidLine[2] !== "0" ||
    invokingUid !== uidLine[1] ||
    !/^[1-9][0-9]{0,9}$/.test(invokingGid ?? "")
  ) {
    throw new Error("sudo privilege entry was not observed");
  }
  return {
    entry: "sudo-parent-real-uid-nonroot-effective-uid-root",
    invokingUid,
    invokingGid,
  };
}

function prepareFilesystem() {
  mkdirSync(WORK_ROOT, { mode: 0o700 });
  mkdirSync(RUNSC_ROOT, { mode: 0o700 });
  copyFileSync(RUNSC_SOURCE, RUNSC);
  chmodSync(RUNSC, 0o555);
  chownSync(RUNSC, 0, 0);

  for (const path of ["bin", "dev", "proc", "tmp", "workspace", "run/secrets"]) {
    mkdirSync(join(ROOTFS, path), { recursive: true, mode: 0o755 });
  }
  copyFileSync(BUSYBOX_SOURCE, join(ROOTFS, "bin", "busybox"));
  chmodSync(join(ROOTFS, "bin", "busybox"), 0o555);
  for (const applet of ["cat", "httpd", "sh", "sleep", "test", "wget"]) {
    symlinkSync("busybox", join(ROOTFS, "bin", applet));
  }
  command("/usr/bin/gcc", ["-O2", "-static", "-s", "-o", PROBE_BINARY, PROBE_SOURCE]);
  chmodSync(PROBE_BINARY, 0o555);

  mkdirSync(join(WORK_ROOT, "workspace-a"), { mode: 0o755 });
  mkdirSync(join(WORK_ROOT, "workspace-b"), { mode: 0o755 });
  mkdirSync(join(WORK_ROOT, "sibling-secret"), { mode: 0o700 });
  writeFileSync(join(WORK_ROOT, "workspace-a", "marker"), "agent-a\n", { mode: 0o444 });
  writeFileSync(join(WORK_ROOT, "workspace-b", "marker"), "agent-b\n", { mode: 0o444 });
  writeFileSync(join(WORK_ROOT, "sibling-secret", "sibling-canary"), `${randomBytes(32).toString("hex")}\n`, { mode: 0o400 });
  chownSync(join(WORK_ROOT, "sibling-secret"), 65532, 65532);
  chownSync(join(WORK_ROOT, "sibling-secret", "sibling-canary"), 65532, 65532);
  chmodSync(join(WORK_ROOT, "sibling-secret"), 0o500);
  writeFileSync(join(WORK_ROOT, "host-escape-canary"), `${randomBytes(32).toString("hex")}\n`, { mode: 0o400 });
  createNetwork("a");
  createNetwork("b");
  mkdirSync(join(WORK_ROOT, "bundle-a"), { mode: 0o700 });
  mkdirSync(join(WORK_ROOT, "bundle-b"), { mode: 0o700 });
  writeFileSync(join(WORK_ROOT, "bundle-a", "config.json"), JSON.stringify(ociConfig("a", CGROUP_A)));
  writeFileSync(join(WORK_ROOT, "bundle-b", "config.json"), JSON.stringify(ociConfig("b", CGROUP_B)));
}

function ociConfig(id, cgroupsPath) {
  const mounts = [
    { destination: "/proc", type: "proc", source: "proc", options: ["nosuid", "noexec", "nodev"] },
    { destination: "/dev", type: "tmpfs", source: "tmpfs", options: ["nosuid", "strictatime", "mode=755", "size=65536k"] },
    { destination: "/tmp", type: "tmpfs", source: "tmpfs", options: ["nosuid", "nodev", "mode=1777", "size=16777216"] },
    { destination: "/workspace", type: "bind", source: join(WORK_ROOT, `workspace-${id}`), options: ["rbind", "ro", "nosuid", "nodev"] },
  ];
  if (id === "b") mounts.push({ destination: "/run/secrets", type: "bind", source: join(WORK_ROOT, "sibling-secret"), options: ["rbind", "ro", "nosuid", "nodev", "noexec"] });
  return {
    ociVersion: "1.0.2",
    process: {
      terminal: false,
      user: { uid: 65532, gid: 65532 },
      args: ["/bin/httpd", "-f", "-p", `${NETWORKS[id].guestAddress}:18080`, "-h", "/workspace"],
      env: ["PATH=/bin"],
      cwd: "/workspace",
      capabilities: { bounding: [], effective: [], inheritable: [], permitted: [], ambient: [] },
      rlimits: [{ type: "RLIMIT_NOFILE", hard: 256, soft: 256 }],
      noNewPrivileges: true,
    },
    root: { path: ROOTFS, readonly: true },
    hostname: `agent-host-006a-${id}`,
    mounts,
    linux: {
      cgroupsPath,
      resources: {
        devices: [{ allow: false, access: "rwm" }],
        memory: { limit: LIMITS.memoryBytes },
        cpu: { quota: LIMITS.cpuQuotaMicros, period: LIMITS.cpuPeriodMicros },
        pids: { limit: LIMITS.pidsMax },
      },
      namespaces: [
        { type: "pid" },
        { type: "network", path: `/var/run/netns/${NETWORKS[id].namespace}` },
        { type: "ipc" },
        { type: "uts" },
        { type: "mount" },
      ],
      maskedPaths: ["/proc/acpi", "/proc/kcore", "/proc/keys", "/proc/latency_stats", "/proc/timer_list", "/proc/timer_stats", "/proc/sched_debug", "/sys/firmware"],
      readonlyPaths: ["/proc/asound", "/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"],
    },
  };
}

function runscArgs(args) {
  return [
    `--root=${RUNSC_ROOT}`,
    "--platform=systrap",
    "--network=sandbox",
    "--file-access=exclusive",
    ...args,
  ];
}

function createNetwork(id) {
  const network = NETWORKS[id];
  command("/usr/sbin/ip", ["netns", "add", network.namespace]);
  createdNetworkNamespaces.push(network.namespace);
  command("/usr/sbin/ip", ["link", "add", network.hostInterface, "type", "veth", "peer", "name", network.guestInterface]);
  command("/usr/sbin/ip", ["link", "set", network.guestInterface, "netns", network.namespace]);
  command("/usr/sbin/ip", ["address", "add", `${network.hostAddress}/30`, "dev", network.hostInterface]);
  command("/usr/sbin/ip", ["link", "set", network.hostInterface, "up"]);
  command("/usr/sbin/ip", ["netns", "exec", network.namespace, "/usr/sbin/ip", "address", "add", `${network.guestAddress}/30`, "dev", network.guestInterface]);
  command("/usr/sbin/ip", ["netns", "exec", network.namespace, "/usr/sbin/ip", "link", "set", "lo", "up"]);
  command("/usr/sbin/ip", ["netns", "exec", network.namespace, "/usr/sbin/ip", "link", "set", network.guestInterface, "up"]);
  const routes = command("/usr/sbin/ip", ["netns", "exec", network.namespace, "/usr/sbin/ip", "-o", "route", "show"]).stdout.trim().split(/\r?\n/).filter(Boolean);
  if (routes.length !== 1 || !routes[0].startsWith(`${network.cidr} dev ${network.guestInterface} `) || routes[0].includes(" default ")) throw new Error("network route policy mismatch");
}

function teardownNetworks() {
  for (const id of ["a", "b"]) {
    const network = NETWORKS[id];
    command("/usr/sbin/ip", ["netns", "delete", network.namespace]);
    const interfacePath = `/sys/class/net/${network.hostInterface}`;
    const namespacePath = `/var/run/netns/${network.namespace}`;
    for (let attempt = 0; attempt < 40 && (existsSync(interfacePath) || existsSync(namespacePath)); attempt++) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    if (existsSync(interfacePath) || existsSync(namespacePath)) {
      throw new Error("network namespace survived teardown");
    }
  }
  createdNetworkNamespaces.length = 0;
}

function startSandbox(id, containerId, cgroupsPath) {
  started.push(containerId);
  command(RUNSC, runscArgs(["run", `--bundle=${join(WORK_ROOT, `bundle-${id}`)}`, "--detach", containerId]), { timeoutMs: 120_000, discardOutput: true });
  assertRunning(containerId);
  assertCgroupLimits(cgroupsPath, containerId);
}

function readContainerHostPid(containerId) {
  const result = command(RUNSC, runscArgs(["state", containerId]));
  const value = JSON.parse(result.stdout)?.pid;
  if (!Number.isInteger(value) || value <= 1 || value > 2 ** 30) throw new Error("invalid runtime state");
  return value;
}

function execResult(containerId, args) {
  return command(RUNSC, runscArgs(["exec", "--user=65532:65532", containerId, ...args]), { allowFailure: true });
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

function assertRunning(containerId) {
  const result = command(RUNSC, runscArgs(["state", containerId]), { allowFailure: true });
  if (result.status !== 0) throw new Error("sandbox is not running");
  const state = JSON.parse(result.stdout);
  if (state?.status !== "running") throw new Error("sandbox is not running");
}

function assertCgroupLimits(cgroupsPath, containerId) {
  const root = join("/sys/fs/cgroup", cgroupsPath);
  if (readFileSync(join(root, "cpu.max"), "utf8").trim() !== `${LIMITS.cpuQuotaMicros} ${LIMITS.cpuPeriodMicros}`) throw new Error("cpu limit mismatch");
  if (readFileSync(join(root, "memory.max"), "utf8").trim() !== String(LIMITS.memoryBytes)) throw new Error("memory limit mismatch");
  if (readFileSync(join(root, "pids.max"), "utf8").trim() !== String(LIMITS.pidsMax)) throw new Error("pid limit mismatch");
  const sandboxPid = readContainerHostPid(containerId);
  const members = readFileSync(join(root, "cgroup.procs"), "utf8").trim().split(/\s+/).map(Number);
  if (!members.includes(sandboxPid)) throw new Error("sandbox is outside the qualified cgroup");
}

function teardownContainer(containerId, tolerateFailure = false) {
  const state = command(RUNSC, runscArgs(["state", containerId]), { allowFailure: true });
  if (state.status !== 0) return;
  command(RUNSC, runscArgs(["kill", containerId, "KILL"]), { allowFailure: tolerateFailure });
  command(RUNSC, runscArgs(["delete", "--force", containerId]), { allowFailure: tolerateFailure });
}

function assertTeardown(containerId, cgroupsPath) {
  if (command(RUNSC, runscArgs(["state", containerId]), { allowFailure: true }).status === 0) throw new Error("sandbox survived teardown");
  if (existsSync(join("/sys/fs/cgroup", cgroupsPath))) throw new Error("sandbox cgroup survived teardown");
}

function readRuntimeVersion() {
  const output = command(RUNSC, ["--version"]).stdout.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const match = /^runsc version ([a-zA-Z0-9._+-]{1,128})$/.exec(output);
  if (!match?.[1]) throw new Error("invalid runtime version");
  return match[1];
}

function createProfile(runtimeVersion) {
  if (privilegeObservation === null) throw new Error("privilege entry unavailable");
  const policy = {
    ociVersion: "1.0.2",
    runtimeFlags: ["platform=systrap", "network=sandbox", "file-access=exclusive"],
    networkTopology: {
      mode: "two-veth-namespaces-distinct-subnets",
      subnets: [NETWORKS.a.cidr, NETWORKS.b.cidr],
      bridge: false,
      defaultRoute: false,
    },
    workloadIdentity: "uid-65532-gid-65532",
    containerCapabilities: [],
    rootReadonly: true,
    workspaceMount: "readonly",
    siblingSecretMount: "sandbox-b-only-readonly",
    cgroupPolicy: LIMITS,
  };
  const controllers = readFileSync("/sys/fs/cgroup/cgroup.controllers", "utf8").trim().split(/\s+/).sort();
  for (const required of ["cpu", "memory", "pids"]) if (!controllers.includes(required)) throw new Error("required cgroup controller absent");
  const runtime = lstatSync(RUNSC);
  if (runtime.uid !== 0 || runtime.gid !== 0 || (runtime.mode & 0o777) !== 0o555) throw new Error("runtime execution copy is not root-owned readonly");
  return {
    schemaVersion: 1,
    provider: "runsc",
    kernelRelease: command("/usr/bin/uname", ["-r"]).stdout.trim(),
    runtimeVersion,
    runtimeBinaryDigest: digestFile(RUNSC),
    rootfsBinaryDigest: digestFile(join(ROOTFS, "bin", "busybox")),
    platformMode: "systrap",
    privilegeModel: "sudo-root",
    containerCapabilities: [],
    workloadIdentity: "uid-65532-gid-65532",
    networkPolicy: "isolated-veth-no-default-route",
    cgroupPolicy: LIMITS,
    providerConfigDigest: digestRuntimeIsolationValue(policy),
    hostPolicyDigest: digestRuntimeIsolationValue({
      cgroupVersion: 2,
      controllers,
      runtimeExecutionOwner: "root:root",
      runtimeExecutionMode: "0555",
      privilegeEntry: privilegeObservation.entry,
      privilegeInvokingUid: privilegeObservation.invokingUid,
      privilegeInvokingGid: privilegeObservation.invokingGid,
      networkPolicy: "isolated-veth-no-default-route",
      networkSubnets: [NETWORKS.a.cidr, NETWORKS.b.cidr],
      hostIpv4Forwarding: readFileSync("/proc/sys/net/ipv4/ip_forward", "utf8").trim(),
      activeLsms: readFileSync("/sys/kernel/security/lsm", "utf8").trim(),
      appArmorEnabled: readFileSync("/sys/module/apparmor/parameters/enabled", "utf8").trim(),
      effectiveLsmLabel: readFileSync("/proc/self/attr/current", "utf8").trim(),
      ptraceScope: readFileSync("/proc/sys/kernel/yama/ptrace_scope", "utf8").trim(),
      unprivilegedUserNamespaces: readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim(),
      seccompActions: readFileSync("/proc/sys/kernel/seccomp/actions_avail", "utf8").trim(),
    }),
  };
}

function createTestSuiteDigest() {
  return digestRuntimeIsolationValue({
    harness: digestFile(fileURLToPath(import.meta.url)),
    hostileProbeSource: digestFile(PROBE_SOURCE),
    hostileProbeBinary: digestFile(PROBE_BINARY),
    evidenceImplementationSource: digestFile(join(PACKAGE_ROOT, "src", "providers", "runsc", "isolationEvidence.ts")),
    evidenceSchemaSource: digestFile(join(PACKAGE_ROOT, "src", "shared", "runtimeIsolation.ts")),
    compiledProviderEntry: digestFile(join(PACKAGE_ROOT, "dist", "providers", "runsc", "index.js")),
  });
}

function digestFile(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024,
    timeout: options.timeoutMs ?? 30_000,
    stdio: options.discardOutput ? "ignore" : "pipe",
  });
  const status = result.status ?? 255;
  if (result.error || result.signal || (!options.allowFailure && status !== 0)) throw new Error("host command failed");
  return { status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
