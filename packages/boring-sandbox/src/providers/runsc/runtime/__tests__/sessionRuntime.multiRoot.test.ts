import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import {
  trustedWorkspaceMountSource,
  type TrustedWorkspaceMountSource,
} from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import type { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";
const aliasWorkspaceId = "abcdef00-0000-4000-8000-000000000003";

function success(stdout: unknown = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout:
      typeof stdout === "string"
        ? new TextEncoder().encode(stdout)
        : new TextEncoder().encode(JSON.stringify(stdout)),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function fakeRunner(): DockerCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (input: DockerCommandInput) => {
      if (input.argv[0] === "ps") return success("");
      if (input.argv[0] !== "exec") return success("container-id\n");
      if (input.argv.at(-1) === "workspace") {
        const request = JSON.parse(new TextDecoder().decode(input.stdin));
        return request.op === "probe"
          ? success({ openat2: true })
          : success({ ok: true });
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

function multiSandboxRoots(): RunscSandboxRootLifecycleV1 {
  const prepared = new Set<string>();
  const inflight = new Map<string, Promise<void>>();
  return {
    sandboxRoot: "/srv/boring/workspaces",
    prepare: vi.fn(
      async (
        authorizedWorkspaceId: string,
        sandboxId: string,
        quota: {
          readonly workspaceRoot?: string;
          apply(workspaceId: string): Promise<void>;
          check(workspaceId: string): Promise<void>;
        },
      ) => {
        const pending = inflight.get(authorizedWorkspaceId);
        if (pending) {
          await pending;
          await quota.check(authorizedWorkspaceId);
        } else if (prepared.has(authorizedWorkspaceId)) {
          await quota.check(authorizedWorkspaceId);
        } else {
          const operation = quota.apply(authorizedWorkspaceId);
          inflight.set(authorizedWorkspaceId, operation);
          try {
            await operation;
            prepared.add(authorizedWorkspaceId);
          } finally {
            inflight.delete(authorizedWorkspaceId);
          }
        }
        return `${trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          authorizedWorkspaceId,
        )}/${sandboxId}` as TrustedWorkspaceMountSource;
      },
    ),
    dispose: vi.fn(async () => undefined),
    retryPendingCleanup: vi.fn(async () => 0),
    close: vi.fn(async () => undefined),
    startupSweep: vi.fn(async () => 0),
  } as unknown as RunscSandboxRootLifecycleV1;
}

function runtime(
  options: {
    readonly roots?: RunscSandboxRootLifecycleV1;
    readonly admitted?: boolean;
    readonly quota?: {
      readonly workspaceRoot?: string;
      apply(workspaceId: string): Promise<void>;
      check(workspaceId: string): Promise<void>;
    };
    readonly runtimeIdFactory?: () => string;
    readonly sandboxIdFactory?: () => string;
    readonly runner?: DockerCommandRunner;
    readonly now?: () => number;
  } = {},
) {
  let id = 0;
  return new RunscSessionRuntimeV1({
    runner: options.runner ?? fakeRunner(),
    quota: options.quota ?? {
      ...(options.roots ? { workspaceRoot: options.roots.sandboxRoot } : {}),
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    },
    runtimeIdFactory:
      options.runtimeIdFactory ?? (() => (++id).toString(16).padStart(32, "0")),
    ...(options.sandboxIdFactory
      ? { sandboxIdFactory: options.sandboxIdFactory }
      : {}),
    sandboxRoots: options.roots,
    ...(options.now ? { now: options.now } : {}),
    ...(options.admitted === undefined
      ? {}
      : { multiSandboxRootsAdmitted: options.admitted }),
  });
}

const createInput = {
  sandboxId: "sandbox-a",
  clientLeaseId: "lease-a",
  workspaceId,
  image,
};
const legacyCreateInput = {
  ...createInput,
  workspaceMountSource: trustedWorkspaceMountSource(
    "/srv/boring/workspaces",
    workspaceId,
  ),
};

const mkdirRequest = { op: "mkdir" as const, path: "dir", recursive: true };
describe("runsc multi-root and legacy compatibility", () => {
  test.each([
    { roots: false, admitted: undefined, expected: false },
    { roots: false, admitted: false, expected: false },
    { roots: false, admitted: true, expected: false },
    { roots: true, admitted: undefined, expected: false },
    { roots: true, admitted: false, expected: false },
    { roots: true, admitted: true, expected: true },
  ])(
    "reports multi-root support only for configured and admitted roots %#",
    ({ roots, admitted, expected }) => {
      const sessions = runtime({
        roots: roots ? multiSandboxRoots() : undefined,
        admitted,
      });
      expect(sessions.supportsMultiSandboxRoots).toBe(expected);
    },
  );

  test("exposes distinct legacy and qualified composite create gates", async () => {
    const roots = multiSandboxRoots();
    const dormant = runtime({ roots, admitted: false });
    expect(() => dormant.create(legacyCreateInput)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      }),
    );
    expect(() => dormant.createComposite(createInput)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unqualified,
      }),
    );
    const legacy = runtime();
    expect(() => legacy.createComposite(createInput)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unqualified,
      }),
    );
  });

  test("starts composite deadlines after delayed quota and container setup", async () => {
    let nowMs = 100;
    let releaseQuota: (() => void) | undefined;
    let releaseRun: (() => void) | undefined;
    const quotaGate = new Promise<void>((resolve) => {
      releaseQuota = resolve;
    });
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const roots = multiSandboxRoots();
    const docker = fakeRunner();
    const originalRun = docker.run.getMockImplementation() as (
      input: DockerCommandInput,
    ) => Promise<DockerCommandResult>;
    docker.run.mockImplementation(async (input) => {
      if (input.argv[0] === "run") await runGate;
      return await originalRun(input);
    });
    const apply = vi.fn(async () => await quotaGate);
    const sessions = runtime({
      roots,
      admitted: true,
      runner: docker,
      now: () => nowMs,
      quota: { workspaceRoot: roots.sandboxRoot, apply, check: vi.fn() },
    });
    const creating = sessions.createComposite({
      ...createInput,
      idleTtlMs: 1_000,
      hardLifetimeMs: 5_000,
    });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    nowMs = 500;
    releaseQuota?.();
    await vi.waitFor(() =>
      expect(docker.run).toHaveBeenCalledWith(
        expect.objectContaining({ argv: expect.arrayContaining(["run"]) }),
      ),
    );
    nowMs = 900;
    releaseRun?.();
    await expect(creating).resolves.toEqual({
      sandboxId: "sandbox-a",
      leaseExpiresAtMs: 1_900,
      hardExpiresAtMs: 5_900,
      newlyAllocated: true,
    });
    await sessions.dispose("sandbox-a", workspaceId);
  });

  test("validates runtime identity before preparing a lease root", async () => {
    const roots = multiSandboxRoots();
    let validRuntimeId = false;
    const sessions = runtime({
      roots,
      admitted: true,
      runtimeIdFactory: () =>
        validRuntimeId ? "1".repeat(32) : "invalid-runtime-id",
    });

    await expect(sessions.createComposite(createInput)).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.configInvalid,
    });
    expect(roots.prepare).not.toHaveBeenCalled();
    expect(roots.dispose).not.toHaveBeenCalled();

    validRuntimeId = true;
    await expect(sessions.createComposite(createInput)).resolves.toMatchObject({
      newlyAllocated: true,
    });
    await sessions.dispose("sandbox-a", workspaceId);
    expect(roots.prepare).toHaveBeenCalledTimes(1);
    expect(roots.dispose).toHaveBeenCalledTimes(1);
  });

  test("keys same-named sandboxes and create replays by authorized workspace", async () => {
    const sessions = runtime({ roots: multiSandboxRoots(), admitted: true });
    await sessions.createComposite(createInput);
    await sessions.createComposite({
      ...createInput,
      workspaceId: secondWorkspaceId,
    });

    await sessions.dispose("sandbox-a", workspaceId);
    await expect(
      sessions.renew("sandbox-a", secondWorkspaceId, 1_000),
    ).resolves.toMatchObject({ sandboxId: "sandbox-a" });
    await expect(
      sessions.renew("sandbox-a", workspaceId, 1_000),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
    });
  });

  test("preserves legacy sandbox-only fs, renew, dispose, and workspace normalization", async () => {
    const apply = vi.fn(async () => undefined);
    const check = vi.fn(async () => undefined);
    const sessions = runtime({ quota: { apply, check } });
    const legacyWorkspaceId = ` ${workspaceId.toUpperCase()} `;
    const legacyInput = {
      ...legacyCreateInput,
      workspaceId: legacyWorkspaceId,
      workspaceMountSource: trustedWorkspaceMountSource(
        "/srv/boring/workspaces",
        workspaceId,
      ),
    };
    await sessions.create(legacyInput);

    await expect(
      sessions.renew("sandbox-a", workspaceId, 1_000),
    ).resolves.toMatchObject({ sandboxId: "sandbox-a" });
    const fsResult: Awaited<ReturnType<RunscSessionRuntimeV1["fs"]>> =
      await sessions.fs("sandbox-a", mkdirRequest);
    expect(fsResult).toEqual({ ok: true });
    await expect(sessions.renew("sandbox-a", 1_000)).resolves.toMatchObject({
      sandboxId: "sandbox-a",
    });
    await expect(sessions.dispose("sandbox-a")).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledWith(workspaceId);
    expect(check).toHaveBeenCalledWith(workspaceId);
  });

  test("preserves legacy workspace, sandbox, and client-lease collision behavior", async () => {
    const sessions = runtime();
    await sessions.create(legacyCreateInput);
    expect(() =>
      sessions.create({
        ...legacyCreateInput,
        sandboxId: "sandbox-b",
        clientLeaseId: "lease-b",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
    expect(() =>
      sessions.create({
        ...legacyCreateInput,
        workspaceId: secondWorkspaceId,
        workspaceMountSource: trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          secondWorkspaceId,
        ),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
  });

  test("rejects a pending legacy replay that changes its sandbox id", async () => {
    let releaseApply: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const sessions = runtime({
      quota: {
        apply: vi.fn(async () => await gate),
        check: vi.fn(async () => undefined),
      },
    });
    const first = sessions.create(legacyCreateInput);

    expect(() =>
      sessions.create({ ...legacyCreateInput, sandboxId: "sandbox-b" }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );

    releaseApply?.();
    await expect(first).resolves.toMatchObject({ sandboxId: "sandbox-a" });
  });

  test("admits concurrent roots while charging the same workspace quota", async () => {
    let releaseApply: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const apply = vi.fn(async () => await gate);
    const check = vi.fn(async () => undefined);
    const roots = multiSandboxRoots();
    const sessions = runtime({
      roots,
      admitted: true,
      quota: { workspaceRoot: roots.sandboxRoot, apply, check },
    });
    const first = sessions.createComposite(createInput);
    const second = sessions.createComposite({
      ...createInput,
      sandboxId: "sandbox-b",
      clientLeaseId: "lease-b",
    });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    releaseApply?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(apply.mock.calls).toEqual([[workspaceId]]);
    expect(check.mock.calls).toEqual([[workspaceId]]);
  });

  test("shutdown waits for delayed quota before revoking legacy create", async () => {
    let releaseQuota: (() => void) | undefined;
    const quotaGate = new Promise<void>((resolve) => {
      releaseQuota = resolve;
    });
    const docker = fakeRunner();
    const quota = {
      apply: vi.fn(async () => await quotaGate),
      check: vi.fn(async () => undefined),
    };
    const sessions = runtime({ runner: docker, quota });
    const creating = sessions.create(legacyCreateInput);
    await vi.waitFor(() => expect(quota.apply).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = sessions.shutdown().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseQuota?.();
    await expect(creating).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
    });
    await closing;
    expect(quota.check).not.toHaveBeenCalled();
    expect(docker.run).not.toHaveBeenCalled();
  });

  test("shutdown waits for delayed root preparation and compensates it", async () => {
    let releaseRoot: (() => void) | undefined;
    const rootGate = new Promise<void>((resolve) => {
      releaseRoot = resolve;
    });
    const roots = multiSandboxRoots();
    vi.mocked(roots.prepare).mockImplementationOnce(
      async (authorizedWorkspaceId: string, sandboxId: string) => {
        await rootGate;
        return `${trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          authorizedWorkspaceId,
        )}/${sandboxId}` as TrustedWorkspaceMountSource;
      },
    );
    const docker = fakeRunner();
    const sessions = runtime({ roots, admitted: true, runner: docker });
    const creating = sessions.createComposite(createInput);
    await vi.waitFor(() => expect(roots.prepare).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = sessions.shutdown().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseRoot?.();
    await expect(creating).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
    });
    await closing;
    expect(roots.dispose).toHaveBeenCalledTimes(1);
    expect(roots.close).toHaveBeenCalledTimes(1);
    expect(
      docker.run.mock.calls.some(([input]) => input.argv[0] === "run"),
    ).toBe(false);
  });

  test("concurrent shutdown waits for accepted container create and retirement", async () => {
    let releaseRun: (() => void) | undefined;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const roots = multiSandboxRoots();
    const docker = fakeRunner();
    const baseRun = docker.run.getMockImplementation() as (
      input: DockerCommandInput,
    ) => Promise<DockerCommandResult>;
    docker.run.mockImplementation(async (input) => {
      if (input.argv[0] === "run") await runGate;
      return await baseRun(input);
    });
    const sessions = runtime({ roots, admitted: true, runner: docker });
    const creating = sessions.createComposite(createInput);
    await vi.waitFor(() =>
      expect(
        docker.run.mock.calls.some(([input]) => input.argv[0] === "run"),
      ).toBe(true),
    );
    let closed = 0;
    const first = sessions.shutdown().then(() => {
      closed += 1;
    });
    const second = sessions.shutdown().then(() => {
      closed += 1;
    });
    await Promise.resolve();
    expect(closed).toBe(0);
    releaseRun?.();
    await expect(creating).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
    });
    await Promise.all([first, second]);
    expect(roots.dispose).toHaveBeenCalledTimes(1);
    expect(roots.close).toHaveBeenCalledTimes(1);
    expect(
      docker.run.mock.calls.filter(([input]) => input.argv[0] === "rm"),
    ).toHaveLength(1);
    const callsAfterClose = docker.run.mock.calls.length;
    await Promise.resolve();
    expect(docker.run).toHaveBeenCalledTimes(callsAfterClose);
  });

  test("coalesces concurrent failed shutdown cleanup before one retry", async () => {
    const roots = multiSandboxRoots();
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let closeAttempts = 0;
    vi.mocked(roots.close).mockImplementation(async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) {
        await closeGate;
        throw Object.assign(new Error("cleanup pending"), {
          code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        });
      }
    });
    const sessions = runtime({ roots, admitted: true });
    await sessions.createComposite(createInput);
    const first = sessions.shutdown();
    const second = sessions.shutdown();
    await vi.waitFor(() => expect(roots.close).toHaveBeenCalledTimes(1));
    releaseClose?.();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.map(({ status }) => status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(roots.dispose).toHaveBeenCalledTimes(1);
    await expect(sessions.shutdown()).resolves.toBeUndefined();
    expect(roots.close).toHaveBeenCalledTimes(2);
    expect(roots.dispose).toHaveBeenCalledTimes(1);
  });

  test("retries root lifecycle shutdown until pending cleanup converges", async () => {
    const roots = multiSandboxRoots();
    let attempts = 0;
    vi.mocked(roots.close).mockImplementation(async () => {
      attempts += 1;
      expect(roots.dispose).toHaveBeenCalledTimes(1);
      if (attempts === 1) {
        throw Object.assign(new Error("cleanup pending"), {
          code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        });
      }
    });
    const sessions = runtime({ roots, admitted: true });
    await sessions.createComposite(createInput);
    await expect(sessions.shutdown()).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    await expect(sessions.shutdown()).resolves.toBeUndefined();
    expect(roots.close).toHaveBeenCalledTimes(2);
  });

  test("reserves legacy sandbox identity before effects and joins only the exact request", async () => {
    let releaseQuota: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseQuota = resolve;
    });
    const docker = fakeRunner();
    const sessions = runtime({
      runner: docker,
      quota: {
        apply: vi.fn(async () => await gate),
        check: vi.fn(async () => undefined),
      },
    });
    const first = sessions.create(legacyCreateInput);
    const replay = sessions.create(legacyCreateInput);
    expect(() =>
      sessions.create({
        ...legacyCreateInput,
        clientLeaseId: "lease-b",
        workspaceId: secondWorkspaceId,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
    releaseQuota?.();
    await expect(Promise.all([first, replay])).resolves.toHaveLength(2);
    expect(
      docker.run.mock.calls.filter(([request]) => request.argv[0] === "run"),
    ).toHaveLength(1);
    await sessions.dispose("sandbox-a");
    expect(
      docker.run.mock.calls.filter(([request]) => request.argv[0] === "rm"),
    ).toHaveLength(1);
  });

  test("reserves factory-issued composite identities while preserving cross-workspace isolation", async () => {
    const roots = multiSandboxRoots();
    const sandboxIdFactory = vi.fn(() => "factory-sandbox");
    const sessions = runtime({ roots, admitted: true, sandboxIdFactory });
    const first = sessions.createComposite({
      ...createInput,
      sandboxId: undefined,
    });
    const replay = sessions.createComposite({
      ...createInput,
      sandboxId: undefined,
    });
    expect(() =>
      sessions.createComposite({
        ...createInput,
        sandboxId: undefined,
        clientLeaseId: "lease-b",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
    const second = sessions.createComposite({
      ...createInput,
      sandboxId: undefined,
      workspaceId: secondWorkspaceId,
    });
    await expect(Promise.all([first, replay, second])).resolves.toEqual([
      expect.objectContaining({
        sandboxId: "factory-sandbox",
        newlyAllocated: true,
      }),
      expect.objectContaining({
        sandboxId: "factory-sandbox",
        newlyAllocated: false,
      }),
      expect.objectContaining({
        sandboxId: "factory-sandbox",
        newlyAllocated: true,
      }),
    ]);
    expect(sandboxIdFactory).toHaveBeenCalledTimes(3);
    await sessions.dispose("factory-sandbox", workspaceId);
    await expect(
      sessions.renew("factory-sandbox", secondWorkspaceId, 1_000),
    ).resolves.toMatchObject({ sandboxId: "factory-sandbox" });
    await sessions.dispose("factory-sandbox", secondWorkspaceId);
  });

  test("derives composite idempotency from normalized runtime inputs, never a supplied digest", async () => {
    let releaseQuota: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseQuota = resolve;
    });
    const roots = multiSandboxRoots();
    const sessions = runtime({
      roots,
      admitted: true,
      quota: {
        workspaceRoot: roots.sandboxRoot,
        apply: vi.fn(async () => await gate),
        check: vi.fn(async () => undefined),
      },
    });
    const forged = `sha256:${"a".repeat(64)}`;
    const first = sessions.createComposite({
      ...createInput,
      createDigest: forged,
    } as never);
    const ignoredMountReplay = sessions.createComposite({
      ...createInput,
      workspaceMountSource: "/forged/root",
    } as never);
    for (const changed of [
      { image: `${image}-changed` },
      { idleTtlMs: 2_000 },
      { sandboxId: "sandbox-b" },
    ]) {
      expect(() =>
        sessions.createComposite({
          ...createInput,
          ...changed,
          createDigest: forged,
        } as never),
      ).toThrowError(
        expect.objectContaining({
          code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
        }),
      );
    }
    expect(() =>
      sessions.createComposite({
        ...createInput,
        workspaceId: aliasWorkspaceId.toUpperCase(),
        createDigest: forged,
      } as never),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      }),
    );
    await vi.waitFor(() => expect(roots.prepare).toHaveBeenCalledTimes(1));
    releaseQuota?.();
    await expect(Promise.all([first, ignoredMountReplay])).resolves.toHaveLength(
      2,
    );
    await sessions.dispose("sandbox-a", workspaceId);
  });

  test("shutdown waits for admitted startup sweep", async () => {
    let releaseList: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const roots = multiSandboxRoots();
    const docker = fakeRunner();
    const baseRun = docker.run.getMockImplementation() as (
      input: DockerCommandInput,
    ) => Promise<DockerCommandResult>;
    docker.run.mockImplementation(async (input) => {
      if (input.argv[0] === "ps") await gate;
      return await baseRun(input);
    });
    const sessions = runtime({ roots, admitted: true, runner: docker });
    const sweeping = sessions.startupSweep();
    await vi.waitFor(() => expect(docker.run).toHaveBeenCalledTimes(1));
    let closed = false;
    const closing = sessions.shutdown().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    releaseList?.();
    await sweeping;
    await closing;
    expect(roots.startupSweep).toHaveBeenCalledTimes(1);
    const calls = docker.run.mock.calls.length;
    await Promise.resolve();
    expect(docker.run).toHaveBeenCalledTimes(calls);
  });

  test.each(["fs", "exec"] as const)(
    "shutdown waits for admitted %s work",
    async (kind) => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const roots = multiSandboxRoots();
      const docker = fakeRunner();
      const baseRun = docker.run.getMockImplementation() as (
        input: DockerCommandInput,
      ) => Promise<DockerCommandResult>;
      let block = false;
      docker.run.mockImplementation(async (input) => {
        if (
          block &&
          input.argv[0] === "exec" &&
          input.argv.at(-1) === (kind === "fs" ? "workspace" : "invoke")
        )
          await gate;
        return await baseRun(input);
      });
      const sessions = runtime({ roots, admitted: true, runner: docker });
      await sessions.createComposite(createInput);
      block = true;
      const admitted =
        kind === "fs"
          ? sessions.fs("sandbox-a", workspaceId, mkdirRequest)
          : sessions.exec("sandbox-a", workspaceId, {
              invocationId: "invocation-a",
              command: "printf ok",
              timeoutMs: 30_000,
              maxOutputBytes: 1024,
            });
      await vi.waitFor(() =>
        expect(
          docker.run.mock.calls.some(
            ([input]) =>
              input.argv[0] === "exec" &&
              input.argv.at(-1) === (kind === "fs" ? "workspace" : "invoke"),
          ),
        ).toBe(true),
      );
      let closed = false;
      const closing = sessions.shutdown().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      release?.();
      await admitted;
      await closing;
      const calls = docker.run.mock.calls.length;
      await Promise.resolve();
      expect(docker.run).toHaveBeenCalledTimes(calls);
    },
  );

  test.each([
    { kind: "exec", hardExpiry: false, expiryAdvanceMs: 100 },
    { kind: "fs", hardExpiry: false, expiryAdvanceMs: 100 },
    { kind: "exec", hardExpiry: true, expiryAdvanceMs: 100 },
    { kind: "fs", hardExpiry: true, expiryAdvanceMs: 100 },
    { kind: "exec", hardExpiry: true, expiryAdvanceMs: 101 },
    { kind: "fs", hardExpiry: true, expiryAdvanceMs: 101 },
  ] as const)(
    "pins an active $kind through hard-expiry=$hardExpiry at +$expiryAdvanceMs ms",
    async ({ kind, hardExpiry, expiryAdvanceMs }) => {
      vi.useFakeTimers();
      try {
        let nowMs = 1_000;
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const roots = multiSandboxRoots();
        const docker = fakeRunner();
        const baseRun = docker.run.getMockImplementation() as (
          input: DockerCommandInput,
        ) => Promise<DockerCommandResult>;
        let block = false;
        docker.run.mockImplementation(async (input) => {
          if (
            block &&
            input.argv[0] === "exec" &&
            input.argv.at(-1) === (kind === "fs" ? "workspace" : "invoke")
          ) {
            await gate;
          }
          return await baseRun(input);
        });
        const sessions = runtime({
          roots,
          admitted: true,
          runner: docker,
          now: () => nowMs,
        });
        const lease = await sessions.createComposite({
          ...createInput,
          idleTtlMs: hardExpiry ? 500 : 100,
          hardLifetimeMs: hardExpiry ? 100 : 500,
        });
        const leaseBeforeExpiry = { ...lease };
        block = true;
        const operation =
          kind === "fs"
            ? sessions.fs("sandbox-a", workspaceId, mkdirRequest)
            : sessions.exec("sandbox-a", workspaceId, {
                invocationId: "invocation-expiry",
                command: "printf ok",
                timeoutMs: 30_000,
                maxOutputBytes: 1_024,
              });
        await vi.advanceTimersByTimeAsync(0);
        expect(
          docker.run.mock.calls.some(
            ([input]) =>
              input.argv[0] === "exec" &&
              input.argv.at(-1) === (kind === "fs" ? "workspace" : "invoke"),
          ),
        ).toBe(true);
        const removalsBeforeExpiry = docker.run.mock.calls.filter(
          ([input]) => input.argv[0] === "rm",
        ).length;

        nowMs = 1_000 + expiryAdvanceMs;
        await vi.advanceTimersByTimeAsync(expiryAdvanceMs);
        expect(
          docker.run.mock.calls.filter(([input]) => input.argv[0] === "rm"),
        ).toHaveLength(removalsBeforeExpiry);
        expect(roots.dispose).not.toHaveBeenCalled();

        if (hardExpiry) {
          await expect(
            sessions.renew("sandbox-a", workspaceId, 1_000),
          ).rejects.toMatchObject({
            code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
          });
          await expect(
            sessions.fs("sandbox-a", workspaceId, mkdirRequest),
          ).rejects.toMatchObject({
            code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
          });
          await expect(
            sessions.exec("sandbox-a", workspaceId, {
              invocationId: "invocation-after-hard-expiry",
              command: "printf late",
              timeoutMs: 30_000,
              maxOutputBytes: 1_024,
            }),
          ).rejects.toMatchObject({
            code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
          });
          expect(lease).toEqual(leaseBeforeExpiry);
          expect(
            docker.run.mock.calls.filter(([input]) => input.argv[0] === "rm"),
          ).toHaveLength(removalsBeforeExpiry);
          expect(roots.dispose).not.toHaveBeenCalled();
        }

        release?.();
        await operation;
        if (hardExpiry) {
          expect(roots.dispose).toHaveBeenCalledTimes(1);
          await expect(
            sessions.renew("sandbox-a", workspaceId, 100),
          ).rejects.toMatchObject({
            code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
          });
        } else {
          await expect(
            sessions.renew("sandbox-a", workspaceId, 100),
          ).resolves.toMatchObject({ sandboxId: "sandbox-a" });
          await sessions.dispose("sandbox-a", workspaceId);
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("requires canonical composite authority for every admitted multi-root operation", async () => {
    const roots = multiSandboxRoots();
    const sessions = runtime({ roots, admitted: true });
    expect(() =>
      sessions.createComposite({
        ...createInput,
        workspaceId: aliasWorkspaceId.toUpperCase(),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
      }),
    );
    expect(roots.prepare).not.toHaveBeenCalled();

    await sessions.createComposite(createInput);
    await expect(sessions.fs("sandbox-a", mkdirRequest)).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
    await expect(sessions.renew("sandbox-a", 1_000)).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
    await expect(sessions.dispose("sandbox-a")).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
    await expect(
      sessions.renew("sandbox-a", aliasWorkspaceId.toUpperCase(), 1_000),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
  });
});
