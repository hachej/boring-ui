import { lstat, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { PROVIDER_CONTRACT_VERSION } from "../../../../shared/providerMatrix";
import {
  REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
  REMOTE_WORKER_PROTOCOL_VERSION,
  RemoteWorkerCapabilityClaimsSchemaV1,
  type RemoteWorkerCapabilityClaimsV1,
  type RemoteWorkerCreateRequestV1,
  type RemoteWorkerOperationV1,
} from "../../../../shared/remoteWorkerProtocolV1";
import { RemoteWorkerSandboxBindingRegistryV1 } from "../../../remote-worker/bindingRegistry";
import { remoteWorkerRequestDigestV1 } from "../../../remote-worker/requestDigest";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import { RemoteWorkerRunscHandlerV1 } from "../remoteWorkerHandler";
import { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const digest = `sha256:${"a".repeat(64)}` as const;
const workloadImage = `registry.example/runtime@${digest}`;
const nowMs = 10_000;

function success(value: unknown = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function statefulRunner(): DockerCommandRunner & {
  run: ReturnType<typeof vi.fn>;
  mounts: Map<string, string>;
} {
  const mounts = new Map<string, string>();
  const files = new Map<string, Map<string, string>>();
  return {
    mounts,
    run: vi.fn(async (input: DockerCommandInput) => {
      if (input.argv[0] === "ps") return success("");
      if (input.argv[0] === "run") {
        const name = input.argv[input.argv.indexOf("--name") + 1] as string;
        const mount = input.argv[input.argv.indexOf("--mount") + 1] as string;
        const source = /(?:^|,)src=([^,]+)/.exec(mount)?.[1];
        if (!source) throw new Error("missing fake mount source");
        mounts.set(name, source);
        files.set(source, files.get(source) ?? new Map());
        return success("container-id");
      }
      if (input.argv[0] === "rm") {
        mounts.delete(input.argv.at(-1) as string);
        return success();
      }
      if (input.argv[0] === "exec" && input.argv.at(-1) === "workspace") {
        const source = mounts.get(input.argv[4] as string);
        if (!source) throw new Error("unknown fake container");
        const request = JSON.parse(new TextDecoder().decode(input.stdin));
        if (request.op === "probe") return success({ openat2: true });
        if (request.op === "writeFile") {
          files.get(source)?.set(request.path, request.data);
          return success({ ok: true });
        }
        if (request.op === "readFile") {
          return success({ content: files.get(source)?.get(request.path) ?? "" });
        }
        return success({ ok: true });
      }
      return success({
        ok: true,
        stdoutBase64: "",
        stderrBase64: "",
        exitCode: 0,
        durationMs: 1,
        truncated: false,
        timedOut: false,
        cleanupProven: true,
      });
    }),
  };
}

function request(clientLeaseId: string): RemoteWorkerCreateRequestV1 {
  return {
    protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
    providerContractVersion: PROVIDER_CONTRACT_VERSION,
    workspaceId,
    sessionId: `session-${clientLeaseId}`,
    clientLeaseId,
    idleTimeoutMs: 60_000,
    maxOutputBytes: 1024,
    expectedEvidenceDigest: digest,
    expectedQualificationBundleDigest: digest,
    expectedProviderCohortDigest: digest,
    expectedImageDigest: digest,
  };
}

function harness(root: string, multiSandboxRootsQualified = true) {
  let tokenSequence = 0;
  const tokens = new Map<string, RemoteWorkerCapabilityClaimsV1>();
  const token = (
    operation: RemoteWorkerOperationV1,
    requestBody: unknown,
    sandboxId?: string,
  ): string => {
    const value = `token-${(tokenSequence += 1)}`;
    tokens.set(
      value,
      RemoteWorkerCapabilityClaimsSchemaV1.parse({
        protocolVersion: REMOTE_WORKER_PROTOCOL_VERSION,
        workerId: "worker-1",
        workspaceId,
        ...(sandboxId ? { sandboxId } : {}),
        operation,
        requestDigest: remoteWorkerRequestDigestV1(requestBody),
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + 5_000,
        nonce: `nonce-${tokenSequence}`,
      }),
    );
    return value;
  };
  const registry = new RemoteWorkerSandboxBindingRegistryV1({
    workerId: "worker-1",
    now: () => nowMs,
    capabilityAuthenticator: {
      authenticate: ({ token: value }) => tokens.get(value),
    },
    receiptAuthenticator: {
      authenticate: (payload) =>
        `authenticated:${remoteWorkerRequestDigestV1(payload)}`,
    },
  });
  const runner = statefulRunner();
  const apply = vi.fn(async (_workspaceId: string) => undefined);
  const check = vi.fn(async (_workspaceId: string) => undefined);
  let runtimeSequence = 0;
  let sandboxSequence = 0;
  const roots = new RunscSandboxRootLifecycleV1({
    sandboxRoot: root,
    prepareOwnership: async () => undefined,
  });
  const handler = new RemoteWorkerRunscHandlerV1({
    registry,
    workloadImage,
    multiSandboxRootsQualified,
    qualification: {
      evidenceDigest: digest,
      qualificationBundleDigest: digest,
      providerCohortDigest: digest,
      imageDigest: digest,
      qualificationRunId: "qualification-1",
      qualifiedAtMs: nowMs,
    },
    runtime: {
      runner,
      quota: { apply, check },
      now: () => nowMs,
      runtimeIdFactory: () =>
        (++runtimeSequence).toString(16).padStart(32, "0"),
      sandboxIdFactory: () => `sandbox-${++sandboxSequence}`,
      sandboxRoots: roots,
    },
  });
  return { handler, token, runner, roots, apply, check };
}

describe("authenticated remote-worker runsc handler", () => {
  test("does not advertise multi-root admission without exact-profile qualification", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-handler-unqualified-"));
    const root = join(parent, "sandboxes");
    await mkdir(root);
    const { handler, token } = harness(root, false);
    const health = await handler.health({
      capabilityToken: token("health", {}),
      requestedCapabilities: REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
    });
    expect(health.negotiatedCapabilities).toBeUndefined();
  });

  test("retains exact binding authority across a transient root cleanup failure", async () => {
    vi.useFakeTimers();
    try {
      const parent = await mkdtemp(join(tmpdir(), "boring-handler-retry-"));
      const root = join(parent, "sandboxes");
      await mkdir(root);
      const { handler, token, roots } = harness(root);
      const create = request("lease-retry");
      const lease = await handler.create({
        capabilityToken: token("create", create),
        request: create,
      });
      const dispose = vi.spyOn(roots, "dispose");
      dispose.mockRejectedValueOnce(new Error("transient root failure"));

      await expect(
        handler.delete({
          capabilityToken: token("delete", {}, lease.sandboxId),
          sandboxId: lease.sandboxId,
        }),
      ).rejects.toMatchObject({
        code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
      });
      await vi.advanceTimersByTimeAsync(100);
      await expect(
        handler.delete({
          capabilityToken: token("delete", {}, lease.sandboxId),
          sandboxId: lease.sandboxId,
        }),
      ).resolves.toEqual({ disposed: true });
      expect(dispose).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("isolates and independently retires two leases in one authorized workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-handler-"));
    const root = join(parent, "sandboxes");
    await mkdir(root);
    const { handler, token, runner, apply, check } = harness(root);
    const requestA = request("lease-a");
    const requestB = request("lease-b");

    const health = await handler.health({
      capabilityToken: token("health", {}),
      requestedCapabilities: REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
    });
    expect(health.negotiatedCapabilities).toContain(
      REMOTE_WORKER_MULTI_SANDBOX_ROOTS_CAPABILITY_V1,
    );

    const [leaseA, leaseB] = await Promise.all([
      handler.create({
        capabilityToken: token("create", requestA),
        request: requestA,
      }),
      handler.create({
        capabilityToken: token("create", requestB),
        request: requestB,
      }),
    ]);
    expect(leaseA.sandboxId).not.toBe(leaseB.sandboxId);
    expect(new Set(runner.mounts.values())).toEqual(
      new Set([
        join(root, workspaceId, leaseA.sandboxId),
        join(root, workspaceId, leaseB.sandboxId),
      ]),
    );

    for (const [lease, value] of [
      [leaseA, "a"],
      [leaseB, "b"],
    ] as const) {
      const write = { op: "writeFile" as const, path: "state", data: value };
      await handler.fs({
        capabilityToken: token("fs", write, lease.sandboxId),
        sandboxId: lease.sandboxId,
        request: write,
      });
    }
    for (const [lease, value] of [
      [leaseA, "a"],
      [leaseB, "b"],
    ] as const) {
      const read = { op: "readFile" as const, path: "state" };
      await expect(
        handler.fs({
          capabilityToken: token("fs", read, lease.sandboxId),
          sandboxId: lease.sandboxId,
          request: read,
        }),
      ).resolves.toEqual({ content: value });
    }

    const renew = { idleTimeoutMs: 30_000 };
    await expect(
      handler.renew({
        capabilityToken: token("renew", renew, leaseB.sandboxId),
        sandboxId: leaseB.sandboxId,
        request: renew,
      }),
    ).resolves.toMatchObject({ leaseExpiresAtMs: nowMs + 30_000 });
    await handler.delete({
      capabilityToken: token("delete", {}, leaseA.sandboxId),
      sandboxId: leaseA.sandboxId,
    });
    await expect(
      lstat(join(root, workspaceId, leaseA.sandboxId)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(root, workspaceId, leaseB.sandboxId))).resolves.toMatchObject({});
    const readB = { op: "readFile" as const, path: "state" };
    await expect(
      handler.fs({
        capabilityToken: token("fs", readB, leaseB.sandboxId),
        sandboxId: leaseB.sandboxId,
        request: readB,
      }),
    ).resolves.toEqual({ content: "b" });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls.every(([id]) => id === workspaceId)).toBe(true);
    await handler.delete({
      capabilityToken: token("delete", {}, leaseB.sandboxId),
      sandboxId: leaseB.sandboxId,
    });
  });
});
