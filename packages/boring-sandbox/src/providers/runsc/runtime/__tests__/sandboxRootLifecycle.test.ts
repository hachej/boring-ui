import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { RUNSC_RUNTIME_LIMITS_V1 } from "../limits";
import {
  FixedProjectQuotaManagerV1,
  RUNSC_QUOTA_LOCK_NAME,
} from "../quota";
import { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";

const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const aliasWorkspace = "abcdef00-0000-4000-8000-000000000003";

async function lifecycle() {
  const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
  const root = join(parent, "sandboxes");
  await mkdir(root, { mode: 0o750 });
  const quota = {
    workspaceRoot: root,
    apply: vi.fn(async () => undefined),
    check: vi.fn(async () => undefined),
  };
  return {
    root,
    quota,
    roots: new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      trustedOwnerUid: process.getuid?.() ?? 0,
    }),
  };
}

describe("runsc per-sandbox root lifecycle", () => {
  test.each(["prepare", "startup"] as const)(
    "sanitizes inaccessible-root filesystem failures at the %s boundary",
    async (operation) => {
      const { root, roots, quota } = await lifecycle();
      await chmod(root, 0o000);
      let failure: unknown;
      try {
        if (operation === "prepare") {
          await roots.prepare(workspaceA, "sandbox-a", quota);
        } else {
          await roots.startupSweep();
        }
      } catch (error) {
        failure = error;
      } finally {
        await chmod(root, 0o750);
      }
      expect(failure).toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      });
      expect(String(failure)).not.toContain(root);
      expect(JSON.stringify(failure)).not.toContain(root);
    },
  );

  test("creates exact workspace+sandbox children and removes only one", async () => {
    const { root, roots, quota } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a", quota);
    const sourceB = await roots.prepare(workspaceA, "sandbox-b", quota);
    await writeFile(join(String(sourceA), "state"), "a");
    await writeFile(join(String(sourceB), "state"), "b");

    await roots.dispose(sourceA);

    await expect(lstat(String(sourceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(String(sourceB), "state"), "utf8"),
    ).resolves.toBe("b");
    await expect(lstat(root)).resolves.toMatchObject({});
  });

  test("fails closed on aliased identities, existing leaves, and symlinked parents", async () => {
    const { root, roots, quota } = await lifecycle();
    await expect(
      roots.prepare(aliasWorkspace.toUpperCase(), "sandbox-upper", quota),
    ).rejects.toMatchObject({ code: "REMOTE_WORKER_REQUEST_INVALID" });
    await expect(
      roots.prepare(` ${workspaceA}`, "sandbox-spaced", quota),
    ).rejects.toMatchObject({ code: "REMOTE_WORKER_REQUEST_INVALID" });
    await roots.prepare(workspaceA, "sandbox-a", quota);
    await expect(
      roots.prepare(workspaceA, "sandbox-a", quota),
    ).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
    await expect(
      lstat(join(root, workspaceA, "sandbox-a")),
    ).resolves.toMatchObject({});

    await symlink(join(root, workspaceA), join(root, workspaceB));
    await expect(
      roots.prepare(workspaceB, "sandbox-b", quota),
    ).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
  });

  test.each(["retry", "close", "startup"] as const)(
    "retains failed prepare cleanup authority until %s converges",
    async (convergence) => {
      const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
      const root = join(parent, "sandboxes");
      await mkdir(root, { mode: 0o750 });
      let removeAttempts = 0;
      const roots = new RunscSandboxRootLifecycleV1({
        sandboxRoot: root,
        prepareOwnership: async () => {
          throw new Error("ownership failed");
        },
        removeSandboxRoot: async (path) => {
          removeAttempts += 1;
          if (removeAttempts === 1) throw new Error("injected remove failure");
          await rm(path, { recursive: true, force: true });
        },
        trustedOwnerUid: process.getuid?.() ?? 0,
      });
      const quota = {
        workspaceRoot: root,
        apply: vi.fn(async () => undefined),
        check: vi.fn(async () => undefined),
      };
      const sandboxRoot = join(root, workspaceA, "sandbox-a");

      await expect(
        roots.prepare(workspaceA, "sandbox-a", quota),
      ).rejects.toMatchObject({
        code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
        message: "remote-worker sandbox root cleanup is incomplete",
      });
      await expect(lstat(sandboxRoot)).resolves.toMatchObject({});
      expect(roots.pendingCleanupCount).toBe(1);

      if (convergence === "retry") {
        await expect(roots.retryPendingCleanup()).resolves.toBe(1);
      } else if (convergence === "close") {
        await expect(roots.close()).resolves.toBeUndefined();
      } else {
        await expect(roots.startupSweep()).resolves.toBe(1);
      }
      expect(removeAttempts).toBe(2);
      expect(roots.pendingCleanupCount).toBe(0);
      await expect(lstat(sandboxRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  test("retains pending authority through ambiguous parent cleanup then ENOENT retry", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let parentAttempts = 0;
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => {
        throw new Error("ownership failed");
      },
      removeWorkspaceRoot: async (path) => {
        parentAttempts += 1;
        await rmdir(path);
        if (parentAttempts === 1) throw new Error("parent response lost");
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };
    await expect(
      roots.prepare(workspaceA, "sandbox-a", quota),
    ).rejects.toMatchObject({
      code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
    });
    expect(roots.pendingCleanupCount).toBe(1);
    await expect(
      lstat(join(root, workspaceA, "sandbox-a")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(roots.retryPendingCleanup()).resolves.toBe(1);
    expect(roots.pendingCleanupCount).toBe(0);
    expect(parentAttempts).toBe(1);
  });

  test("retains failed-prepare parent cleanup after a permission error", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let parentAttempts = 0;
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => {
        throw new Error("ownership failed");
      },
      removeWorkspaceRoot: async (path) => {
        parentAttempts += 1;
        if (parentAttempts === 1) {
          throw Object.assign(new Error("permission uncertain"), {
            code: "EACCES",
          });
        }
        await rmdir(path);
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };

    await expect(
      roots.prepare(workspaceA, "sandbox-a", quota),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    expect(roots.pendingCleanupCount).toBe(1);
    await expect(
      lstat(join(root, workspaceA, "sandbox-a")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(join(root, workspaceA))).resolves.toMatchObject({});

    await expect(roots.retryPendingCleanup()).resolves.toBe(1);
    expect(parentAttempts).toBe(2);
    expect(roots.pendingCleanupCount).toBe(0);
    await expect(lstat(join(root, workspaceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("retries ambiguous parent removal after the leaf is already absent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let parentAttempts = 0;
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      removeWorkspaceRoot: async (path) => {
        parentAttempts += 1;
        if (parentAttempts === 1) {
          throw Object.assign(new Error("permission uncertain"), {
            code: "EACCES",
          });
        }
        await rmdir(path);
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };
    const source = await roots.prepare(workspaceA, "sandbox-a", quota);

    await expect(roots.dispose(source)).rejects.toMatchObject({
      code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
    });
    await expect(lstat(String(source))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(join(root, workspaceA))).resolves.toMatchObject({});

    await expect(roots.dispose(source)).resolves.toBeUndefined();
    expect(parentAttempts).toBe(2);
    await expect(lstat(join(root, workspaceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("converges when an owned parent is already absent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => {
        throw new Error("ownership failed");
      },
      removeWorkspaceRoot: async (path) => {
        await rmdir(path);
        throw Object.assign(new Error("already absent"), { code: "ENOENT" });
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };
    await expect(
      roots.prepare(workspaceA, "sandbox-a", quota),
    ).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
    await expect(roots.retryPendingCleanup()).resolves.toBe(0);
    await expect(lstat(join(root, workspaceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("converges when retry observes ENOENT after an after-effect removal failure", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let removeAttempts = 0;
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      removeSandboxRoot: async (path) => {
        removeAttempts += 1;
        await rm(path, { recursive: true, force: true });
        throw new Error("response lost after removal");
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };
    const source = await roots.prepare(workspaceA, "sandbox-a", quota);
    await expect(roots.dispose(source)).rejects.toMatchObject({
      code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
    });
    await expect(roots.dispose(source)).resolves.toBeUndefined();
    expect(removeAttempts).toBe(1);

    const pendingRoots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => {
        throw new Error("ownership failed");
      },
      removeSandboxRoot: async (path) => {
        await rm(path, { recursive: true, force: true });
        throw new Error("response lost after removal");
      },
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    await expect(
      pendingRoots.prepare(workspaceB, "sandbox-b", quota),
    ).rejects.toMatchObject({ code: "REMOTE_WORKER_INCOMPLETE_CLEANUP" });
    await expect(pendingRoots.retryPendingCleanup()).resolves.toBe(1);
  });

  test("serializes retry and sweep behind an in-flight prepare", async () => {
    const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
    const root = join(parent, "sandboxes");
    await mkdir(root, { mode: 0o750 });
    let releaseOwnership: (() => void) | undefined;
    const ownershipGate = new Promise<void>((resolve) => {
      releaseOwnership = resolve;
    });
    const roots = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => await ownershipGate,
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => undefined),
      check: vi.fn(async () => undefined),
    };

    const preparing = roots.prepare(workspaceA, "sandbox-a", quota);
    await vi.waitFor(async () =>
      expect(lstat(join(root, workspaceA, "sandbox-a"))).resolves.toMatchObject(
        {},
      ),
    );
    let retrySettled = false;
    const retry = roots.retryPendingCleanup().then((count) => {
      retrySettled = true;
      return count;
    });
    let sweepSettled = false;
    const sweep = roots.startupSweep().then((count) => {
      sweepSettled = true;
      return count;
    });
    await Promise.resolve();
    expect(retrySettled).toBe(false);
    expect(sweepSettled).toBe(false);
    await expect(lstat(join(root, workspaceA, "sandbox-a"))).resolves.toMatchObject(
      {},
    );

    releaseOwnership?.();
    const source = await preparing;
    await expect(retry).resolves.toBe(0);
    await expect(sweep).resolves.toBe(1);
    await expect(lstat(String(source))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("excludes the fixed quota lock and admits exactly sweepable distinct roots", async () => {
    const { root, roots, quota } = await lifecycle();
    const lockPath = join(root, RUNSC_QUOTA_LOCK_NAME);
    await writeFile(lockPath, "lock");
    await chmod(lockPath, 0o600);
    const rootCount = Math.floor(
      RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers / 2,
    );
    for (let index = 1; index <= rootCount; index += 1) {
      const suffix = index.toString(16).padStart(12, "0");
      await roots.prepare(
        `00000000-0000-4000-8000-${suffix}`,
        `sandbox-${index}`,
        quota,
      );
    }
    expect(roots.ownedRecoveryEntryCount).toBe(
      RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers,
    );
    await expect(
      roots.prepare(workspaceA, "over-capacity", quota),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
    });

    const restarted = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    await expect(restarted.startupSweep()).resolves.toBe(rootCount);
    await expect(lstat(lockPath)).resolves.toMatchObject({});
  }, 30_000);

  test("bounded startup sweep removes owned leaves beneath the dedicated root", async () => {
    const { roots, quota } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a", quota);
    const sourceB = await roots.prepare(workspaceB, "sandbox-b", quota);

    await expect(roots.startupSweep()).resolves.toBe(2);
    await expect(lstat(String(sourceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(String(sourceB))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("composes the fixed quota manager once before leaves and checks it on reuse/restart", async () => {
    const { root, roots } = await lifecycle();
    const run = vi.fn(
      async (_input: {
        readonly argv: readonly ["apply" | "check", string, string];
        readonly timeoutMs: number;
      }) => ({ exitCode: 0, timedOut: false }),
    );
    const quota = new FixedProjectQuotaManagerV1({ run }, root);
    await roots.prepare(workspaceA, "sandbox-a", quota);
    await roots.prepare(workspaceA, "sandbox-b", quota);
    expect(run.mock.calls.map(([input]) => input.argv[0])).toEqual([
      "apply",
      "check",
    ]);

    const restarted = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      trustedOwnerUid: process.getuid?.() ?? 0,
    });
    await restarted.startupSweep();
    await restarted.prepare(workspaceA, "sandbox-c", quota);
    expect(run.mock.calls.map(([input]) => input.argv[0])).toEqual([
      "apply",
      "check",
      "apply",
    ]);
  });

  test("removes a newly-created workspace parent when quota preparation fails", async () => {
    const { root, roots } = await lifecycle();
    const quota = {
      workspaceRoot: root,
      apply: vi.fn(async () => {
        throw new Error("quota unavailable");
      }),
      check: vi.fn(async () => undefined),
    };
    await expect(
      roots.prepare(workspaceA, "sandbox-a", quota),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      message: "remote-worker sandbox root could not be prepared",
    });
    await expect(lstat(join(root, workspaceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("requires startup cleanup before restart admission", async () => {
    const { root, roots, quota } = await lifecycle();
    const existing = await roots.prepare(workspaceA, "sandbox-a", quota);
    const restarted = new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
      trustedOwnerUid: process.getuid?.() ?? 0,
    });

    await expect(
      restarted.prepare(workspaceB, "sandbox-b", quota),
    ).rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe });
    await expect(lstat(String(existing))).resolves.toMatchObject({});
    await expect(restarted.startupSweep()).resolves.toBe(1);
    await expect(
      restarted.prepare(workspaceB, "sandbox-b", quota),
    ).resolves.toEqual(expect.stringContaining("sandbox-b"));
  });

  test("streams bounded startup cleanup so repeated sweeps converge", async () => {
    const { root, roots } = await lifecycle();
    for (
      let index = 1;
      index <= RUNSC_RUNTIME_LIMITS_V1.maxStartupSweepContainers + 1;
      index += 1
    ) {
      const suffix = index.toString(16).padStart(12, "0");
      await mkdir(join(root, `00000000-0000-4000-8000-${suffix}`), {
        mode: 0o750,
      });
    }
    await expect(roots.startupSweep()).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
    });
    await expect(roots.startupSweep()).resolves.toBe(0);
    await expect(readdir(root)).resolves.toEqual([]);
  }, 30_000);

  test("rejects a replaced trusted root and a symlink swapped before cleanup", async () => {
    const { root, roots, quota } = await lifecycle();
    const source = await roots.prepare(workspaceA, "sandbox-a", quota);
    const outside = await mkdtemp(join(tmpdir(), "boring-runsc-outside-"));
    await rm(String(source), { recursive: true });
    await symlink(outside, String(source));
    await expect(roots.dispose(source)).rejects.toMatchObject({
      code: "REMOTE_WORKER_INCOMPLETE_CLEANUP",
    });
    await expect(lstat(outside)).resolves.toMatchObject({});

    const moved = `${root}-moved`;
    await rename(root, moved);
    await mkdir(root, { mode: 0o750 });
    await expect(
      roots.prepare(workspaceB, "sandbox-b", quota),
    ).rejects.toMatchObject({ code: "REMOTE_WORKER_PATH_UNSAFE" });
  });
});
