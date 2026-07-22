import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { trustedWorkspaceMountSource } from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";

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

function helperResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    stdoutBase64: Buffer.from("ok").toString("base64"),
    stderrBase64: "",
    exitCode: 0,
    durationMs: 5,
    truncated: false,
    timedOut: false,
    cleanupProven: true,
    ...overrides,
  };
}

function fakeRunner(
  invokeResponse: () => unknown = () => helperResult(),
): DockerCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (input: DockerCommandInput) => {
      if (input.argv[0] === "ps") return success("");
      if (input.argv[0] !== "exec") return success("container-id\n");
      const mode = input.argv.at(-1);
      if (mode === "workspace") {
        const request = JSON.parse(new TextDecoder().decode(input.stdin));
        return request.op === "probe"
          ? success({ openat2: true })
          : success({ ok: true });
      }
      return success(invokeResponse());
    }),
  };
}

function runtime(
  runner: DockerCommandRunner,
  options: {
    now?: () => number;
    onRetire?: (value: { sandboxId: string; reason: string }) => void;
  } = {},
) {
  let id = 0;
  return new RunscSessionRuntimeV1({
    runner,
    quota: { apply: vi.fn(), check: vi.fn() },
    runtimeIdFactory: () => (++id).toString(16).padStart(32, "0"),
    now: options.now,
    onRetire: options.onRetire,
  });
}

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

const execRequest = {
  invocationId: "invocation-a",
  command: "printf ok",
  timeoutMs: 30_000,
  maxOutputBytes: 1024,
};

describe("warm runsc session runtime", () => {
  test("creates once, reuses one container, and replays only non-secret output", async () => {
    const runner = fakeRunner();
    const sessions = runtime(runner);
    const first = await sessions.create(createInput);
    const second = await sessions.create(createInput);
    expect(second).toEqual(first);
    const one = await sessions.exec("sandbox-a", workspaceId, execRequest);
    const replay = await sessions.exec("sandbox-a", workspaceId, execRequest);
    expect(replay).toEqual(one);
    expect(
      runner.run.mock.calls.filter(([input]) => input.argv[0] === "run"),
    ).toHaveLength(1);
    expect(
      runner.run.mock.calls.filter(
        ([input]) => input.argv[0] === "exec" && input.argv.at(-1) === "invoke",
      ),
    ).toHaveLength(1);
  });

  test("uses clean containers around a secret and stores only a terminal marker", async () => {
    const runner = fakeRunner();
    const sessions = runtime(runner);
    await sessions.create(createInput);
    const request = {
      ...execRequest,
      secretEnv: [
        {
          name: "TOOL_CREDENTIAL",
          value: "planted-secret-canary",
          reference: {
            contractVersion: "boring.invocation-secret-reference.v1" as const,
            kind: "sandbox-invocation-secret" as const,
            referenceId: "reference-a",
            workspaceId,
            purpose: "tool request",
            sensitivity: "secret" as const,
          },
        },
      ],
    };
    await sessions.exec("sandbox-a", workspaceId, request);
    await expect(
      sessions.exec("sandbox-a", workspaceId, request),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.secretInvocationNotReplayable,
    });
    const calls = runner.run.mock.calls.map(([input]) => input as DockerCommandInput);
    expect(calls.filter((input) => input.argv[0] === "run")).toHaveLength(3);
    expect(calls.filter((input) => input.argv[0] === "rm")).toHaveLength(2);
    expect(calls.flatMap((input) => input.argv).join(" ")).not.toContain(
      "planted-secret-canary",
    );
  });

  test("returns timeout only when the wrapper proves process-group cleanup", async () => {
    const runner = fakeRunner(() => helperResult({ timedOut: true, exitCode: 124 }));
    const sessions = runtime(runner);
    await sessions.create(createInput);
    await expect(
      sessions.exec("sandbox-a", workspaceId, execRequest),
    ).rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.timeout });
    expect(
      runner.run.mock.calls.filter(([input]) => input.argv[0] === "run"),
    ).toHaveLength(1);
  });

  test("destroys and replaces the container when cleanup is uncertain", async () => {
    const runner = fakeRunner(() => helperResult({ cleanupProven: false }));
    const sessions = runtime(runner);
    await sessions.create(createInput);
    await expect(
      sessions.exec("sandbox-a", workspaceId, execRequest),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    expect(
      runner.run.mock.calls.filter(([input]) => input.argv[0] === "rm"),
    ).toHaveLength(1);
    expect(
      runner.run.mock.calls.filter(([input]) => input.argv[0] === "run"),
    ).toHaveLength(2);
  });

  test("retires expiry single-flight and never side-door recreates", async () => {
    vi.useFakeTimers();
    let clock = 1_000;
    const retire = vi.fn();
    try {
      const runner = fakeRunner();
      const sessions = runtime(runner, { now: () => clock, onRetire: retire });
      await sessions.create({ ...createInput, idleTtlMs: 100 });
      clock = 1_100;
      await vi.advanceTimersByTimeAsync(100);
      await expect(
        sessions.renew("sandbox-a", 100),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
      });
      expect(retire).toHaveBeenCalledWith({
        sandboxId: "sandbox-a",
        reason: "idle",
      });
      expect(
        runner.run.mock.calls.filter(([input]) => input.argv[0] === "run"),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("bounded startup sweep removes only owned container ids", async () => {
    const runner = fakeRunner();
    runner.run.mockImplementationOnce(async () => success("a".repeat(64) + "\n"));
    await runtime(runner).startupSweep();
    expect(runner.run.mock.calls[1]?.[0].argv).toEqual([
      "rm",
      "--force",
      "a".repeat(64),
    ]);
  });

  test("retires instead of dropping invocation replay markers at its bound", async () => {
    const retire = vi.fn();
    const runner = fakeRunner();
    const sessions = runtime(runner, { onRetire: retire });
    await sessions.create(createInput);
    for (let index = 0; index < 256; index += 1) {
      await sessions.exec("sandbox-a", workspaceId, {
        ...execRequest,
        invocationId: `invocation-${index}`,
      });
    }
    await expect(
      sessions.exec("sandbox-a", workspaceId, {
        ...execRequest,
        invocationId: "invocation-overflow",
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxExpired,
    });
    expect(retire).toHaveBeenCalledWith({
      sandboxId: "sandbox-a",
      reason: "history",
    });
  });
});
