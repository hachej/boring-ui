import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import { RUNSC_RUNTIME_LIMITS_V1 } from "../limits";
import { FixedProjectQuotaManagerV1 } from "../quota";
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
  test("creates exact workspace+sandbox children and removes only one", async () => {
    const { root, roots, quota } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a", quota);
    const sourceB = await roots.prepare(workspaceA, "sandbox-b", quota);
    await writeFile(join(String(sourceA), "state"), "a");
    await writeFile(join(String(sourceB), "state"), "b");

    await roots.dispose(sourceA);

    await expect(lstat(String(sourceA))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(String(sourceB), "state"), "utf8")).resolves.toBe("b");
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
    await expect(roots.prepare(workspaceA, "sandbox-a", quota)).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
    await expect(
      lstat(join(root, workspaceA, "sandbox-a")),
    ).resolves.toMatchObject({});

    await symlink(join(root, workspaceA), join(root, workspaceB));
    await expect(roots.prepare(workspaceB, "sandbox-b", quota)).rejects.toMatchObject({
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

      if (convergence === "retry") {
        await expect(roots.retryPendingCleanup()).resolves.toBe(1);
      } else if (convergence === "close") {
        await expect(roots.close()).resolves.toBeUndefined();
      } else {
        await expect(roots.startupSweep()).resolves.toBe(1);
      }
      expect(removeAttempts).toBe(2);
      await expect(lstat(sandboxRoot)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

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
      prepareOwnership: async () => { throw new Error("ownership failed"); },
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

  test("bounded startup sweep removes owned leaves beneath the dedicated root", async () => {
    const { roots, quota } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a", quota);
    const sourceB = await roots.prepare(workspaceB, "sandbox-b", quota);

    await expect(roots.startupSweep()).resolves.toBe(2);
    await expect(lstat(String(sourceA))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(String(sourceB))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("composes the fixed quota manager once before leaves and checks it on reuse/restart", async () => {
    const { root, roots } = await lifecycle();
    const run = vi.fn(async (_input: {
      readonly argv: readonly ["apply" | "check", string, string];
      readonly timeoutMs: number;
    }) => ({ exitCode: 0, timedOut: false }));
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
    await restarted.prepare(workspaceA, "sandbox-c", quota);
    expect(run.mock.calls.map(([input]) => input.argv[0])).toEqual([
      "apply",
      "check",
      "check",
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
    ).rejects.toThrow("quota unavailable");
    await expect(lstat(join(root, workspaceA))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("bounds workspace parents as well as sandbox leaves during startup", async () => {
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
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
  });

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
