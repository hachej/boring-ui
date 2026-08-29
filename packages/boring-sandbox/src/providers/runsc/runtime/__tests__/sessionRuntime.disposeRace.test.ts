import { describe, expect, test, vi } from "vitest";

import type { AuthorizedWorkspaceCredentialScopeV1 } from "@hachej/boring-agent/shared";

import {
  REMOTE_WORKER_ERROR_CODES_V1,
  type RemoteWorkerExecRequestV1,
} from "../../../../shared/remoteWorkerProtocolV1";
import { trustedWorkspaceMountSource } from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import type { RunscInvocationCredentialResolverV1 } from "../invocationCredentials";
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
const execRequest: RemoteWorkerExecRequestV1 = {
  invocationId: "invocation-a",
  command: "printf ok",
  timeoutMs: 30_000,
  maxOutputBytes: 1024,
};
const secretRequest: RemoteWorkerExecRequestV1 = {
  ...execRequest,
  credentialRefs: [
    {
      deliveryAttemptId: "delivery-a",
      ref: {
        contractVersion: "boring.provider-credential-ref.v1",
        providerId: "provider-a",
        executionId: "invocation-a",
        bindingId: "tool-a",
      },
      fields: [{ name: "TOOL_API_KEY", fieldId: "api-key" }],
    },
  ],
};

function secretFieldsWithoutLeases(): RunscInvocationCredentialResolverV1 {
  return {
    contractVersion: "boring.runsc-invocation-credential-resolver.v1",
    resolve: vi.fn(async () => ({
      fields: [
        {
          bindingId: "tool-a",
          fieldId: "api-key",
          name: "TOOL_API_KEY",
          value: new TextEncoder().encode("secret"),
        },
      ],
      leases: [],
    })),
  };
}

