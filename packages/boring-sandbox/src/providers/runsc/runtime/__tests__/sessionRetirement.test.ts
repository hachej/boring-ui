import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { trustedWorkspaceMountSource } from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import {
  RunscSessionRetirementManagerV1,
  type RetirableRunscSessionRecordV1,
} from "../sessionRetirement";

const workspaceId = "00000000-0000-4000-8000-000000000001";

function result(
  overrides: Partial<DockerCommandResult> = {},
): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}

type CompositeRecord = RetirableRunscSessionRecordV1 & {
  readonly workspaceId: string;
  readonly workspaceMountSource: ReturnType<typeof trustedWorkspaceMountSource>;
  readonly ownsWorkspaceMountSource: true;
};

function record(): CompositeRecord {
  return {
    workspaceId,
    sandboxId: "sandbox-a",
    runtimeId: "a".repeat(32),
    workspaceMountSource: trustedWorkspaceMountSource(
      "/srv/boring/workspaces",
      workspaceId,
    ),
    ownsWorkspaceMountSource: true,
    timer: setTimeout(() => undefined, 60_000),
  };
}

function manager(runner: DockerCommandRunner) {
  const detach = vi.fn();
  const disposeMountSource = vi.fn(async () => undefined);
  return {
    detach,
    disposeMountSource,
    retirement: new RunscSessionRetirementManagerV1({
      runner,
      detach,
      disposeMountSource,
    }),
  };
}

describe("runsc session retirement", () => {
  test.each([
    ["timeout-after-effect", result({ timedOut: true, exitCode: -1 })],
    ["already-absent", result({ exitCode: 1 })],
  ] as const)(
    "converges when Docker removal is %s and exact absence is proven",
    async (_label, removal) => {
      const runner = {
        run: vi.fn(async (input: DockerCommandInput) =>
          input.argv[0] === "rm" ? removal : result(),
        ),
      };
      const { retirement, detach, disposeMountSource } = manager(runner);
      const session = record();

      await expect(
        retirement.retire(session, "cleanup"),
      ).resolves.toBeUndefined();
      expect(disposeMountSource).toHaveBeenCalledTimes(1);
      expect(detach).toHaveBeenCalledWith(session);
    },
  );

  test("retains retirement ownership when the exact owned container remains", async () => {
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) =>
        input.argv[0] === "rm"
          ? result({ exitCode: 1 })
          : result({ stdout: new TextEncoder().encode("container-id\n") }),
      ),
    };
    const { retirement, detach, disposeMountSource } = manager(runner);
    const session = record();

    await expect(retirement.retire(session, "cleanup")).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    expect(disposeMountSource).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    clearTimeout(session.timer);
  });
});
