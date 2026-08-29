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
import { RUNSC_RUNTIME_LIMITS_V1 } from "../limits";
import type { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const image = `registry.example/workload@sha256:${"b".repeat(64)}`;
const createInput = { clientLeaseId: "lease-a", workspaceId, image };

function success(stdout = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function runner(
  implementation?: (input: DockerCommandInput) => Promise<DockerCommandResult>,
): DockerCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(
      implementation ??
        (async (input: DockerCommandInput) => {
          if (input.argv[0] === "ps") return success("");
          if (input.argv[0] === "run") return success("container-id\n");
          if (input.argv[0] === "exec" && input.argv.at(-1) === "workspace") {
            return success(JSON.stringify({ openat2: true }));
          }
          return success();
        }),
    ),
  };
}

function roots(prepare?: () => Promise<void>): RunscSandboxRootLifecycleV1 & {
  prepare: ReturnType<typeof vi.fn>;
  startupSweep: ReturnType<typeof vi.fn>;
} {
  return {
    sandboxRoot: "/srv/workspaces",
    prepare: vi.fn(async (authorizedWorkspaceId: string, sandboxId: string) => {
      await prepare?.();
      return `${trustedWorkspaceMountSource("/srv/workspaces", authorizedWorkspaceId)}/${sandboxId}` as TrustedWorkspaceMountSource;
    }),
    dispose: vi.fn(async () => undefined),
    retryPendingCleanup: vi.fn(async () => 0),
    close: vi.fn(async () => undefined),
    startupSweep: vi.fn(async () => 0),
  } as unknown as RunscSandboxRootLifecycleV1 & {
    prepare: ReturnType<typeof vi.fn>;
    startupSweep: ReturnType<typeof vi.fn>;
  };
}

function runtime(
  docker: DockerCommandRunner,
  sandboxRoots: RunscSandboxRootLifecycleV1,
) {
  return new RunscSessionRuntimeV1({
    runner: docker,
    quota: {
      workspaceRoot: sandboxRoots.sandboxRoot,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    },
    sandboxRoots,
    multiSandboxRootsAdmitted: true,
    runtimeIdFactory: () => "a".repeat(32),
    sandboxIdFactory: () => "sandbox-a",
  });
}

describe("RunscSessionRuntimeV1 startup admission", () => {
  test("caps accepted sessions below the worst-case root recovery ceiling", async () => {
    const sandboxRoots = roots();
    const sessions = runtime(runner(), sandboxRoots);
    const limit = Math.floor(
      RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers / 2,
    );
    for (let index = 0; index < limit; index += 1) {
      await sessions.createComposite({
        ...createInput,
        sandboxId: `sandbox-${index}`,
        clientLeaseId: `lease-${index}`,
      });
    }
    expect(() =>
      sessions.createComposite({
        ...createInput,
        sandboxId: "sandbox-over",
        clientLeaseId: "lease-over",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    expect(sandboxRoots.prepare).toHaveBeenCalledTimes(limit);
    await sessions.shutdown();
  });

  test("joins one destructive sweep and makes success idempotent", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const docker = runner(async (input) => {
      if (input.argv[0] === "ps") {
        await gate;
        return success("");
      }
      return success();
    });
    const sandboxRoots = roots();
    const sessions = runtime(docker, sandboxRoots);

    const first = sessions.startupSweep();
    const second = sessions.startupSweep();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(docker.run).toHaveBeenCalledTimes(1));
    release?.();
    await Promise.all([first, second]);
    await sessions.startupSweep();
    expect(docker.run).toHaveBeenCalledTimes(1);
    expect(sandboxRoots.startupSweep).toHaveBeenCalledTimes(1);
  });

  test("rejects create before effects while a sweep owns admission", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const docker = runner(async (input) => {
      if (input.argv[0] === "ps") {
        await gate;
        return success("");
      }
      return success();
    });
    const sandboxRoots = roots();
    const sessions = runtime(docker, sandboxRoots);
    const sweeping = sessions.startupSweep();

    expect(() => sessions.createComposite(createInput)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
      }),
    );
    expect(sandboxRoots.prepare).not.toHaveBeenCalled();
    release?.();
    await sweeping;
  });

  test("rejects sweep while create is pending or a retirement record remains", async () => {
    let releasePrepare: (() => void) | undefined;
    const prepareGate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const docker = runner();
    const sandboxRoots = roots(async () => await prepareGate);
    const sessions = runtime(docker, sandboxRoots);
    const creating = sessions.createComposite(createInput);
    await vi.waitFor(() =>
      expect(sandboxRoots.prepare).toHaveBeenCalledTimes(1),
    );

    expect(() => sessions.startupSweep()).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
      }),
    );
    releasePrepare?.();
    const lease = await creating;
    expect(() => sessions.startupSweep()).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
      }),
    );

    docker.run.mockImplementation(async (input: DockerCommandInput) => {
      if (input.argv[0] === "rm") throw new Error("remove failed");
      if (input.argv[0] === "ps") return success(`${"a".repeat(32)}\n`);
      return success();
    });
    await expect(
      sessions.dispose(lease.sandboxId, workspaceId),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    expect(() => sessions.startupSweep()).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.unavailable,
      }),
    );
  });

  test("releases sweep admission after failure so retry and create can proceed", async () => {
    let attempts = 0;
    const docker = runner(async (input) => {
      if (input.argv[0] === "ps" && ++attempts === 1)
        throw new Error("list failed");
      if (input.argv[0] === "run") return success("container-id\n");
      if (input.argv[0] === "exec" && input.argv.at(-1) === "workspace") {
        return success(JSON.stringify({ openat2: true }));
      }
      return success();
    });
    const sessions = runtime(docker, roots());

    await expect(sessions.startupSweep()).rejects.toBeDefined();
    await expect(sessions.startupSweep()).resolves.toBeUndefined();
    await expect(sessions.createComposite(createInput)).resolves.toMatchObject({
      sandboxId: "sandbox-a",
    });
    expect(attempts).toBe(2);
  });

  test("shutdown joins an admitted sweep before closing roots", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const docker = runner(async (input) => {
      if (input.argv[0] === "ps") {
        await gate;
        return success("");
      }
      return success();
    });
    const sandboxRoots = roots();
    const sessions = runtime(docker, sandboxRoots);
    const sweeping = sessions.startupSweep();
    await vi.waitFor(() => expect(docker.run).toHaveBeenCalledTimes(1));
    let closed = false;
    const shutdown = sessions.shutdown().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release?.();
    await Promise.all([sweeping, shutdown]);
    expect(sandboxRoots.close).toHaveBeenCalledTimes(1);
  });
});
