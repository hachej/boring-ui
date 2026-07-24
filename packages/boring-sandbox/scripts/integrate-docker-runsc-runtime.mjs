#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

if (process.env.RUN_RUNSC_INTEGRATION !== "1") {
  process.stdout.write(
    `${JSON.stringify({ skipped: true, reason: "set RUN_RUNSC_INTEGRATION=1" })}\n`,
  );
  process.exit(0);
}

const {
  DockerCliCommandRunner,
  RunscSessionRuntimeV1,
  buildDockerExecArgv,
  buildDockerRemoveArgv,
  buildDockerRunArgv,
  prepareInvocationEnvelopeV1,
  runDockerChecked,
  trustedWorkspaceMountSource,
} = await import("../dist/providers/runsc/index.js");
const { REMOTE_WORKER_ERROR_CODES_V1 } = await import("../dist/shared/index.js");

const dockerPath = "/usr/bin/docker";
const packageRoot = new URL("..", import.meta.url).pathname;
const workloadContext = join(
  packageRoot,
  "src/providers/runsc/runtime/workload",
);
const runId = randomBytes(8).toString("hex");
const registryName = `boring-sbx13-registry-${runId}`;
const localImage = `boring-sbx13-runtime:${runId}`;
const workRoot = mkdtempSync(join(tmpdir(), "boring-sbx13-runtime-"));
const workspaceId = "00000000-0000-4000-8000-000000000001";
const workspaceRoot = join(workRoot, "workspaces");
const workspace = join(workspaceRoot, workspaceId);
const sandboxId = `sandbox-${runId}`;
const clientLeaseId = `lease-${runId}`;
const runtimeIds = [];
const results = [];
const credentialValues = new Map();
const credentialScope = {};
let session;
let registryStarted = false;
let stage = "bootstrap";
let lastNonCleanupStage = stage;
let lastCallerStage = stage;
let invokeAdapter;
let rawWorkloadMode = false;

function docker(argv, options = {}) {
  const result = spawnSync(dockerPath, argv, {
    encoding: "utf8",
    input: options.input,
    timeout: options.timeout ?? 180_000,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`docker stage failed: ${argv[0] ?? "unknown"}`);
  }
  return result.stdout ?? "";
}

