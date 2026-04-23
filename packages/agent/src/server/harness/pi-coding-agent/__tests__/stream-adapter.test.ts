import { describe, it, expect } from "vitest";
import { piEventToChunks } from "../stream-adapter.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

const fakeAssistantMessage = {
  role: "assistant" as const,
  content: [],
  api: "anthropic" as any,
  provider: "anthropic" as any,
  model: "test",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

describe("piEventToChunks", () => {
  it("converts message_start", () => {
    const chunks = piEventToChunks({
      type: "message_start",
      message: fakeAssistantMessage,
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("message-start");
  });

  it("converts text_delta via message_update", () => {
    const chunks = piEventToChunks({
      type: "message_update",
      message: fakeAssistantMessage,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "hello",
        partial: fakeAssistantMessage,
      },
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("text-delta");
    expect((chunks[0] as any).delta).toBe("hello");
  });

  it("converts thinking_delta via message_update", () => {
    const chunks = piEventToChunks({
      type: "message_update",
      message: fakeAssistantMessage,
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "reasoning...",
        partial: fakeAssistantMessage,
      },
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("reasoning-delta");
    expect((chunks[0] as any).delta).toBe("reasoning...");
  });

  it("converts toolcall_end via message_update", () => {
    const chunks = piEventToChunks({
      type: "message_update",
      message: fakeAssistantMessage,
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { type: "toolCall", id: "tc-1", name: "bash", arguments: { cmd: "ls" } },
        partial: fakeAssistantMessage,
      },
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("tool-call");
    expect((chunks[0] as any).toolCallId).toBe("tc-1");
    expect((chunks[0] as any).toolName).toBe("bash");
  });

  it("converts tool_execution_end", () => {
    const chunks = piEventToChunks({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "output" }], details: null },
      isError: false,
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("tool-result");
    expect((chunks[0] as any).isError).toBe(false);
  });

  it("converts message_end", () => {
    const chunks = piEventToChunks({
      type: "message_end",
      message: fakeAssistantMessage,
    } as AgentSessionEvent);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as any).type).toBe("message-end");
  });

  it("returns empty for irrelevant events", () => {
    expect(piEventToChunks({ type: "agent_start" } as AgentSessionEvent)).toEqual([]);
    expect(piEventToChunks({ type: "turn_start" } as AgentSessionEvent)).toEqual([]);
  });
});
