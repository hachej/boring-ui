import { describe, it, expect } from "vitest";
import { piEventToChunks } from "../stream-adapter.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

const fakeMsg = {
  role: "assistant" as const,
  content: [],
  api: "anthropic" as any,
  provider: "anthropic" as any,
  model: "test",
  usage: {
    input: 100,
    output: 50,
    cacheRead: 10,
    cacheWrite: 5,
    totalTokens: 165,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

function msgUpdate(ameType: string, extra: Record<string, unknown> = {}): AgentSessionEvent {
  return {
    type: "message_update",
    message: fakeMsg,
    assistantMessageEvent: { type: ameType, partial: fakeMsg, ...extra },
  } as AgentSessionEvent;
}

describe("piEventToChunks — full mapping table", () => {
  it("message_start → message-start", () => {
    const r = piEventToChunks({ type: "message_start", message: fakeMsg } as AgentSessionEvent);
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("message-start");
  });

  it("text_start → text-start", () => {
    const r = piEventToChunks(msgUpdate("text_start", { contentIndex: 0 }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("text-start");
    expect((r[0] as any).contentIndex).toBe(0);
  });

  it("text_delta → text-delta", () => {
    const r = piEventToChunks(msgUpdate("text_delta", { contentIndex: 0, delta: "hello" }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("text-delta");
    expect((r[0] as any).delta).toBe("hello");
  });

  it("text_end → text-end", () => {
    const r = piEventToChunks(msgUpdate("text_end", { contentIndex: 0, content: "full text" }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("text-end");
    expect((r[0] as any).content).toBe("full text");
  });

  it("thinking_start → reasoning-start", () => {
    const r = piEventToChunks(msgUpdate("thinking_start", { contentIndex: 1 }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("reasoning-start");
  });

  it("thinking_delta → reasoning-delta", () => {
    const r = piEventToChunks(msgUpdate("thinking_delta", { contentIndex: 1, delta: "hmm" }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("reasoning-delta");
    expect((r[0] as any).delta).toBe("hmm");
  });

  it("thinking_end → reasoning-end", () => {
    const r = piEventToChunks(msgUpdate("thinking_end", { contentIndex: 1, content: "thought" }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("reasoning-end");
  });

  it("toolcall_start → tool-input-start", () => {
    const r = piEventToChunks(msgUpdate("toolcall_start", { contentIndex: 2 }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("tool-input-start");
  });

  it("toolcall_delta → tool-input-delta", () => {
    const r = piEventToChunks(msgUpdate("toolcall_delta", { contentIndex: 2, delta: '{"x":' }));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("tool-input-delta");
    expect((r[0] as any).delta).toBe('{"x":');
  });

  it("toolcall_end → tool-input-available", () => {
    const r = piEventToChunks(
      msgUpdate("toolcall_end", {
        contentIndex: 2,
        toolCall: { type: "toolCall", id: "tc-1", name: "bash", arguments: { cmd: "ls" } },
      }),
    );
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("tool-input-available");
    expect((r[0] as any).toolCallId).toBe("tc-1");
    expect((r[0] as any).toolName).toBe("bash");
    expect((r[0] as any).input).toEqual({ cmd: "ls" });
  });

  it("done → data-usage + finish", () => {
    const r = piEventToChunks(
      msgUpdate("done", { reason: "stop", message: fakeMsg }),
    );
    expect(r).toHaveLength(2);
    expect((r[0] as any).type).toBe("data-usage");
    expect((r[0] as any).data.input).toBe(100);
    expect((r[0] as any).data.output).toBe(50);
    expect((r[0] as any).data.cost).toBe(0.03);
    expect((r[1] as any).type).toBe("finish");
  });

  it("error (aborted) → error + finish", () => {
    const r = piEventToChunks(
      msgUpdate("error", { reason: "aborted", error: { ...fakeMsg, stopReason: "aborted" } }),
    );
    expect(r).toHaveLength(2);
    expect((r[0] as any).type).toBe("error");
    expect((r[0] as any).errorText).toBe("Aborted");
    expect((r[1] as any).type).toBe("finish");
  });

  it("error (non-aborted) → error + finish", () => {
    const r = piEventToChunks(
      msgUpdate("error", {
        reason: "error",
        error: { ...fakeMsg, stopReason: "error", errorMessage: "API down" },
      }),
    );
    expect(r).toHaveLength(2);
    expect((r[0] as any).type).toBe("error");
    expect((r[0] as any).errorText).toBe("API down");
    expect((r[1] as any).type).toBe("finish");
  });

  it("tool_execution_end (success) → tool-output-available", () => {
    const r = piEventToChunks({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "output" }], details: null },
      isError: false,
    } as AgentSessionEvent);
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("tool-output-available");
    expect((r[0] as any).toolCallId).toBe("tc-1");
  });

  it("tool_execution_end (error) → tool-output-error", () => {
    const r = piEventToChunks({
      type: "tool_execution_end",
      toolCallId: "tc-2",
      toolName: "bash",
      result: { content: [{ type: "text", text: "command failed" }], details: null },
      isError: true,
    } as AgentSessionEvent);
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("tool-output-error");
    expect((r[0] as any).errorText).toBe("command failed");
  });

  it("message_end → message-end", () => {
    const r = piEventToChunks({ type: "message_end", message: fakeMsg } as AgentSessionEvent);
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("message-end");
  });

  it("assistantMessageEvent start → empty", () => {
    const r = piEventToChunks(msgUpdate("start"));
    expect(r).toEqual([]);
  });

  it("known lifecycle events → empty", () => {
    for (const type of [
      "agent_start",
      "turn_start",
      "turn_end",
      "tool_execution_start",
      "tool_execution_update",
      "queue_update",
      "compaction_start",
      "compaction_end",
      "auto_retry_start",
      "auto_retry_end",
    ]) {
      expect(piEventToChunks({ type } as any)).toEqual([]);
    }
  });

  it("unknown session event → data-status warn", () => {
    const r = piEventToChunks({ type: "future_event_xyz" } as any);
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("data-status");
    expect((r[0] as any).data.level).toBe("warn");
    expect((r[0] as any).data.msg).toContain("future_event_xyz");
  });

  it("unknown assistant message event → data-status warn", () => {
    const r = piEventToChunks(msgUpdate("future_ame_xyz"));
    expect(r).toHaveLength(1);
    expect((r[0] as any).type).toBe("data-status");
    expect((r[0] as any).data.msg).toContain("future_ame_xyz");
  });

  it("agent_end → empty (handled by consumer)", () => {
    const r = piEventToChunks({ type: "agent_end", messages: [] } as AgentSessionEvent);
    expect(r).toEqual([]);
  });
});
