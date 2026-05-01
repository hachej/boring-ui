import { describe, it, expect, vi } from "vitest";
import { createInMemoryBridge } from "../createInMemoryBridge";
import type { UiCommand } from "../../../shared/ui-bridge";

describe("createInMemoryBridge", () => {
  it("getState returns null initially", async () => {
    const bridge = createInMemoryBridge();
    expect(await bridge.getState()).toBeNull();
  });

  it("setState + getState roundtrip", async () => {
    const bridge = createInMemoryBridge();
    const state = { openFiles: ["a.ts"], theme: "dark" };
    await bridge.setState(state);
    expect(await bridge.getState()).toEqual(state);
  });

  it("setState overwrites previous state", async () => {
    const bridge = createInMemoryBridge();
    await bridge.setState({ v: 1 });
    await bridge.setState({ v: 2 });
    expect(await bridge.getState()).toEqual({ v: 2 });
  });

  it("postCommand returns monotonically increasing seq", async () => {
    const bridge = createInMemoryBridge();
    const cmd: UiCommand = { kind: "openFile", params: { path: "/a.ts" } };
    const r1 = await bridge.postCommand(cmd);
    const r2 = await bridge.postCommand(cmd);
    const r3 = await bridge.postCommand(cmd);
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
    expect(r3.seq).toBe(3);
    expect(r1.status).toBe("ok");
  });

  it("subscribers receive commands in order", async () => {
    const bridge = createInMemoryBridge();
    const received: Array<UiCommand & { seq: number }> = [];
    bridge.subscribeCommands((cmd) => received.push(cmd));

    await bridge.postCommand({ kind: "openFile", params: { path: "/a.ts" } });
    await bridge.postCommand({
      kind: "showNotification",
      params: { msg: "hello" },
    });

    expect(received).toHaveLength(2);
    expect(received[0].kind).toBe("openFile");
    expect(received[0].seq).toBe(1);
    expect(received[1].kind).toBe("showNotification");
    expect(received[1].seq).toBe(2);
  });

  it("multiple subscribers all receive each command", async () => {
    const bridge = createInMemoryBridge();
    const r1: number[] = [];
    const r2: number[] = [];
    bridge.subscribeCommands((cmd) => r1.push(cmd.seq));
    bridge.subscribeCommands((cmd) => r2.push(cmd.seq));

    await bridge.postCommand({ kind: "openFile", params: { path: "/b.ts" } });

    expect(r1).toEqual([1]);
    expect(r2).toEqual([1]);
  });

  it("unsubscribe stops delivery", async () => {
    const bridge = createInMemoryBridge();
    const received: number[] = [];
    const unsub = bridge.subscribeCommands((cmd) => received.push(cmd.seq));

    await bridge.postCommand({ kind: "openFile", params: { path: "/a.ts" } });
    unsub();
    await bridge.postCommand({ kind: "openFile", params: { path: "/b.ts" } });

    expect(received).toEqual([1]);
  });

  it("unsubscribe is idempotent", async () => {
    const bridge = createInMemoryBridge();
    const unsub = bridge.subscribeCommands(() => {});
    unsub();
    unsub();
  });

  it("no commands delivered before subscription", async () => {
    const bridge = createInMemoryBridge();
    await bridge.postCommand({ kind: "openFile", params: { path: "/a.ts" } });

    const received: number[] = [];
    bridge.subscribeCommands((cmd) => received.push(cmd.seq));

    await bridge.postCommand({ kind: "openFile", params: { path: "/b.ts" } });
    expect(received).toEqual([2]);
  });

  it("drainCommands returns queued commands in order", async () => {
    const bridge = createInMemoryBridge();
    await bridge.postCommand({ kind: "openFile", params: { path: "/a.ts" } });
    await bridge.postCommand({
      kind: "showNotification",
      params: { msg: "hello" },
    });

    const drained = await bridge.drainCommands?.();
    expect(drained).toEqual([
      { kind: "openFile", params: { path: "/a.ts" }, seq: 1 },
      { kind: "showNotification", params: { msg: "hello" }, seq: 2 },
    ]);
  });

  it("does not replay commands already delivered to live subscribers", async () => {
    const bridge = createInMemoryBridge();
    const received: Array<UiCommand & { seq: number }> = [];
    bridge.subscribeCommands((cmd) => received.push(cmd));

    await bridge.postCommand({ kind: "openFile", params: { path: "/live.ts" } });

    expect(received).toEqual([
      { kind: "openFile", params: { path: "/live.ts" }, seq: 1 },
    ]);
    expect(await bridge.drainCommands?.()).toEqual([]);
  });

  it("queues commands again after the last live subscriber disconnects", async () => {
    const bridge = createInMemoryBridge();
    const unsub = bridge.subscribeCommands(() => {});
    await bridge.postCommand({ kind: "openFile", params: { path: "/live.ts" } });
    unsub();

    await bridge.postCommand({ kind: "openFile", params: { path: "/queued.ts" } });

    expect(await bridge.drainCommands?.()).toEqual([
      { kind: "openFile", params: { path: "/queued.ts" }, seq: 2 },
    ]);
  });

  it("drainCommands empties queue after read", async () => {
    const bridge = createInMemoryBridge();
    await bridge.postCommand({ kind: "openFile", params: { path: "/a.ts" } });

    const firstDrain = await bridge.drainCommands?.();
    const secondDrain = await bridge.drainCommands?.();

    expect(firstDrain).toHaveLength(1);
    expect(secondDrain).toEqual([]);
  });

  it("drain queue is bounded to the most recent 1000 commands", async () => {
    const bridge = createInMemoryBridge();
    for (let i = 0; i < 1_005; i++) {
      await bridge.postCommand({
        kind: "openFile",
        params: { path: `/f-${i}.ts` },
      });
    }

    const drained = await bridge.drainCommands?.();
    expect(drained).toHaveLength(1_000);
    expect(drained?.[0].seq).toBe(6);
    expect(drained?.at(-1)?.seq).toBe(1_005);
  });

  it("independent bridges have separate seq counters", async () => {
    const b1 = createInMemoryBridge();
    const b2 = createInMemoryBridge();

    const r1 = await b1.postCommand({
      kind: "openFile",
      params: { path: "/a.ts" },
    });
    const r2 = await b2.postCommand({
      kind: "openFile",
      params: { path: "/b.ts" },
    });

    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(1);
  });
});
