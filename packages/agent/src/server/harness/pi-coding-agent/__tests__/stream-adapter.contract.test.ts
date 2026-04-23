import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { describe, it, expect } from "vitest";
import {
  expectChunksMatchAiSchema,
  expectChunkMatchesAiSchema,
} from "../../../__tests__/uiMessageChunkContract.js";
import { piEventToChunks } from "../stream-adapter.js";

const fakeMsg = {
  id: "assistant-message-id",
  role: "assistant" as const,
  content: [],
  api: "anthropic" as const,
  provider: "anthropic" as const,
  model: "test-model",
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: {
      input: 0.001,
      output: 0.002,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.003,
    },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

function msgUpdate(
  assistantMessageEvent: Record<string, unknown>,
): AgentSessionEvent {
  return {
    type: "message_update",
    message: fakeMsg,
    assistantMessageEvent,
  } as unknown as AgentSessionEvent;
}

async function expectValidChunks(event: AgentSessionEvent): Promise<void> {
  const chunks = piEventToChunks(event);
  await expectChunksMatchAiSchema(chunks);
}

describe("piEventToChunks AI SDK contract", () => {
  it("emits chunks valid against uiMessageChunkSchema for every mapped event", async () => {
    const events: AgentSessionEvent[] = [
      { type: "message_start", message: fakeMsg } as AgentSessionEvent,
      {
        type: "message_start",
        message: { ...fakeMsg, id: undefined },
      } as AgentSessionEvent,

      msgUpdate({ type: "start", partial: fakeMsg }),
      msgUpdate({ type: "text_start", contentIndex: 0, partial: fakeMsg }),
      msgUpdate({
        type: "text_delta",
        contentIndex: 0,
        delta: "hello",
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "text_end",
        contentIndex: 0,
        content: "hello",
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "thinking_start",
        contentIndex: 1,
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "thinking_delta",
        contentIndex: 1,
        delta: "thinking...",
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "thinking_end",
        contentIndex: 1,
        content: "done",
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "toolcall_start",
        contentIndex: 2,
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "toolcall_delta",
        contentIndex: 2,
        delta: "{\"cmd\":\"ls\"",
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "toolcall_end",
        contentIndex: 2,
        partial: fakeMsg,
        toolCall: {
          type: "toolCall",
          id: "tool-call-1",
          name: "bash",
          arguments: { cmd: "ls" },
        },
      }),
      msgUpdate({
        type: "done",
        reason: "stop",
        message: fakeMsg,
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "error",
        reason: "aborted",
        error: { ...fakeMsg, stopReason: "aborted" },
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "error",
        reason: "error",
        error: { ...fakeMsg, stopReason: "error", errorMessage: "boom" },
        partial: fakeMsg,
      }),
      msgUpdate({
        type: "unknown_assistant_message_event",
        partial: fakeMsg,
      }),

      {
        type: "tool_execution_start",
        toolCallId: "tool-call-2",
        toolName: "bash",
      } as AgentSessionEvent,
      {
        type: "tool_execution_update",
        toolCallId: "tool-call-2",
        toolName: "bash",
      } as AgentSessionEvent,
      {
        type: "tool_execution_end",
        toolCallId: "tool-call-2",
        toolName: "bash",
        result: {
          content: [{ type: "text", text: "ok" }],
          details: {
            fileChanges: [
              {
                op: "write",
                path: "src/new.ts",
                size: 2,
                timestamp: "2026-04-23T00:00:00.000Z",
              },
            ],
          },
        },
        isError: false,
      } as AgentSessionEvent,
      {
        type: "tool_execution_end",
        toolCallId: "tool-call-3",
        toolName: "bash",
        result: { content: [{ type: "text", text: "command failed" }] },
        isError: true,
      } as AgentSessionEvent,

      { type: "message_end", message: fakeMsg } as AgentSessionEvent,
      { type: "agent_start" } as AgentSessionEvent,
      { type: "agent_end", messages: [] } as AgentSessionEvent,
      { type: "turn_start" } as AgentSessionEvent,
      { type: "turn_end" } as AgentSessionEvent,
      { type: "queue_update" } as AgentSessionEvent,
      { type: "compaction_start" } as AgentSessionEvent,
      { type: "compaction_end" } as AgentSessionEvent,
      { type: "auto_retry_start" } as AgentSessionEvent,
      { type: "auto_retry_end" } as AgentSessionEvent,

      { type: "unknown_session_event" } as unknown as AgentSessionEvent,
    ];

    for (const event of events) {
      await expectValidChunks(event);
    }
  });
});

function replayChunks(
  messages: { role: string; id?: string; parts: Record<string, unknown>[] }[],
): Record<string, unknown>[] {
  const chunks: Record<string, unknown>[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const messageId = msg.id;
    chunks.push(messageId ? { type: "start", messageId } : { type: "start" });
    let ci = 0;
    for (const part of msg.parts) {
      if (part.type === "text") {
        const id = `${messageId ?? "replay"}:${ci}`;
        chunks.push({ type: "text-start", id });
        chunks.push({ type: "text-delta", id, delta: part.text });
        chunks.push({ type: "text-end", id });
        ci++;
      }
      if (part.type === "tool-invocation") {
        chunks.push({
          type: "tool-input-available",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        });
        if (part.state === "output-available") {
          chunks.push({
            type: "tool-output-available",
            toolCallId: part.toolCallId,
            output: part.output,
          });
        }
        ci++;
      }
    }
    chunks.push({ type: "finish" });
  }
  return chunks;
}

describe("chat.ts history-replay AI SDK contract", () => {
  it("text-only replay validates", async () => {
    const chunks = replayChunks([
      {
        role: "assistant",
        id: "msg-1",
        parts: [{ type: "text", text: "Hello world" }],
      },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    await expectChunksMatchAiSchema(chunks);
  });

  it("tool-invocation replay validates", async () => {
    const chunks = replayChunks([
      {
        role: "assistant",
        id: "msg-2",
        parts: [
          {
            type: "tool-invocation",
            toolCallId: "tc-1",
            toolName: "bash",
            input: { cmd: "ls" },
            state: "output-available",
            output: { exitCode: 0 },
          },
        ],
      },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    await expectChunksMatchAiSchema(chunks);
  });

  it("mixed text + tool replay validates", async () => {
    const chunks = replayChunks([
      {
        role: "assistant",
        id: "msg-3",
        parts: [
          { type: "text", text: "Let me check" },
          {
            type: "tool-invocation",
            toolCallId: "tc-2",
            toolName: "read",
            input: { path: "a.ts" },
            state: "output-available",
            output: "file contents",
          },
          { type: "text", text: "Done" },
        ],
      },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    await expectChunksMatchAiSchema(chunks);
  });

  it("replay without messageId validates", async () => {
    const chunks = replayChunks([
      {
        role: "assistant",
        parts: [{ type: "text", text: "No ID" }],
      },
    ]);
    expect(chunks.length).toBeGreaterThan(0);
    await expectChunksMatchAiSchema(chunks);
  });

  it("skips user messages in replay", async () => {
    const chunks = replayChunks([
      { role: "user", parts: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        id: "msg-5",
        parts: [{ type: "text", text: "Hi" }],
      },
    ]);
    const startChunks = chunks.filter((c) => c.type === "start");
    expect(startChunks).toHaveLength(1);
    await expectChunksMatchAiSchema(chunks);
  });
});
