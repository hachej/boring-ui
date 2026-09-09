import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import type { DockerCommandRunner } from "../dockerRunner";
import { RunscWorkspaceHelperClientV1 } from "../workspaceHelperClient";

function runner(response: unknown): DockerCommandRunner {
  return {
    run: vi.fn(async () => ({
      exitCode: 0,
      stdout: new TextEncoder().encode(JSON.stringify(response)),
      stderr: new Uint8Array(),
      timedOut: false,
      truncated: false,
    })),
  };
}

describe("dirfd workspace helper client", () => {
  test.each(["../sibling", "/etc/passwd", "dir/../../escape"])(
    "rejects traversal before Docker: %s",
    async (path) => {
      const commandRunner = runner({ content: "not reached" });
      await expect(
        new RunscWorkspaceHelperClientV1(commandRunner).execute("a".repeat(32), {
          op: "readFile",
          path,
        }),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.pathUnsafe,
      });
      expect(commandRunner.run).not.toHaveBeenCalled();
    },
  );

  test("fails closed when openat2 is unavailable", async () => {
    await expect(
      new RunscWorkspaceHelperClientV1(runner({
        ok: false,
        code: REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable,
      })).probe("a".repeat(32)),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.pathPrimitiveUnavailable,
    });
  });

  test("maps quota failure without helper detail", async () => {
    await expect(
      new RunscWorkspaceHelperClientV1(
        runner({
          ok: false,
          code: REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
          detail: "/host/private/canary",
        }),
      ).execute("a".repeat(32), {
        op: "writeFile",
        path: "file.txt",
        data: "x",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.quotaExceeded,
      message: "remote-worker workspace operation failed",
    });
  });

  test("preserves exclusive-create collisions as an already-exists error", async () => {
    await expect(
      new RunscWorkspaceHelperClientV1(runner({
        ok: false,
        code: REMOTE_WORKER_ERROR_CODES_V1.alreadyExists,
      })).execute("a".repeat(32), {
        op: "createBinaryFile",
        path: "file.bin",
        dataBase64: "eA==",
      }),
    ).rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.alreadyExists });
  });

  test("accepts a real 10 MiB binary workspace request envelope", async () => {
    const commandRunner = runner({ ok: true });
    await new RunscWorkspaceHelperClientV1(commandRunner).execute(
      "a".repeat(32),
      {
        op: "createBinaryFile",
        path: "limit.bin",
        dataBase64: Buffer.alloc(10 * 1024 * 1024, 1).toString("base64"),
      },
    );
    expect(commandRunner.run).toHaveBeenCalledOnce();
    const input = vi.mocked(commandRunner.run).mock.calls[0]?.[0];
    expect(input?.stdin?.byteLength).toBeGreaterThan(13 * 1024 * 1024);
  });
});
