#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const {
  createRemoteWorkerSandboxProviderV1,
  RemoteWorkerSandboxBindingRegistryV1,
  remoteWorkerRequestDigestV1,
} = await import("../dist/providers/remote-worker/index.js");
const {
  DockerCliCommandRunner,
  RemoteWorkerRunscHandlerV1,
  RunscSandboxRootLifecycleV1,
  buildDockerRemoveArgv,
  buildDockerRunArgv,
  dockerContainerNameV1,
  runDockerChecked,
} = await import("../dist/providers/runsc/index.js");
const {
  REMOTE_WORKER_HEADERS_V1,
  REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
} = await import("../dist/shared/index.js");

const docker = "/usr/bin/docker";
const packageRoot = new URL("..", import.meta.url).pathname;
const workloadContext = join(packageRoot, "src/providers/runsc/runtime/workload");
const runId = randomBytes(8).toString("hex");
const registryName = `boring-multi-lease-registry-${runId}`;
const localImage = `boring-multi-lease:${runId}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";
const tempRoot = await mkdtemp(join(tmpdir(), "boring-multi-lease-"));
const sandboxRoot = join(tempRoot, "sandboxes");
const tokens = new Map();
const handlerFailures = [];
let registryStarted = false;
let handler;
let sequence = 0;
let stage = "bootstrap";

function runDocker(argv) {
  const result = spawnSync(docker, argv, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`docker proof stage failed: ${argv[0] ?? "unknown"}`);
  }
  return result.stdout ?? "";
}

function assert(value, label) {
  if (!value) throw new Error(`proof assertion failed: ${label}`);
}

async function prepareOwnership(path) {
  // The proof root lives beneath a private mkdtemp parent. Production daemons
  // omit this callback and use root-owned 65532:65532 leaves.
  await chmod(path, 0o777);
}

function issueCapability(input) {
  const token = `capability-${++sequence}`;
  tokens.set(token, input.claims);
  return token;
}

try {
  stage = "runsc-sentinel";
  const guestKernel = runDocker([
    "run",
    "--rm",
    "--runtime=runsc",
    "--network",
    "none",
    "alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
    "uname",
    "-r",
  ]).trim();
  assert(guestKernel === "4.19.0-gvisor", "runsc sentinel");

  stage = "workload-image";
  runDocker(["build", "--tag", localImage, workloadContext]);
  runDocker(["pull", "registry:2"]);
  runDocker([
    "run",
    "--detach",
    "--name",
    registryName,
    "--publish",
    "127.0.0.1::5000",
    "registry:2",
  ]);
  registryStarted = true;
  const port = /^127\.0\.0\.1:([0-9]{1,5})$/u.exec(
    runDocker(["port", registryName, "5000/tcp"]).trim(),
  )?.[1];
  assert(port, "local registry port");
  const repository = `127.0.0.1:${port}/boring-multi-lease`;
  const tag = `${repository}:${runId}`;
  runDocker(["tag", localImage, tag]);
  runDocker(["push", tag]);
  const repoDigests = JSON.parse(
    runDocker(["image", "inspect", tag, "--format", "{{json .RepoDigests}}"]),
  );
  const workloadImage = repoDigests.find((value) =>
    value.startsWith(`${repository}@sha256:`),
  );
  assert(workloadImage, "digest-pinned workload image");
  const imageDigest = workloadImage.slice(workloadImage.indexOf("@") + 1);
  const qualificationDigest = `sha256:${"a".repeat(64)}`;

  await mkdir(sandboxRoot, { mode: 0o750 });
  const roots = new RunscSandboxRootLifecycleV1({
    sandboxRoot,
    prepareOwnership,
  });
  const bindingRegistry = new RemoteWorkerSandboxBindingRegistryV1({
    workerId: "worker-1",
    capabilityAuthenticator: {
      authenticate: ({ token }) => tokens.get(token),
    },
    receiptAuthenticator: {
      authenticate: (payload) =>
        `authenticated:${remoteWorkerRequestDigestV1(payload)}`,
    },
  });
  const dockerRunner = new DockerCliCommandRunner();
  let sandboxSequence = 0;
  handler = new RemoteWorkerRunscHandlerV1({
    registry: bindingRegistry,
    workloadImage,
    multiSandboxRootsQualified: false,
    qualification: {
      evidenceDigest: qualificationDigest,
      qualificationBundleDigest: qualificationDigest,
      providerCohortDigest: qualificationDigest,
      imageDigest,
      qualificationRunId: "local-non-admitting-proof",
      qualifiedAtMs: Date.now(),
    },
    runtime: {
      runner: dockerRunner,
      quota: { apply: async () => undefined, check: async () => undefined },
      sandboxIdFactory: () => `sandbox-${++sandboxSequence}`,
      sandboxRoots: roots,
    },
  });
  await handler.startupSweep();

  let lastHealth;
  const transport = {
    async request(input) {
      const capabilityToken = input.headers[REMOTE_WORKER_HEADERS_V1.capability];
      if (input.path === "/internal/v1/health") {
        lastHealth = await handler.health({
          capabilityToken,
          requestedCapabilities:
            input.headers[REMOTE_WORKER_HEADERS_V1.requestedCapabilities],
        });
        return lastHealth;
      }
      if (input.path === "/internal/v1/sandboxes" && input.method === "POST") {
        try {
          return await handler.create({ capabilityToken, request: input.body });
        } catch (error) {
          handlerFailures.push(error?.code);
          throw error;
        }
      }
      const match = /^\/internal\/v1\/sandboxes\/([^/]+)(.*)$/u.exec(input.path);
      if (!match) throw new Error("unknown in-process worker route");
      const sandboxId = decodeURIComponent(match[1]);
      if (match[2] === "/fs" && input.method === "POST") {
        return await handler.fs({ capabilityToken, sandboxId, request: input.body });
      }
      if (match[2] === "/exec" && input.method === "POST") {
        return await handler.exec({
          capabilityToken,
          sandboxId,
          request: input.body,
          signal: input.signal,
        });
      }
      if (match[2] === "/renew" && input.method === "POST") {
        return await handler.renew({ capabilityToken, sandboxId, request: input.body });
      }
      if (match[2] === "" && input.method === "DELETE") {
        return await handler.delete({ capabilityToken, sandboxId });
      }
      throw new Error("unknown in-process worker operation");
    },
    async openEventStream() {
      throw new Error("event stream is not used by this proof");
    },
  };
  const allBuckets = Array.from({ length: 256 }, (_, index) => index);
  const providerOptions = (requiredCapabilities) => ({
    fleet: {
      protocolVersion: "boring.remote-worker.v1",
      bucketCount: 256,
      workers: [
        {
          workerId: "worker-1",
          baseUrl: "http://127.0.0.1:1",
          tokenFile: "/not-read/token",
          caFile: "/not-read/ca",
          tlsServerName: "localhost",
          expectedEvidenceDigest: qualificationDigest,
          expectedQualificationBundleDigest: qualificationDigest,
          expectedProviderCohortDigest: qualificationDigest,
          expectedImageDigest: imageDigest,
          ...(requiredCapabilities ? { requiredCapabilities } : {}),
          buckets: allBuckets,
        },
      ],
    },
    capabilityIssuer: { issueCapability },
    bindingReceiptVerifier: {
      verifyBindingReceipt: ({ receipt }) =>
        receipt.authenticator ===
        `authenticated:${remoteWorkerRequestDigestV1(receipt.payload)}`,
    },
    transport,
    allowInsecureLoopback: true,
    idFactory: () => `id-${++sequence}`,
  });

  stage = "capability-gate";
  const gatedProvider = createRemoteWorkerSandboxProviderV1(
    providerOptions([REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1]),
  );
  await gatedProvider
    .create({
      workspaceRoot: "/not-projected-to-worker",
      workspaceId,
      sessionId: "session-gated",
      requestId: "request-gated",
    })
    .then(
      () => {
        throw new Error("unqualified multi-root worker was admitted");
      },
      (error) => {
        assert(error?.code === "REMOTE_WORKER_UNQUALIFIED", "capability gate");
      },
    );
  await gatedProvider.close();
  assert(
    !lastHealth?.negotiatedCapabilities?.includes(
      REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
    ),
    "multi-root capability remains unadvertised",
  );

  stage = "production-fail-closed";
  const legacyProvider = createRemoteWorkerSandboxProviderV1(providerOptions());
  await legacyProvider
    .create({
      workspaceRoot: "/not-projected-to-worker",
      workspaceId,
      sessionId: "session-runtime-proof",
      requestId: "request-runtime-proof",
    })
    .then(
      () => {
        throw new Error("runsc helper without containment was admitted");
      },
      () => undefined,
    );
  await legacyProvider.close();
  assert(
    handlerFailures.length === 2 &&
      handlerFailures.every(
        (code) => code === "REMOTE_WORKER_PATH_PRIMITIVE_UNAVAILABLE",
      ),
    "production runtime fails closed on openat2",
  );
  const workspaceEntries = await readdir(join(sandboxRoot, workspaceId)).catch(
    () => [],
  );
  assert(workspaceEntries.length === 0, "failed admission root cleanup");
  assert(
    runDocker([
      "ps",
      "--all",
      "--quiet",
      "--filter",
      "label=com.hachej.boring.runsc-runtime=true",
    ]).trim() === "",
    "failed admission container cleanup",
  );

  stage = "raw-two-root-proof";
  const sourceA = await roots.prepare(workspaceId, "raw-a");
  const sourceB = await roots.prepare(workspaceId, "raw-b");
  const runtimeA = randomBytes(16).toString("hex");
  const runtimeB = randomBytes(16).toString("hex");
  for (const [runtimeId, source] of [
    [runtimeA, sourceA],
    [runtimeB, sourceB],
  ]) {
    await runDockerChecked(dockerRunner, {
      argv: buildDockerRunArgv({
        runtimeId,
        workspaceMountSource: source,
        image: workloadImage,
      }),
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1024,
    });
  }
  runDocker([
    "exec",
    "--user",
    "65532:65532",
    dockerContainerNameV1(runtimeA),
    "sh",
    "-c",
    "printf sandbox-a > /workspace/state",
  ]);
  runDocker([
    "exec",
    "--user",
    "65532:65532",
    dockerContainerNameV1(runtimeB),
    "sh",
    "-c",
    "printf sandbox-b > /workspace/state",
  ]);
  assert(
    runDocker(["exec", dockerContainerNameV1(runtimeA), "cat", "/workspace/state"]) ===
      "sandbox-a",
    "raw root A isolation",
  );
  assert(
    runDocker(["exec", dockerContainerNameV1(runtimeB), "cat", "/workspace/state"]) ===
      "sandbox-b",
    "raw root B isolation",
  );
  await runDockerChecked(dockerRunner, {
    argv: buildDockerRemoveArgv(runtimeA),
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });
  await roots.dispose(sourceA);
  assert(
    runDocker(["exec", dockerContainerNameV1(runtimeB), "cat", "/workspace/state"]) ===
      "sandbox-b",
    "raw delete A preserves B",
  );
  await runDockerChecked(dockerRunner, {
    argv: buildDockerRemoveArgv(runtimeB),
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });
  await roots.dispose(sourceB);

  await handler.shutdown();
  handler = undefined;
  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      qualified: false,
      productionAdmission: "fail-closed-path-primitive-unavailable",
      multiRootCapabilityAdvertised: false,
      rawDockerRunscRoots: 2,
      rawIsolation: true,
      rawIndependentDelete: true,
      blocker: "compatible-gvisor-openat2-or-reviewed-containment",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      passed: false,
      qualified: false,
      stage,
      code: error && typeof error === "object" ? error.code : undefined,
    })}\n`,
  );
  throw error;
} finally {
  if (handler) await handler.shutdown().catch(() => undefined);
  if (registryStarted) {
    spawnSync(docker, ["rm", "--force", registryName], { stdio: "ignore" });
  }
  spawnSync(docker, ["image", "rm", "--force", localImage], { stdio: "ignore" });
  await rm(tempRoot, { recursive: true, force: true });
}
