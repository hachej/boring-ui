import { describe, it, expect } from "vitest";
import { createPiCodingAgentHarness } from "../createHarness.js";
import { adaptToolsForPi } from "../tool-adapter.js";
import { PiSessionStore } from "../sessions.js";
import type { AgentTool } from "../../../../shared/tool.js";

const noopTool: AgentTool = {
  name: "noop",
  description: "Does nothing, returns ok",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: [{ type: "text", text: "ok" }] };
  },
};

describe("createPiCodingAgentHarness", () => {
  it("returns an AgentHarness with correct shape", () => {
    const harness = createPiCodingAgentHarness({ tools: [noopTool] });
    expect(harness.id).toBe("pi-coding-agent");
    expect(harness.placement).toBe("server");
    expect(harness.sessions).toBeInstanceOf(PiSessionStore);
    expect(typeof harness.sendMessage).toBe("function");
  });
});

describe("adaptToolsForPi", () => {
  it("adapts AgentTool[] to ToolDefinition[] without pi built-ins", () => {
    const adapted = adaptToolsForPi([noopTool]);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].name).toBe("noop");
    expect(adapted[0].label).toBe("noop");
    expect(adapted[0].description).toBe("Does nothing, returns ok");

    const piBuiltIns = ["bash", "read", "write", "edit", "find", "grep", "ls"];
    for (const name of piBuiltIns) {
      expect(adapted.find((t) => t.name === name)).toBeUndefined();
    }
  });

  it("execute adapter bridges correctly", async () => {
    const calls: unknown[] = [];
    const tool: AgentTool = {
      name: "spy",
      description: "Records calls",
      parameters: { type: "object", properties: { x: { type: "number" } } },
      async execute(params, ctx) {
        calls.push({ params, toolCallId: ctx.toolCallId });
        return { content: [{ type: "text", text: "done" }] };
      },
    };

    const [adapted] = adaptToolsForPi([tool]);
    const result = await adapted.execute(
      "call-1",
      { x: 42 },
      undefined,
      undefined,
      {} as any,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ params: { x: 42 }, toolCallId: "call-1" });
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("throws on isError results", async () => {
    const tool: AgentTool = {
      name: "fail",
      description: "Always fails",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          content: [{ type: "text", text: "something broke" }],
          isError: true,
        };
      },
    };

    const [adapted] = adaptToolsForPi([tool]);
    await expect(
      adapted.execute("call-1", {}, undefined, undefined, {} as any),
    ).rejects.toThrow("something broke");
  });
});

describe("PiSessionStore", () => {
  const ctx = { workspaceId: "test-ws" };

  it("creates and lists sessions", async () => {
    const store = new PiSessionStore();
    const session = await store.create(ctx, { title: "Test" });
    expect(session.id).toBeTruthy();
    expect(session.title).toBe("Test");

    const list = await store.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(session.id);
  });

  it("loads a session with messages", async () => {
    const store = new PiSessionStore();
    const session = await store.create(ctx);
    const detail = await store.load(ctx, session.id);
    expect(detail.messages).toEqual([]);
  });

  it("deletes a session", async () => {
    const store = new PiSessionStore();
    const session = await store.create(ctx);
    await store.delete(ctx, session.id);
    const list = await store.list(ctx);
    expect(list).toHaveLength(0);
  });

  it("throws on load of nonexistent session", async () => {
    const store = new PiSessionStore();
    await expect(store.load(ctx, "nope")).rejects.toThrow("Session not found");
  });

  it("isolates sessions by workspaceId", async () => {
    const store = new PiSessionStore();
    await store.create({ workspaceId: "ws-a" });
    await store.create({ workspaceId: "ws-b" });
    expect(await store.list({ workspaceId: "ws-a" })).toHaveLength(1);
    expect(await store.list({ workspaceId: "ws-b" })).toHaveLength(1);
  });
});
