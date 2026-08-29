import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import { RUNSC_RUNTIME_LIMITS_V1 } from "../limits";
import { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;

function success(): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function runner(): DockerCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (_input: DockerCommandInput) => success()),
  };
}

describe("runsc recoverable resource capacity", () => {
  test("charges retained failed-prepare roots and frees admission after cleanup", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-capacity-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let cleanupAllowed = false;
    let ownershipEffects = 0;
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      trustedOwnerUid: process.getuid?.() ?? 0,
      prepareOwnership: async () => {
        ownershipEffects += 1;
        throw new Error("injected ownership failure");
      },
      removeSandboxRoot: async (path) => {
        if (!cleanupAllowed) {
          throw Object.assign(new Error("injected cleanup failure"), {
            code: "EIO",
          });
        }
        await rm(path, { recursive: true, force: true });
      },
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };
    const retainedBoundary =
      RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers - 1;

    for (let index = 0; index < retainedBoundary; index += 1) {
      await expect(
        roots.prepare(workspaceId, `orphan-${index}`, quota),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      });
    }
    expect(roots.pendingCleanupCount).toBe(retainedBoundary);
    expect(ownershipEffects).toBe(retainedBoundary);

    const docker = runner();
    const sessions = new RunscSessionRuntimeV1({
      runner: docker,
      quota,
      sandboxRoots: roots,
      multiSandboxRootsAdmitted: true,
      runtimeIdFactory: () => "1".repeat(32),
    });
    expect(() =>
      sessions.createComposite({
        sandboxId: "blocked-at-boundary",
        clientLeaseId: "blocked-at-boundary",
        workspaceId,
        image,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    expect(ownershipEffects).toBe(retainedBoundary);
    expect(docker.run).not.toHaveBeenCalled();

    cleanupAllowed = true;
    await expect(roots.retryPendingCleanup()).resolves.toBe(retainedBoundary);
    expect(roots.pendingCleanupCount).toBe(0);

    await expect(
      sessions.createComposite({
        sandboxId: "admitted-after-cleanup",
        clientLeaseId: "admitted-after-cleanup",
        workspaceId,
        image,
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
    });
    expect(ownershipEffects).toBe(retainedBoundary + 1);
    expect(roots.pendingCleanupCount).toBe(0);
    expect(docker.run).not.toHaveBeenCalled();
  }, 30_000);
});
