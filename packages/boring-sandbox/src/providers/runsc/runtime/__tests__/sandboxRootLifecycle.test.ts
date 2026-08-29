import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { RunscSandboxRootLifecycleV1 } from "../sandboxRootLifecycle";

const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";

async function lifecycle() {
  const parent = await mkdtemp(join(tmpdir(), "boring-runsc-roots-"));
  const root = join(parent, "sandboxes");
  await mkdir(root, { mode: 0o750 });
  return {
    root,
    roots: new RunscSandboxRootLifecycleV1({
      sandboxRoot: root,
      prepareOwnership: async () => undefined,
    }),
  };
}

describe("runsc per-sandbox root lifecycle", () => {
  test("creates exact workspace+sandbox children and removes only one", async () => {
    const { root, roots } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a");
    const sourceB = await roots.prepare(workspaceA, "sandbox-b");
    await writeFile(join(String(sourceA), "state"), "a");
    await writeFile(join(String(sourceB), "state"), "b");

    await roots.dispose(sourceA);

    await expect(lstat(String(sourceA))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(String(sourceB), "state"), "utf8")).resolves.toBe("b");
    await expect(lstat(root)).resolves.toMatchObject({});
  });

  test("fails closed on existing leaves and symlinked workspace parents", async () => {
    const { root, roots } = await lifecycle();
    await roots.prepare(workspaceA, "sandbox-a");
    await expect(roots.prepare(workspaceA, "sandbox-a")).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
    await expect(
      lstat(join(root, workspaceA, "sandbox-a")),
    ).resolves.toMatchObject({});

    await symlink(join(root, workspaceA), join(root, workspaceB));
    await expect(roots.prepare(workspaceB, "sandbox-b")).rejects.toMatchObject({
      code: "REMOTE_WORKER_PATH_UNSAFE",
    });
  });

  test("bounded startup sweep removes owned leaves beneath the dedicated root", async () => {
    const { roots } = await lifecycle();
    const sourceA = await roots.prepare(workspaceA, "sandbox-a");
    const sourceB = await roots.prepare(workspaceB, "sandbox-b");

    await expect(roots.startupSweep()).resolves.toBe(2);
    await expect(lstat(String(sourceA))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(String(sourceB))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
