import { describe, expect, test, vi } from "vitest";

import {
  createCredentialConsumerBindingRegistryV1,
  createProviderRegistryV1,
  type AuthorizedWorkspaceCredentialScopeV1,
  type CredentialConsumerBindingId,
  type CredentialFieldId,
  type ProviderId,
  type SandboxCredentialPayloadResolverV1,
} from "@hachej/boring-agent/shared";

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
import { createRunscInvocationCredentialResolverV1 } from "../invocationCredentials";
import { RunscSessionRuntimeV1 } from "../sessionRuntime";

const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;
const workspaceId = "00000000-0000-4000-8000-000000000001";
const credentialScope = {} as AuthorizedWorkspaceCredentialScopeV1;
const searchProviderId = "search-provider" as ProviderId;
const searchBindingId = "search-tool" as CredentialConsumerBindingId;
const apiKeyFieldId = "api-key" as CredentialFieldId;

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
    onRetire?: (value: {
      sandboxId: string;
      reason: string;
    }) => void | Promise<void>;
    credentialKind?: "first-party-tool" | "model-provider";
    providerCategory?: "search" | "llm";
    resolveCredential?: SandboxCredentialPayloadResolverV1["resolveForDelivery"];
    quota?: {
      apply(workspaceId: string): Promise<void>;
      check(workspaceId: string): Promise<void>;
    };
  } = {},
) {
  let id = 0;
  const providerId = searchProviderId;
  const bindingId = searchBindingId;
  const fieldId = apiKeyFieldId;
  const resolveCredential: SandboxCredentialPayloadResolverV1["resolveForDelivery"] =
    options.resolveCredential ??
    vi.fn<SandboxCredentialPayloadResolverV1["resolveForDelivery"]>(
      async (_scope, request) => ({
        payload: {
          contractVersion: "boring.sandbox-credential-secret-payload.v1",
          workspaceId: request.workspaceId,
          sandboxId: request.sandboxId,
          executionId: request.executionId,
          deliveryAttemptId: request.deliveryAttemptId,
          bindingId,
          credentialVersion: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          fields: [
            {
              fieldId,
              value: new TextEncoder().encode("planted-secret-canary"),
            },
          ],
        },
        dispose: vi.fn(),
      }),
    );
  const providers = createProviderRegistryV1([
    {
      contractVersion: "boring.provider.v1",
      id: providerId,
      displayName: "Search provider",
      category: options.providerCategory ?? "search",
      credential: {
        type: "api-key",
        fields: [
          {
            id: fieldId,
            label: "API key",
            required: true,
            sensitivity: "secret",
            maxBytes: 65_536,
          },
        ],
      },
      consumerBindingIds: [bindingId],
      sandboxEgressOrigins: [],
    },
  ]);
  const bindings = createCredentialConsumerBindingRegistryV1(
    [
      {
        contractVersion: "boring.credential-consumer-binding.v1",
        id: bindingId,
        providerId,
        consumer: {
          id: bindingId,
          kind: options.credentialKind ?? "first-party-tool",
          trust: "untrusted",
        },
        purpose: "search request",
        allowedFieldIds: [fieldId],
        delivery: "sandbox-pipe",
        sandbox: {
          credentialChannel: "fd-3",
          egressOrigins: [],
        },
      },
    ],
    providers,
  );
  return new RunscSessionRuntimeV1({
    runner,
    quota: options.quota ?? { apply: vi.fn(), check: vi.fn() },
    runtimeIdFactory: () => (++id).toString(16).padStart(32, "0"),
    now: options.now,
    onRetire: options.onRetire,
    invocationCredentials: createRunscInvocationCredentialResolverV1({
      bindings,
      providers,
      payloadResolver: {
        contractVersion: "boring.sandbox-credential-payload-resolver.v1",
        resolveForDelivery: resolveCredential,
      },
    }),
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
      credentialRefs: [
        {
          deliveryAttemptId: "delivery-a",
          ref: {
            contractVersion: "boring.provider-credential-ref.v1" as const,
            providerId: "search-provider",
            executionId: "invocation-a",
            bindingId: "search-tool",
          },
          fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
        },
      ],
    };
    await sessions.exec(
      "sandbox-a",
      workspaceId,
      request,
      undefined,
      credentialScope,
    );
    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        request,
        undefined,
        credentialScope,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.secretInvocationNotReplayable,
    });
    const calls = runner.run.mock.calls.map(
      ([input]) => input as DockerCommandInput,
    );
    expect(calls.filter((input) => input.argv[0] === "run")).toHaveLength(3);
    expect(calls.filter((input) => input.argv[0] === "rm")).toHaveLength(2);
    expect(
      calls
        .filter((input) => input.argv[0] === "run")
        .map((input) =>
          input.argv.find((value) => value.includes("dst=/workspace")),
        ),
    ).toEqual([
      expect.stringContaining("readonly=false"),
      expect.stringContaining("readonly=true"),
      expect.stringContaining("readonly=false"),
    ]);
    expect(calls.flatMap((input) => input.argv).join(" ")).not.toContain(
      "planted-secret-canary",
    );
  });

  test("retires and retries when a secret-bearing container cannot be replaced", async () => {
    vi.useFakeTimers();
    try {
      const runner = fakeRunner();
      const run = runner.run.getMockImplementation() as (
        input: DockerCommandInput,
      ) => Promise<DockerCommandResult>;
      let removeAttempts = 0;
      runner.run.mockImplementation(async (input) => {
        if (input.argv[0] === "rm") {
          removeAttempts += 1;
          if (removeAttempts >= 2 && removeAttempts <= 4) {
            return {
              ...success(),
              exitCode: 1,
              stderr: new TextEncoder().encode("transient removal failure"),
            };
          }
        }
        return await run(input);
      });
      const sessions = runtime(runner);
      await sessions.create(createInput);
      const request = {
        ...execRequest,
        credentialRefs: [
          {
            deliveryAttemptId: "delivery-a",
            ref: {
              contractVersion: "boring.provider-credential-ref.v1" as const,
              providerId: "search-provider",
              executionId: "invocation-a",
              bindingId: "search-tool",
            },
            fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
          },
        ],
      };

      await expect(
        sessions.exec(
          "sandbox-a",
          workspaceId,
          request,
          undefined,
          credentialScope,
        ),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      });
      await expect(
        sessions.exec("sandbox-a", workspaceId, {
          ...execRequest,
          invocationId: "later-invocation",
          command: "cat /tmp/planted-secret",
        }),
      ).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxDisposed,
      });
      expect(
        runner.run.mock.calls.filter(
          ([input]) =>
            input.argv[0] === "exec" && input.argv.at(-1) === "invoke",
        ),
      ).toHaveLength(1);
      expect(removeAttempts).toBe(4);

      await vi.advanceTimersByTimeAsync(100);
      expect(removeAttempts).toBe(5);
      await expect(sessions.renew("sandbox-a", 100)).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects a forged non-model reference using trusted model classification", async () => {
    const resolveCredential =
      vi.fn<SandboxCredentialPayloadResolverV1["resolveForDelivery"]>();
    const runner = fakeRunner();
    const sessions = runtime(runner, {
      credentialKind: "model-provider",
      providerCategory: "llm",
      resolveCredential,
    });
    await sessions.create(createInput);
    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        {
          ...execRequest,
          credentialRefs: [
            {
              deliveryAttemptId: "delivery-a",
              ref: {
                contractVersion: "boring.provider-credential-ref.v1",
                providerId: "search-provider",
                executionId: "invocation-a",
                bindingId: "search-tool",
              },
              fields: [{ name: "OPENAI_API_KEY", fieldId: "api-key" }],
            },
          ],
        },
        undefined,
        credentialScope,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
    });
    expect(resolveCredential).not.toHaveBeenCalled();
    expect(
      runner.run.mock.calls.filter(
        ([input]) => input.argv[0] === "exec" && input.argv.at(-1) === "invoke",
      ),
    ).toHaveLength(0);
  });

  test("rejects more than the credential contract aggregate field limit", async () => {
    const resolveCredential =
      vi.fn<SandboxCredentialPayloadResolverV1["resolveForDelivery"]>();
    const runner = fakeRunner();
    const sessions = runtime(runner, { resolveCredential });
    await sessions.create(createInput);
    const references = ["a", "b"].map((suffix) => ({
      deliveryAttemptId: `delivery-${suffix}`,
      ref: {
        contractVersion: "boring.provider-credential-ref.v1" as const,
        providerId: "search-provider",
        executionId: "invocation-a",
        bindingId: searchBindingId,
      },
      fields: Array.from({ length: 9 }, (_, index) => ({
        name: `TOOL_CREDENTIAL_${suffix.toUpperCase()}_${index}`,
        fieldId: "api-key",
      })),
    }));

    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        { ...execRequest, credentialRefs: references },
        undefined,
        credentialScope,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
    });
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  test("disposes and rejects a payload over the aggregate secret byte limit", async () => {
    const dispose = vi.fn();
    const resolveCredential = vi.fn<
      SandboxCredentialPayloadResolverV1["resolveForDelivery"]
    >(async (_scope, request) => ({
      payload: {
        contractVersion: "boring.sandbox-credential-secret-payload.v1",
        workspaceId: request.workspaceId,
        sandboxId: request.sandboxId,
        executionId: request.executionId,
        deliveryAttemptId: request.deliveryAttemptId,
        bindingId: searchBindingId,
        credentialVersion: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        fields: [
          {
            fieldId: apiKeyFieldId,
            value: new Uint8Array(65_537),
          },
        ],
      },
      dispose,
    }));
    const runner = fakeRunner();
    const sessions = runtime(runner, { resolveCredential });
    await sessions.create(createInput);

    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        {
          ...execRequest,
          credentialRefs: [
            {
              deliveryAttemptId: "delivery-a",
              ref: {
                contractVersion: "boring.provider-credential-ref.v1",
                providerId: "search-provider",
                executionId: "invocation-a",
                bindingId: "search-tool",
              },
              fields: [{ name: "TOOL_CREDENTIAL", fieldId: "api-key" }],
            },
          ],
        },
        undefined,
        credentialScope,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.secretReferenceRejected,
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(
      runner.run.mock.calls.filter(
        ([input]) => input.argv[0] === "exec" && input.argv.at(-1) === "invoke",
      ),
    ).toHaveLength(0);
  });

  test.each([
    {
      label: "ordinary env model key",
      request: {
        ...execRequest,
        env: { OPENAI_API_KEY: "sk-model-key" },
      },
    },
    {
      label: "forged-kind raw model key",
      request: {
        ...execRequest,
        secretEnv: [
          {
            name: "OPENAI_API_KEY",
            value: "sk-model-key",
            reference: { kind: "sandbox-invocation-secret" },
          },
        ],
      },
    },
  ])("rejects $label before Docker exec", async ({ request }) => {
    const runner = fakeRunner();
    const sessions = runtime(runner);
    await sessions.create(createInput);
    await expect(
      sessions.exec(
        "sandbox-a",
        workspaceId,
        request as unknown as RemoteWorkerExecRequestV1,
      ),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.requestInvalid,
    });
    expect(
      runner.run.mock.calls.filter(
        ([input]) => input.argv[0] === "exec" && input.argv.at(-1) === "invoke",
      ),
    ).toHaveLength(0);
  });

  test("returns timeout only when the wrapper proves process-group cleanup", async () => {
    const runner = fakeRunner(() =>
      helperResult({ timedOut: true, exitCode: 124 }),
    );
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
      await expect(sessions.renew("sandbox-a", 100)).rejects.toMatchObject({
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
        return await run(input);
      });
      const sessions = runtime(runner, {
        now: () => clock,
        onRetire: retire,
      });
      await sessions.create({ ...createInput, idleTtlMs: 100 });
      clock = 1_100;
      await vi.advanceTimersByTimeAsync(100);

      await expect(sessions.renew("sandbox-a", 100)).rejects.toMatchObject({
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
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(["nonzero", "throw"] as const)(
    "retains failed-create ownership when docker rm returns %s",
    async (failureMode) => {
      vi.useFakeTimers();
      try {
        const runner = fakeRunner();
        const run = runner.run.getMockImplementation() as (
          input: DockerCommandInput,
        ) => Promise<DockerCommandResult>;
        let removeAttempts = 0;
        runner.run.mockImplementation(async (input) => {
          if (input.argv[0] === "exec" && input.argv.at(-1) === "workspace") {
            const request = JSON.parse(new TextDecoder().decode(input.stdin));
            if (request.op === "probe") {
              return {
                ...success(),
                exitCode: 1,
                stderr: new TextEncoder().encode("probe failed"),
              };
            }
          }
          if (input.argv[0] === "rm") {
            removeAttempts += 1;
            if (removeAttempts === 1) {
              if (failureMode === "throw") {
                throw new Error("docker transport unavailable");
              }
              return {
                ...success(),
                exitCode: 1,
                stderr: new TextEncoder().encode("remove failed"),
              };
            }
          }
          return await run(input);
        });
        const sessions = runtime(runner);

        await expect(sessions.create(createInput)).rejects.toMatchObject({
          code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        });
        expect(() => sessions.create(createInput)).toThrowError(
          expect.objectContaining({
            code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
          }),
        );
        expect(removeAttempts).toBe(1);

        await vi.advanceTimersByTimeAsync(100);
        expect(removeAttempts).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test("shutdown schedules every retirement before surfacing a removal failure", async () => {
    vi.useFakeTimers();
    try {
      const onRetire = vi.fn();
      const runner = fakeRunner();
      const run = runner.run.getMockImplementation() as (
        input: DockerCommandInput,
      ) => Promise<DockerCommandResult>;
      let removeAttempts = 0;
      runner.run.mockImplementation(async (input) => {
        if (input.argv[0] === "rm") {
          removeAttempts += 1;
          if (removeAttempts === 1) {
            throw new Error("transient docker outage");
          }
        }
        return await run(input);
      });
      const sessions = runtime(runner, { onRetire });
      await sessions.create(createInput);
      const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";
      await sessions.create({
        ...createInput,
        sandboxId: "sandbox-b",
        clientLeaseId: "lease-b",
        workspaceId: secondWorkspaceId,
        workspaceMountSource: trustedWorkspaceMountSource(
          "/srv/boring/workspaces",
          secondWorkspaceId,
        ),
      });

      await expect(sessions.shutdown()).rejects.toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
      });
      expect(removeAttempts).toBe(2);
      expect(onRetire).toHaveBeenCalledTimes(1);
      expect(onRetire).toHaveBeenCalledWith({
        sandboxId: "sandbox-b",
        reason: "shutdown",
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(removeAttempts).toBe(3);
      expect(onRetire).toHaveBeenCalledTimes(2);
      expect(onRetire).toHaveBeenCalledWith({
        sandboxId: "sandbox-a",
        reason: "shutdown",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(["expired", "missing"] as const)(
    "sanitizes a throwing retirement callback for a %s sandbox",
    async (scenario) => {
      let clock = 1_000;
      const raw =
        "unlink /srv/private/workspace: TOKEN=super-secret-host-value";
      const sessions = runtime(fakeRunner(), {
        now: () => clock,
        onRetire: async () => {
          throw new Error(raw);
        },
      });
      if (scenario === "expired") {
        await sessions.create({ ...createInput, idleTtlMs: 100 });
        clock = 1_100;
      }
      let failure: unknown;
      try {
        await sessions.renew(
          scenario === "expired" ? "sandbox-a" : "sandbox-missing",
          100,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: REMOTE_WORKER_ERROR_CODES_V1.incompleteCleanup,
        message: "remote-worker retirement notification failed",
      });
      expect(JSON.stringify(failure)).not.toContain(raw);
      expect(JSON.stringify(failure)).not.toContain("super-secret-host-value");
    },
  );

  test("does not let a missing notification suppress cleanup of a reused sandbox id", async () => {
    let releaseMissing: (() => void) | undefined;
    const missingPending = new Promise<void>((resolve) => {
      releaseMissing = resolve;
    });
    const onRetire = vi.fn(
      async (retirement: { sandboxId: string; reason: string }) => {
        if (retirement.reason === "missing") await missingPending;
      },
    );
    const runner = fakeRunner();
    const sessions = runtime(runner, { onRetire });

    const missing = sessions.renew("sandbox-a", 100);
    await vi.waitFor(() =>
      expect(onRetire).toHaveBeenCalledWith({
        sandboxId: "sandbox-a",
        reason: "missing",
      }),
    );
    await sessions.create(createInput);
    await sessions.dispose("sandbox-a");

    expect(
      runner.run.mock.calls.filter(([input]) => input.argv[0] === "rm"),
    ).toHaveLength(1);
    expect(onRetire).toHaveBeenCalledTimes(1);

    releaseMissing?.();
    await expect(missing).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
    });
  });

  test("bounded startup sweep removes only owned container ids", async () => {
    const runner = fakeRunner();
    runner.run.mockImplementationOnce(async () =>
      success("a".repeat(64) + "\n"),
    );
    await runtime(runner).startupSweep();
    expect(runner.run.mock.calls[1]?.[0].argv).toEqual([
      "rm",
      "--force",
      "a".repeat(64),
    ]);
  });

  test("serializes quota application against every session for one workspace", async () => {
    let releaseApply: (() => void) | undefined;
    const apply = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          releaseApply = resolve;
        }),
    );
    const runner = fakeRunner();
    const sessions = runtime(runner, {
      quota: { apply, check: vi.fn(async () => undefined) },
    });
    const first = sessions.create(createInput);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(() =>
      sessions.create({
        ...createInput,
        sandboxId: "sandbox-b",
        clientLeaseId: "lease-b",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
    releaseApply?.();
    await first;
    expect(() =>
      sessions.create({
        ...createInput,
        sandboxId: "sandbox-c",
        clientLeaseId: "lease-c",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
      }),
    );
    expect(apply).toHaveBeenCalledOnce();
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
