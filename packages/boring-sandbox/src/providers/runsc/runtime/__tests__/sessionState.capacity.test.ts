import { describe, expect, test, vi } from "vitest";

import { REMOTE_WORKER_ERROR_CODES_V1 } from "../../../../shared/remoteWorkerProtocolV1";
import { trustedWorkspaceMountSource } from "../dockerArgv";
import {
  RunscSessionStateV1,
  type SessionCreateStateInputV1,
  type SessionIdentityRecordV1,
  type SessionLeaseStateV1,
} from "../sessionState";

interface RecordV1 extends SessionIdentityRecordV1 {
  retirement?: object;
}

const mount = trustedWorkspaceMountSource(
  "/srv/workspaces",
  "00000000-0000-4000-8000-000000000001",
);

function input(index: number): SessionCreateStateInputV1 {
  return {
    sandboxId: `sandbox-${index}`,
    clientLeaseId: `lease-${index}`,
    workspaceId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    workspaceMountSource: mount,
    image: "image@example",
  };
}

function allocate(
  state: RunscSessionStateV1<RecordV1>,
  createInput: SessionCreateStateInputV1,
  limit: number,
  gate: Promise<void> = Promise.resolve(),
  effects = vi.fn(),
): Promise<SessionLeaseStateV1> {
  return state.create(
    createInput,
    false,
    limit,
    limit,
    1,
    () => 0,
    () => "unused",
    async (normalized, digest) => {
      effects();
      await gate;
      const record: RecordV1 = {
        sandboxId: normalized.sandboxId,
        clientLeaseId: normalized.clientLeaseId,
        createDigest: digest,
        workspaceId: normalized.workspaceId,
        ownsWorkspaceMountSource: false,
        leaseExpiresAtMs: 2,
        hardExpiresAtMs: 3,
        timer: setTimeout(() => undefined, 60_000),
        invocations: { clear: vi.fn() },
      };
      state.bind(record);
      return state.lease(record, true);
    },
  );
}

describe("RunscSessionStateV1 owned-session capacity", () => {
  test("admits exactly the recovery ceiling and lets replay reuse its slot", async () => {
    const state = new RunscSessionStateV1<RecordV1>();
    const effects = vi.fn();
    await allocate(state, input(1), 2, Promise.resolve(), effects);
    await allocate(state, input(2), 2, Promise.resolve(), effects);

    await expect(
      allocate(state, input(1), 2, Promise.resolve(), effects),
    ).resolves.toMatchObject({
      sandboxId: "sandbox-1",
    });
    expect(() =>
      allocate(state, input(3), 2, Promise.resolve(), effects),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    expect(state.sessions.size).toBe(2);
    expect(effects).toHaveBeenCalledTimes(2);
  });

  test("counts pending reservations and joins their idempotent replay", async () => {
    const state = new RunscSessionStateV1<RecordV1>();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const effects = vi.fn();
    const pending = allocate(state, input(1), 1, gate, effects);
    const replay = allocate(state, input(1), 1, gate, effects);

    expect(() =>
      allocate(state, input(2), 1, Promise.resolve(), effects),
    ).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    expect(effects).toHaveBeenCalledTimes(1);
    release?.();
    await expect(Promise.all([pending, replay])).resolves.toHaveLength(2);
    expect(state.sessions.size).toBe(1);
  });

  test("keeps a retirement-owned record charged until detach", async () => {
    const state = new RunscSessionStateV1<RecordV1>();
    await allocate(state, input(1), 1);
    const record = state.sessions.get("sandbox-1");
    expect(record).toBeDefined();
    if (!record) return;
    record.retirement = { reason: "cleanup" };

    expect(() => allocate(state, input(2), 1)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    state.detach(record);
    await expect(allocate(state, input(2), 1)).resolves.toMatchObject({
      sandboxId: "sandbox-2",
    });
  });

  test("charges externally retained cleanup without double-counting active roots", async () => {
    const state = new RunscSessionStateV1<RecordV1>();
    let retainedCleanup = 2;
    const effects = vi.fn();
    const create = (index: number) =>
      state.create(
        input(index),
        true,
        4,
        4,
        2,
        () => retainedCleanup,
        () => `sandbox-${index}`,
        async (normalized, digest) => {
          effects();
          const record: RecordV1 = {
            sandboxId: normalized.sandboxId,
            clientLeaseId: normalized.clientLeaseId,
            createDigest: digest,
            workspaceId: normalized.workspaceId,
            ownsWorkspaceMountSource: true,
            leaseExpiresAtMs: 2,
            hardExpiresAtMs: 3,
            timer: setTimeout(() => undefined, 60_000),
            invocations: { clear: vi.fn() },
          };
          state.bind(record);
          return state.lease(record, true);
        },
      );

    await expect(create(1)).resolves.toMatchObject({ sandboxId: "sandbox-1" });
    expect(effects).toHaveBeenCalledTimes(1);
    expect(() => create(2)).toThrowError(
      expect.objectContaining({
        code: REMOTE_WORKER_ERROR_CODES_V1.createConcurrencyExhausted,
      }),
    );
    expect(effects).toHaveBeenCalledTimes(1);

    const record = state.sessions.get(
      "00000000-0000-4000-8000-000000000001\u0000sandbox-1",
    );
    expect(record).toBeDefined();
    if (!record) return;
    state.detach(record);
    retainedCleanup = 0;
    await expect(create(2)).resolves.toMatchObject({ sandboxId: "sandbox-2" });
    expect(effects).toHaveBeenCalledTimes(2);
  });
});
