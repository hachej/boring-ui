import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import {
  trustedWorkspaceMountSource,
  type TrustedWorkspaceMountSource,
} from "../dockerArgv";
import type {
  DockerCommandInput,
  DockerCommandResult,
  DockerCommandRunner,
} from "../dockerRunner";
import {
  RunscSessionRuntimeV1,
  type CreateRunscSessionInputV1,
  type RunscSessionLeaseV1,
  type RunscSessionRuntimeOptionsV1,
  type RunscSessionRetirementV1,
} from "../sessionRuntime";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const image = `registry.example/boring-workload@sha256:${"b".repeat(64)}`;
const createInput: CreateRunscSessionInputV1 = {
  sandboxId: "sandbox-a",
  clientLeaseId: "lease-a",
  workspaceId,
  workspaceMountSource: trustedWorkspaceMountSource(
    "/srv/boring/workspaces",
    workspaceId,
  ),
  image,
};

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type LegacyInput = {
  readonly sandboxId: string;
  readonly clientLeaseId: string;
  readonly workspaceId: string;
  readonly workspaceMountSource: TrustedWorkspaceMountSource;
  readonly image: string;
  readonly idleTtlMs?: number;
  readonly hardLifetimeMs?: number;
};
type LegacyLease = {
  readonly sandboxId: string;
  readonly leaseExpiresAtMs: number;
  readonly hardExpiresAtMs: number;
};
type LegacyRetirement = {
  readonly sandboxId: string;
  readonly reason: "idle" | "hard-expiry" | "missing" | "cleanup" | "history" | "shutdown";
};
const inputShape: Assert<Equal<CreateRunscSessionInputV1, LegacyInput>> = true;
const leaseShape: Assert<Equal<RunscSessionLeaseV1, LegacyLease>> = true;
const retirementShape: Assert<Equal<RunscSessionRetirementV1, LegacyRetirement>> = true;
const callbackShape: NonNullable<RunscSessionRuntimeOptionsV1["onRetire"]> =
  async (_value: LegacyRetirement) => undefined;
void inputShape;
void leaseShape;
void retirementShape;
void callbackShape;

function result(stdout: unknown = ""): DockerCommandResult {
  return {
    exitCode: 0,
    stdout: typeof stdout === "string"
      ? new TextEncoder().encode(stdout)
      : new TextEncoder().encode(JSON.stringify(stdout)),
    stderr: new Uint8Array(),
    timedOut: false,
    truncated: false,
  };
}

function runner(): DockerCommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (input: DockerCommandInput) => {
      if (input.argv[0] === "ps") return result("");
      if (input.argv[0] === "exec") {
        return result({ openat2: true, ok: true });
      }
      return result("container-id\n");
    }),
  };
}

function runtime(
  docker: DockerCommandRunner,
  options: Pick<RunscSessionRuntimeOptionsV1, "onRetire"> = {},
) {
  let id = 0;
  return new RunscSessionRuntimeV1({
    runner: docker,
    quota: { apply: vi.fn(), check: vi.fn() },
    runtimeIdFactory: () => (++id).toString(16).padStart(32, "0"),
    ...options,
  });
}

describe("runsc legacy runtime compatibility", () => {
  test("emits exact legacy lease and retirement payloads", async () => {
    const onRetire = vi.fn();
    const sessions = runtime(runner(), { onRetire });
    const lease = await sessions.create(createInput);
    expect(lease).toEqual({
      sandboxId: "sandbox-a",
      leaseExpiresAtMs: expect.any(Number),
      hardExpiresAtMs: expect.any(Number),
    });
    expect(Object.keys(lease).sort()).toEqual([
      "hardExpiresAtMs",
      "leaseExpiresAtMs",
      "sandboxId",
    ]);
    await sessions.dispose("sandbox-a");
    expect(onRetire).not.toHaveBeenCalled();

    await expect(
      sessions.renew("sandbox-missing", 100),
    ).rejects.toMatchObject({
      code: REMOTE_WORKER_ERROR_CODES_V1.sandboxNotFound,
    });
    expect(onRetire).toHaveBeenCalledWith({
      sandboxId: "sandbox-missing",
      reason: "missing",
    });
  });

  test("canonicalizes sequential and concurrent accepted workspace aliases", async () => {
    const alias = workspaceId.toUpperCase();
    const sequential = runtime(runner());
    const first = await sequential.create(createInput);
    await expect(
      sequential.create({ ...createInput, workspaceId: alias }),
    ).resolves.toEqual(first);
    expect(() => sequential.create({
      ...createInput,
      sandboxId: "sandbox-alias",
      clientLeaseId: "lease-alias",
      workspaceId: alias,
    })).toThrowError(expect.objectContaining({
      code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
    }));

    let releaseRun: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { releaseRun = resolve; });
    const docker = runner();
    const run = docker.run.getMockImplementation() as (
      input: DockerCommandInput,
    ) => Promise<DockerCommandResult>;
    docker.run.mockImplementation(async (input) => {
      if (input.argv[0] === "run") await blocked;
      return await run(input);
    });
    const concurrent = runtime(docker);
    const lower = concurrent.create(createInput);
    await vi.waitFor(() => expect(docker.run).toHaveBeenCalled());
    const replay = concurrent.create({ ...createInput, workspaceId: alias });
    expect(() => concurrent.create({
      ...createInput,
      sandboxId: "sandbox-alias",
      clientLeaseId: "lease-alias",
      workspaceId: alias,
    })).toThrowError(expect.objectContaining({
      code: REMOTE_WORKER_ERROR_CODES_V1.idempotencyConflict,
    }));
    releaseRun?.();
    const concurrentLeases = await Promise.all([lower, replay]);
    expect(concurrentLeases[1]).toEqual(concurrentLeases[0]);
    expect(
      docker.run.mock.calls.filter(([input]) => input.argv[0] === "run"),
    ).toHaveLength(1);
  });
});