function success(stdout: unknown = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: new TextEncoder().encode(
      typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    ),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function helperResult(cleanupProven = true) {
  return {
    ok: true,
    stdoutBase64: Buffer.from("ok").toString("base64"),
    stderrBase64: "",
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    timedOut: false,
    cleanupProven,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function testRuntime(
  runner: DockerCommandRunner,
  invocationCredentials?: RunscInvocationCredentialResolverV1,
): RunscSessionRuntimeV1 {
  let id = 0;
  return new RunscSessionRuntimeV1({
    runner,
    quota: { apply: vi.fn(), check: vi.fn() },
    runtimeIdFactory: () => (++id).toString(16).padStart(32, "0"),
    invocationCredentials,
  });
}

function commandMode(input: DockerCommandInput): string {
  return input.argv[0] === "exec" ? (input.argv.at(-1) ?? "") : input.argv[0];
}

async function waitForCall(
  run: ReturnType<typeof vi.fn>,
  predicate: (input: DockerCommandInput) => boolean,
): Promise<void> {
  await vi.waitFor(() => {
    expect(
      run.mock.calls.some(([input]) => predicate(input as DockerCommandInput)),
    ).toBe(true);
  });
}

describe("runsc explicit-dispose operation ownership", () => {
  test("does not start an ordinary recovery replacement after dispose owns a delayed remove", async () => {
    const remove = deferred<DockerCommandResult>();
    let removeCalls = 0;
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        if (mode === "ps") return success("");
        if (mode === "workspace") return success({ openat2: true });
        if (mode === "invoke") return success(helperResult(false));
        if (mode === "rm" && ++removeCalls === 1) return await remove.promise;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner);
    await sessions.create(createInput);

    const execution = sessions.exec("sandbox-a", workspaceId, execRequest);
    await waitForCall(
      runner.run,
      (input) => commandMode(input) === "rm" && removeCalls === 1,
    );
    const disposal = sessions.dispose("sandbox-a", workspaceId);
    remove.resolve(success());

    await expect(execution).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    await disposal;
    expect(
      runner.run.mock.calls.filter(
        ([input]) => commandMode(input as DockerCommandInput) === "run",
      ),
    ).toHaveLength(1);
    await sessions.dispose("sandbox-a", workspaceId);
  });

  test("does not publish a delayed secret replacement start after disposal", async () => {
    const replacementStart = deferred<DockerCommandResult>();
    let runCalls = 0;
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        if (mode === "ps") return success("");
        if (mode === "workspace") return success({ openat2: true });
        if (mode === "invoke") return success(helperResult());
        if (mode === "run" && ++runCalls === 2)
          return await replacementStart.promise;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner, secretFieldsWithoutLeases());
    await sessions.create(createInput);

    const execution = sessions.exec(
      "sandbox-a",
      workspaceId,
      secretRequest,
      undefined,
      {} as AuthorizedWorkspaceCredentialScopeV1,
    );
    await vi.waitFor(() => expect(runCalls).toBe(2));
    const disposal = sessions.dispose("sandbox-a", workspaceId);
    replacementStart.resolve(success("container-id\n"));

    await expect(execution).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });
    await disposal;
    expect(runCalls).toBe(2);
    expect(
      runner.run.mock.calls.filter(
        ([input]) => commandMode(input as DockerCommandInput) === "workspace",
      ),
    ).toHaveLength(1);
  });

  test("replaces a timed-out secret container when resolved fields have no lease handles", async () => {
    let runCalls = 0;
    let removeCalls = 0;
    const modes: string[] = [];
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        modes.push(mode);
        if (mode === "ps") return success("");
        if (mode === "workspace") {
          const request = JSON.parse(new TextDecoder().decode(input.stdin));
          return success(request.op === "probe" ? { openat2: true } : { ok: true });
        }
        if (mode === "invoke") {
          return success({ ...helperResult(), timedOut: true, exitCode: 124 });
        }
        if (mode === "run") runCalls += 1;
        if (mode === "rm") removeCalls += 1;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner, secretFieldsWithoutLeases());
    await sessions.create(createInput);

    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        secretRequest,
        undefined,
        {} as AuthorizedWorkspaceCredentialScopeV1,
      ),
    ).rejects.toMatchObject({ code: REMOTE_WORKER_ERROR_CODES_V1.timeout });

    expect(runCalls).toBe(3);
    expect(removeCalls).toBe(2);
    expect(modes).toEqual([
      "run",
      "workspace",
      "rm",
      "run",
      "workspace",
      "invoke",
      "rm",
      "run",
      "workspace",
    ]);
    await expect(
      sessions.fs("sandbox-a", workspaceId, {
        op: "mkdir",
        path: "after-secret-replacement",
        recursive: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(modes.at(-1)).toBe("workspace");
    await sessions.dispose("sandbox-a", workspaceId);
  });

  test("retires a timed-out secret container when clean replacement fails", async () => {
    let runCalls = 0;
    let removeCalls = 0;
    let workspaceCalls = 0;
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        if (mode === "ps") return success("");
        if (mode === "workspace") {
          workspaceCalls += 1;
          return success({ openat2: true });
        }
        if (mode === "invoke") {
          return success({ ...helperResult(), timedOut: true, exitCode: 124 });
        }
        if (mode === "run" && ++runCalls === 3) {
          return { ...success(), exitCode: 1 };
        }
        if (mode === "rm") removeCalls += 1;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner, secretFieldsWithoutLeases());
    await sessions.create(createInput);

    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        secretRequest,
        undefined,
        {} as AuthorizedWorkspaceCredentialScopeV1,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
    });

    expect(runCalls).toBe(3);
    expect(removeCalls).toBe(3);
    expect(workspaceCalls).toBe(2);
    await expect(
      sessions.fs("sandbox-a", workspaceId, {
        op: "mkdir",
        path: "must-not-run",
        recursive: true,
      }),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
    });
    expect(workspaceCalls).toBe(2);
  });

  test("does not start abort recovery after dispose marks an in-flight invocation", async () => {
    const invocation = deferred<DockerCommandResult>();
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        if (mode === "ps") return success("");
        if (mode === "workspace") return success({ openat2: true });
        if (mode === "invoke") return await invocation.promise;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner);
    await sessions.create(createInput);
    const controller = new AbortController();
    const execution = sessions.exec(
      "sandbox-a",
      workspaceId,
      execRequest,
      controller.signal,
    );
    await waitForCall(runner.run, (input) => commandMode(input) === "invoke");
    controller.abort();
    const disposal = sessions.dispose("sandbox-a", workspaceId);
    invocation.reject(new Error("aborted invocation transport"));

    await expect(execution).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.execAborted,
    });
    await disposal;
    expect(
      runner.run.mock.calls.filter(
        ([input]) => commandMode(input as DockerCommandInput) === "run",
      ),
    ).toHaveLength(1);
  });

  test("joins concurrent disposal and never binds or starts after disposal succeeds", async () => {
    const removal = deferred<DockerCommandResult>();
    let removeCalls = 0;
    const runner = {
      run: vi.fn(async (input: DockerCommandInput) => {
        const mode = commandMode(input);
        if (mode === "ps") return success("");
        if (mode === "workspace") return success({ openat2: true });
        if (mode === "rm" && ++removeCalls === 1) return await removal.promise;
        return success("container-id\n");
      }),
    } satisfies DockerCommandRunner & { run: ReturnType<typeof vi.fn> };
    const sessions = testRuntime(runner);
    await sessions.create(createInput);

    const first = sessions.dispose("sandbox-a", workspaceId);
    const second = sessions.dispose("sandbox-a", workspaceId);
    await waitForCall(runner.run, (input) => commandMode(input) === "rm");
    removal.resolve(success());
    await Promise.all([first, second]);

    expect(removeCalls).toBe(1);
    await expect(
      sessions.exec("sandbox-a", workspaceId, execRequest),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
    });
    expect(
      runner.run.mock.calls.filter(
        ([input]) => commandMode(input as DockerCommandInput) === "run",
      ),
    ).toHaveLength(1);
  });
});