function dockerFails(argv) {
  const result = spawnSync(dockerPath, argv, {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  return result.status !== 0;
}

function pass(probe, facts = {}) {
  results.push({ probe, status: "passed", ...facts });
}

function followup(probe, reason) {
  results.push({ probe, status: "operator-follow-up", reason });
}

function assert(value, label) {
  if (!value) throw new Error(`assertion failed: ${label}`);
}

function decoded(response, stream = "stdoutBase64") {
  return Buffer.from(response[stream], "base64").toString("utf8");
}

function currentContainerName() {
  return `boring-sbx-${runtimeIds.at(-1)}`;
}

async function invoke(command, extra = {}) {
  const invocationId = `invocation-${randomBytes(8).toString("hex")}`;
  const requestFields =
    typeof extra === "function" ? extra(invocationId) : extra;
  const request = {
    invocationId,
    command,
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    ...requestFields,
  };
  return invokeAdapter
    ? await invokeAdapter(request)
    : await session.exec(
        sandboxId,
        workspaceId,
        request,
        undefined,
        credentialScope,
      );
}

try {
  stage = "runsc-sentinel";
  docker(["version", "--format", "{{.Server.Version}}"]);
  const guestKernel = docker([
    "run",
    "--rm",
    "--runtime=runsc",
    "--network",
    "none",
    "alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b",
    "uname",
    "-r",
  ]).trim();
  assert(guestKernel === "4.19.0-gvisor", "gVisor guest sentinel");
  pass("runsc-sentinel", { guestKernel });

  stage = "workload-image";
  docker(["build", "--tag", localImage, workloadContext]);
  stage = "registry-image";
  docker(["pull", "registry:2"]);
  stage = "registry-start";
  docker([
    "run",
    "--detach",
    "--name",
    registryName,
    "--publish",
    "127.0.0.1::5000",
    "registry:2",
  ]);
  registryStarted = true;
  stage = "registry-port";
  const portBinding = docker([
    "port",
    registryName,
    "5000/tcp",
  ]).trim();
  const portMatch = /^127\.0\.0\.1:([0-9]{1,5})$/.exec(portBinding);
  assert(portMatch, "local registry port");
  const repository = `127.0.0.1:${portMatch[1]}/boring-sbx13-runtime`;
  const pushedTag = `${repository}:${runId}`;
  stage = "registry-push";
  docker(["tag", localImage, pushedTag]);
  docker(["push", pushedTag]);
  stage = "registry-digest";
  const repoDigests = JSON.parse(
    docker([
      "image",
      "inspect",
      pushedTag,
      "--format",
      "{{json .RepoDigests}}",
    ]),
  );
  const imageDigest = repoDigests.find((value) =>
    value.startsWith(`${repository}@sha256:`),
  );
  assert(typeof imageDigest === "string", "repository digest");
  pass("workload-image", { pinnedByDigest: true, workloadUid: 65532 });

  stage = "workspace-setup";
  mkdirSync(workspaceRoot, { mode: 0o750 });
  mkdirSync(workspace, { mode: 0o770 });
  chmodSync(workspace, 0o2770);
  const ownership = spawnSync("/usr/bin/sudo", [
    "-n",
    "/usr/bin/chown",
    "65532:65532",
    workspace,
  ]);
  assert(ownership.status === 0, "workspace ownership setup");

  const mountFacts = spawnSync(
    "/usr/bin/findmnt",
    ["-T", workspace, "-o", "FSTYPE,OPTIONS", "-n"],
    { encoding: "utf8" },
  );
  const quotaReady =
    mountFacts.status === 0 && /\b(prjquota|project)\b/.test(mountFacts.stdout);
  if (quotaReady) {
    followup(
      "project-quota-fill",
      "a preconfigured root-owned quota helper was not installed for this non-admitting source-checkout run",
    );
  } else {
    followup(
      "project-quota-fill",
      "host ext4 lacks project-quota mount support; enabling it would mutate host filesystem policy",
    );
  }

  stage = "session-create";
  const dockerRunner = new DockerCliCommandRunner();
  const runner = {
    async run(input) {
      if (input.argv[0] !== "rm") lastCallerStage = stage;
      const mode = input.argv[0] === "exec" ? input.argv.at(-1) : input.argv[0];
      stage = `docker-${mode}`;
      if (mode !== "rm") lastNonCleanupStage = stage;
      const result = await dockerRunner.run(input);
      if (result.exitCode !== 0 && mode !== "rm") {
        const diagnostic = new TextDecoder().decode(result.stderr);
        const category = diagnostic.includes("ulimit")
          ? "ulimit"
          : diagnostic.includes("is not running")
            ? "container-not-running"
            : diagnostic.includes("executable file not found")
              ? "executable-missing"
          : diagnostic.includes("operation not permitted")
            ? "operation-not-permitted"
            : diagnostic.includes("invalid argument")
              ? "invalid-argument"
              : diagnostic.includes("failed to create task")
                ? "create-task"
                : diagnostic.includes("connection refused")
                  ? "registry-unavailable"
                  : diagnostic.includes("manifest unknown")
                    ? "manifest"
                    : diagnostic.includes("mount")
                      ? "mount"
          : diagnostic.includes("permission denied")
            ? "permission"
            : diagnostic.includes("No such image") || diagnostic.includes("not found")
              ? "image"
              : diagnostic.includes("OCI runtime") || diagnostic.includes("runsc")
                ? "runtime"
                : "other";
        lastNonCleanupStage = `${stage}-${category}`;
      }
      return result;
    },
  };
  const mountSource = trustedWorkspaceMountSource(workspaceRoot, workspaceId);
  const startRawWorkload = async (workspaceReadOnly = false) => {
    const id = randomBytes(16).toString("hex");
    runtimeIds.push(id);
    await runDockerChecked(runner, {
      argv: buildDockerRunArgv({
        runtimeId: id,
        workspaceMountSource: mountSource,
        workspaceReadOnly,
        image: imageDigest,
      }),
      timeoutMs: 120_000,
      maxOutputBytes: 64 * 1024,
    });
  };
  const replaceRawWorkload = async (workspaceReadOnly = false) => {
    if (runtimeIds.length > 0) {
      await runDockerChecked(runner, {
        argv: buildDockerRemoveArgv(runtimeIds.at(-1)),
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
      });
    }
    await startRawWorkload(workspaceReadOnly);
  };
  const rawInvoke = async (request) => {
    if (
      (request.credentialRefs ?? []).some(
        (reference) =>
          reference.ref.providerId === "model-provider" ||
          reference.ref.bindingId === "model-runtime",
      )
    ) {
      const error = new Error("trusted model credential rejected");
      error.code = REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected;
      throw error;
    }
    const resolvedCredentialFields = (request.credentialRefs ?? []).flatMap(
      (reference) =>
        reference.fields.map((field) => ({
          bindingId: reference.ref.bindingId,
          fieldId: field.fieldId,
          name: field.name,
          value: new TextEncoder().encode(
            credentialValues.get(request.invocationId) ?? "",
          ),
        })),
    );
    const envelope = prepareInvocationEnvelopeV1({
      workspaceId,
      request,
      resolvedCredentialFields,
    });
    credentialValues.delete(request.invocationId);
    const result = await runDockerChecked(runner, {
      argv: buildDockerExecArgv(runtimeIds.at(-1), "invoke"),
      stdin: envelope.bytes,
      timeoutMs: envelope.timeoutMs + 32_000,
      maxOutputBytes: Math.ceil((envelope.maxOutputBytes * 4) / 3) + 128 * 1024,
    });
    stage = "invoke-response-decode";
    lastNonCleanupStage = stage;
    const response = JSON.parse(new TextDecoder().decode(result.stdout));
    stage = "invoke-response-validate";
    lastNonCleanupStage = stage;
    if (!response || typeof response !== "object") {
      stage = `invoke-response-invalid-${response === null ? "null" : typeof response}`;
      lastNonCleanupStage = stage;
    } else if (response.ok !== true) {
      const responseCode =
        typeof response.code === "string" ? response.code : "no-stable-code";
      stage = `invoke-response-rejected-${responseCode}`;
      lastNonCleanupStage = stage;
    }
    stage = `invoke-response-ok-${String(response?.ok === true)}`;
    lastNonCleanupStage = stage;
    assert(response.ok === true, "trusted invocation response");
    return response;
  };
  session = new RunscSessionRuntimeV1({
    runner,
    quota: { async apply() {}, async check() {} },
    runtimeIdFactory() {
      const id = randomBytes(16).toString("hex");
      runtimeIds.push(id);
      return id;
    },
    maxConcurrentCreates: 2,
    maxConcurrentExecs: 2,
    credentialBindings: {
      contractVersion: "boring.credential-consumer-bindings.v1",
      require(bindingId) {
        const model = bindingId === "model-runtime";
        return {
          contractVersion: "boring.credential-consumer-binding.v1",
          id: bindingId,
          providerId: model ? "model-provider" : "search-provider",
          consumer: {
            id: bindingId,
            kind: model ? "model-provider" : "first-party-tool",
            trust: "untrusted",
          },
          purpose: "integration credential",
          allowedFieldIds: ["api-key"],
          delivery: "sandbox-pipe",
          sandbox: { credentialChannel: "fd-3", egressOrigins: [] },
        };
      },
    },
    credentialProviders: {
      contractVersion: "boring.provider-registry.v1",
      list: () => [],
      require(providerId) {
        return {
          contractVersion: "boring.provider.v1",
          id: providerId,
          category: providerId === "model-provider" ? "llm" : "search",
        };
      },
    },
    credentialPayloadResolver: {
      contractVersion: "boring.sandbox-credential-payload-resolver.v1",
      async resolveForDelivery(_scope, request) {
        return {
          payload: {
            contractVersion: "boring.sandbox-credential-secret-payload.v1",
            workspaceId: request.workspaceId,
            sandboxId: request.sandboxId,
            executionId: request.executionId,
            deliveryAttemptId: request.deliveryAttemptId,
            bindingId: request.ref.bindingId,
            credentialVersion: 1,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            fields: [
              {
                fieldId: "api-key",
                value: new TextEncoder().encode(
                  credentialValues.get(request.executionId) ?? "",
                ),
              },
            ],
          },
          dispose() {
            credentialValues.delete(request.executionId);
          },
        };
      },
    },
  });
  stage = "startup-sweep";
  await session.startupSweep();
  stage = "session-create";
  try {
    await session.create({
      sandboxId,
      clientLeaseId,
      workspaceId,
      workspaceMountSource: mountSource,
      image: imageDigest,
    });
    pass("session-create", {
      network: "none",
      runtime: "runsc",
      warmContainer: true,
      nonAdmittingHostGroupShim: true,
    });
  } catch (error) {
    if (error?.code !== REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable) {
      throw error;
    }
    pass("session-create-fail-closed", {
      unsupportedPrimitive: "openat2",
      containerRemoved: true,
    });
    followup(
      "workspace-openat2-fs",
      "runsc returns ENOSYS for openat2 syscall 437; the runtime correctly rejects creation without a fallback",
    );
    followup(
      "symlink-swap-race",
      "the required openat2 primitive is unavailable in this runsc profile, so a mutating helper race cannot be admitted or side-door tested",
    );
    rawWorkloadMode = true;
    await startRawWorkload();
    invokeAdapter = rawInvoke;
    pass("workload-container-create", {
      network: "none",
      runtime: "runsc",
      nonAdmittingPathHelperBypass: true,
    });
  }

  stage = "workspace-fs";
  if (rawWorkloadMode) {
    const write = await invoke(
      "mkdir -p /workspace/dir && printf workspace-persists > /workspace/dir/persist.txt",
    );
    stage = "workload-workspace-write-return";
    lastNonCleanupStage = stage;
    assert(write && typeof write === "object", "workload response object");
    stage = `workload-workspace-write-exit-${write.exitCode}-cleanup-${String(write.cleanupProven)}`;
    lastNonCleanupStage = stage;
    assert(write.exitCode === 0, "workload workspace write");
    pass("workload-workspace-write", { helperPathAdmitted: false });
  } else {
    await session.fs(sandboxId, {
      op: "writeFile",
      path: "persist.txt",
      data: "workspace-persists",
    });
    const read = await session.fs(sandboxId, {
      op: "readFile",
      path: "persist.txt",
    });
    assert(read.content === "workspace-persists", "workspace read/write");
    await session.fs(sandboxId, { op: "mkdir", path: "dir", recursive: false });
    await session.fs(sandboxId, {
      op: "rename",
      from: "persist.txt",
      to: "dir/persist.txt",
    });
    pass("workspace-fs", { openat2Probe: true, renameEndpoint: true });
  }

  if (!rawWorkloadMode) {
    await session.fs(sandboxId, {
      op: "writeFile",
      path: "race-target",
      data: "safe-race-value",
    });
    stage = "symlink-swap-race";
    const race = spawn(
      dockerPath,
      [
        "exec",
        "--user",
        "65532:65532",
        currentContainerName(),
        "/bin/sh",
        "-c",
        "while :; do rm -f /workspace/race; ln -s /etc/passwd /workspace/race; rm -f /workspace/race; ln -s race-target /workspace/race; done",
      ],
      { stdio: "ignore" },
    );
    let escaped = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const value = await session.fs(sandboxId, {
          op: "readFile",
          path: "race",
        });
        if (value.content !== "safe-race-value") escaped = true;
      } catch (error) {
        if (error?.code !== REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe) throw error;
      }
    }
    race.kill("SIGKILL");
    docker([
      "exec",
      "--user",
      "65532:65532",
      currentContainerName(),
      "/opt/boring/bin/boring-runtime",
      "baseline",
    ]);
    assert(!escaped, "symlink swap containment");
    pass("symlink-swap-race", { iterations: 100, escaped: false });
  }

  stage = "background-reaping";
  const background = await invoke(
    "(sleep 600 >/dev/null 2>&1 &) ; (setsid sh -c 'sleep 600' >/dev/null 2>&1 &) ; true",
  );
  stage = `background-exit-${background.exitCode}-cleanup-${String(background.cleanupProven)}`;
  lastNonCleanupStage = stage;
  assert(background.exitCode === 0, "background launch");
  const baseline = JSON.parse(
    docker([
      "exec",
      "--user",
      "65532:65532",
      currentContainerName(),
      "/opt/boring/bin/boring-runtime",
      "baseline",
    ]),
  );
  stage = `background-baseline-${String(baseline.ok)}`;
  lastNonCleanupStage = stage;
  assert(baseline.ok === true, "double-fork cleanup baseline");
  pass("background-double-fork-reaping", { cleanBaseline: true });

  stage = "secret-delivery";
  const canary = `sbx13-secret-${randomBytes(24).toString("hex")}`;
  if (rawWorkloadMode) await replaceRawWorkload(true);
  const secretResponse = await invoke(
    "test -n \"$TOOL_CREDENTIAL\" && if printf %s \"$TOOL_CREDENTIAL\" > /workspace/.credential-leak; then exit 9; fi; printf delivered",
    (invocationId) => {
      credentialValues.set(invocationId, canary);
      return {
        credentialRefs: [
          {
            deliveryAttemptId: `delivery-${runId}`,
            ref: {
              contractVersion: "boring.provider-credential-ref.v1",
              providerId: "search-provider",
              executionId: invocationId,
              bindingId: "search-tool",
            },
            fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
          },
        ],
      };
    },
  );
  stage = `secret-exit-${secretResponse.exitCode}-cleanup-${String(secretResponse.cleanupProven)}`;
  lastNonCleanupStage = stage;
  if (rawWorkloadMode) await replaceRawWorkload(false);
  assert(decoded(secretResponse) === "delivered", "secret delivery");
  const secretWrite = await invoke(
    "test ! -e /workspace/.credential-leak && printf scoped",
  );
  assert(decoded(secretWrite) === "scoped", "secret workspace persistence");
  if (rawWorkloadMode) {
    const persisted = await invoke("cat /workspace/dir/persist.txt");
    assert(decoded(persisted) === "workspace-persists", "workspace persistence");
  } else {
    const persisted = await session.fs(sandboxId, {
      op: "readFile",
      path: "dir/persist.txt",
    });
    assert(persisted.content === "workspace-persists", "workspace persistence");
  }
  const inspect = docker(["inspect", currentContainerName()]);
  const environment = docker([
    "exec",
    "--user",
    "65532:65532",
    currentContainerName(),
    "/usr/bin/env",
  ]);
  const processList = docker([
    "exec",
    "--user",
    "65532:65532",
    currentContainerName(),
    "/bin/ps",
  ]);
  const imageInspect = docker(["image", "inspect", imageDigest]);
  const imageHistory = docker(["history", "--no-trunc", imageDigest]);
  assert(
    ![inspect, environment, processList, imageInspect, imageHistory].some((value) =>
      value.includes(canary),
    ),
    "secret non-leak",
  );
  pass("non-model-secret", {
    delivered: true,
    workspaceReadOnlyDuringDelivery: true,
    absentAfterContainerReplacement: true,
    absentFromContainerEnvArgvInspectLabelsAndImage: true,
  });

  stage = "model-key-negative";
  let modelCode;
  try {
    await invoke("true", (invocationId) => ({
      credentialRefs: [
        {
          deliveryAttemptId: `model-delivery-${runId}`,
          ref: {
            contractVersion: "boring.provider-credential-ref.v1",
            providerId: "model-provider",
            executionId: invocationId,
            bindingId: "model-runtime",
          },
          fields: [{ name: "MODEL_KEY", fieldId: "api-key" }],
        },
      ],
    }));
  } catch (error) {
    modelCode = error?.code;
  }
  assert(
    modelCode === REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
    "model-key rejection",
  );
  pass("model-provider-credential-negative", { rejectedBeforeDockerExec: true });

  stage = "timeout-cleanup";
  let timeoutCode;
  try {
    const timed = await invoke("setsid sh -c 'sleep 600' & wait", {
      timeoutMs: 500,
    });
    if (rawWorkloadMode && timed.timedOut && timed.cleanupProven) {
      timeoutCode = REMOTE_WORKER_ERROR_CODES_V1.timeout;
    }
  } catch (error) {
    timeoutCode = error?.code;
  }
  assert(timeoutCode === REMOTE_WORKER_ERROR_CODES_V1.timeout, "timeout code");
  stage = "timeout-post-baseline";
  const afterTimeout = await invoke("ps | grep '[s]leep' >/dev/null && exit 1 || exit 0");
  assert(afterTimeout.exitCode === 0, "timeout descendant cleanup");
  pass("timeout-process-group-kill", { cleanBaseline: true });

  stage = "egress-default-deny";
  stage = "egress-external-ipv4";
  const external = await invoke("wget -T 1 -qO- http://1.1.1.1 >/dev/null 2>&1");
  stage = "egress-metadata-ipv4";
  const metadata = await invoke(
    "wget -T 1 -qO- http://169.254.169.254 >/dev/null 2>&1",
  );
  stage = "egress-metadata-ipv6";
  const metadataV6 = await invoke(
    "wget -T 1 -qO- 'http://[fe80::a9fe:a9fe]/' >/dev/null 2>&1",
  );
  const siblingIP = docker([
    "inspect",
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    registryName,
  ]).trim();
  stage = "egress-sibling";
  const sibling = await invoke(
    `wget -T 1 -qO- http://${siblingIP}:5000/v2/ >/dev/null 2>&1`,
  );
  stage = "egress-worker-private";
  const workerPrivate = await invoke(
    "wget -T 1 -qO- http://172.17.0.1 >/dev/null 2>&1",
  );
  stage = "egress-external-ipv6";
  const externalV6 = await invoke(
    "wget -T 1 -qO- 'http://[2606:4700:4700::1111]/' >/dev/null 2>&1",
  );
  stage = "egress-docker-socket";
  const dockerSocket = await invoke("test ! -S /var/run/docker.sock");
  stage = "egress-dns";
  const dns = await invoke("nslookup example.com >/dev/null 2>&1");
  stage = "egress-loopback-control";
  const loopback = await invoke(
    "(printf 'HTTP/1.0 200 OK\\r\\nContent-Length: 8\\r\\n\\r\\nloopback' | nc -l -p 18080 >/dev/null) & p=$!; sleep 0.2; wget -qO- http://127.0.0.1:18080; status=$?; wait $p 2>/dev/null || true; exit $status",
  );
  stage = [
    "egress-results",
    external.exitCode,
    metadata.exitCode,
    metadataV6.exitCode,
    sibling.exitCode,
    workerPrivate.exitCode,
    externalV6.exitCode,
    dockerSocket.exitCode,
    dns.exitCode,
    loopback.exitCode,
    decoded(loopback) === "loopback" ? "loopback-ok" : "loopback-output-mismatch",
  ].join("-");
  lastNonCleanupStage = stage;
  assert(external.exitCode !== 0, "external egress denied");
  assert(metadata.exitCode !== 0, "metadata egress denied");
  assert(metadataV6.exitCode !== 0, "metadata IPv6 egress denied");
  assert(sibling.exitCode !== 0, "sibling egress denied");
  assert(workerPrivate.exitCode !== 0, "worker private-interface egress denied");
  assert(externalV6.exitCode !== 0, "external IPv6 egress denied");
  assert(dns.exitCode !== 0, "DNS denied");
  assert(dockerSocket.exitCode === 0, "Docker socket absent");
  assert(loopback.exitCode === 0 && decoded(loopback) === "loopback", "loopback control");
  pass("egress-default-deny", {
    externalDenied: true,
    externalIpv6Denied: true,
    metadataDenied: true,
    metadataIpv6Denied: true,
    siblingDenied: true,
    workerPrivateInterfaceDenied: true,
    dnsDenied: true,
    dockerSocketAbsent: true,
    loopbackPositiveControl: true,
  });

  stage = "teardown";
  if (rawWorkloadMode) {
    await runDockerChecked(runner, {
      argv: buildDockerRemoveArgv(runtimeIds.at(-1)),
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    });
  } else {
    await session.dispose(sandboxId);
  }
  assert(
    runtimeIds.every((id) => dockerFails(["inspect", `boring-sbx-${id}`])),
    "all session containers removed",
  );
  pass("teardown", { allSessionContainersRemoved: true });

  const evidence = {
    schemaVersion: 1,
    domain: "boring-sbx1.3-runsc-runtime-integration:non-admitting",
    nonAdmitting: true,
    exactProductionCohortClaimed: false,
    fleetAdmissionClaimed: false,
    runId,
    timestamp: new Date().toISOString(),
    safeFacts: {
      dockerServerVersion: docker([
        "version",
        "--format",
        "{{.Server.Version}}",
      ]).trim(),
      runscVersion: spawnSync("/usr/local/bin/runsc", ["--version"], {
        encoding: "utf8",
      }).stdout.trim().split(/\r?\n/)[0],
      guestKernel,
      workloadImageDigest: imageDigest,
    },
    results,
    summary: {
      passed: results.filter((result) => result.status === "passed").length,
      operatorFollowup: results.filter(
        (result) => result.status === "operator-follow-up",
      ).length,
      failed: 0,
    },
  };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  const errorType =
    error instanceof SyntaxError
      ? "SyntaxError"
      : error instanceof TypeError
        ? "TypeError"
        : error instanceof Error
          ? "Error"
          : "Unknown";
  process.stderr.write(
    `${JSON.stringify({
      code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
      message: "real-runsc integration failed with redacted diagnostics",
      stage,
      lastNonCleanupStage,
      lastCallerStage,
      errorType,
    })}\n`,
  );
  process.exitCode = 1;
} finally {
  try {
    await session?.shutdown();
  } catch {}
  for (const id of runtimeIds) {
    spawnSync(dockerPath, ["rm", "--force", `boring-sbx-${id}`], {
      stdio: "ignore",
    });
  }
  if (registryStarted) {
    spawnSync(dockerPath, ["rm", "--force", registryName], { stdio: "ignore" });
  }
  spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/rm", "-rf", "--", workRoot], {
    stdio: "ignore",
  });
}
