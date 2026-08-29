import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { trustedWorkspaceMountSource } from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;
const createInput = {
  sandboxId: "sandbox-a",
  clientLeaseId: "lease-a",
  workspaceId,
  workspaceMountSource: trustedWorkspaceMountSource(
    "/srv/boring/workspaces",
    workspaceId,
  ),
  image,
};

function success(stdout = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new TextEncoder().encode(stdout),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function fakeRunner(): DockerCommandRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn(async (input: DockerCommandInput) => {
      if (input.argv[0] === "ps") return success("");
      if (input.argv[0] !== "exec") return success("container-id\n");
      if (input.argv.at(-1) === "workspace") {
        return success(JSON.stringify({ openat2: true }));
      }
      return success();
    }),
  };
}

function runtime(
  runner: DockerCommandRunner,
  now: () => number,
  onRetire: (value: { sandboxId: string; reason: string }) => void,
): RunscSessionRuntimeV1 {
  let id = 0;
  return new RunscSessionRuntimeV1({
    runner,
    quota: { apply: vi.fn(), check: vi.fn() },
    runtimeIdFactory: () => (++id).toString(16).padStart(32, "0"),
    now,
    onRetire,
  });
}

describe("warm runsc session retirement", () => {
  test("retains ownership and retries expiry removal after a transient failure", async () => {
    vi.useFakeTimers();
    let clock = 1_000;
    const retire = vi.fn();
    try {
      const runner = fakeRunner();
      const run = runner.run.getMockImplementation() as (
        input: DockerCommandInput,
      ) => Promise<DockerCommandResult>;
      let removeAttempts = 0;
      runner.run.mockImplementation(async (input) => {
        if (input.argv[0] === "rm" && removeAttempts++ === 0) {
          throw Object.assign(new Error("transient docker outage"), {
            code: "ECONNREFUSED",
          });
        }
        if (input.argv[0] === "ps" && removeAttempts === 1) {
          return success("container-id\n");
        }
        return await run(input);
      });
      const sessions = runtime(runner, () => clock, retire);
      await sessions.create({ ...createInput, idleTtlMs: 100 });
      clock = 1_100;
      await vi.advanceTimersByTimeAsync(100);

      await expect(sessions.renew("sandbox-a", 100)).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
      });
      await expect(
        sessions.renew("sandbox-a", workspaceId, 100),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
      });
      expect(() =>
        sessions.create({ ...createInput, idleTtlMs: 100 }),
      ).toThrowError(
        expect.objectContaining({
          code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        }),
      );
      expect(removeAttempts).toBe(1);
      expect(retire).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(removeAttempts).toBe(2);
      expect(retire).toHaveBeenCalledTimes(1);
      expect(retire).toHaveBeenCalledWith({
        sandboxId: "sandbox-a",
        reason: "idle",
      });
      await expect(sessions.renew("sandbox-a", 100)).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
      });
      await expect(
        sessions.renew("sandbox-a", workspaceId, 100),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
