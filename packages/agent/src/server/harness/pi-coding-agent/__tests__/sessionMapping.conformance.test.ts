import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { piEventToChunks } from "../stream-adapter.js";
import { PiSessionStore } from "../sessions.js";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "pi-events-corpus.jsonl",
);

describe("Pi SessionEntry → UIMessage conformance", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-conform-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("PiSessionStore.load() maps all pi message types to UIMessages", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    expect(detail.id).toBe("fixture-session-001");
    expect(detail.title).toBe("File listing chat");

    const msgs = detail.messages;
    expect(msgs.length).toBeGreaterThanOrEqual(4);

    const userMsgs = msgs.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(2);
    expect((userMsgs[0].parts[0] as any).text).toBe("List files in /tmp");
    expect((userMsgs[1].parts[0] as any).text).toBe(
      "Now write hello to a file",
    );

    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);

    const firstAssistant = assistantMsgs[0];
    const parts = firstAssistant.parts as any[];

    const reasoningPart = parts.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart.text).toContain("list files");
    expect(reasoningPart.state).toBe("done");

    const textPart = parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(textPart.text).toContain("list the files");

    const toolPart = parts.find((p) => p.type === "tool-bash");
    expect(toolPart).toBeDefined();
    expect(toolPart.toolName).toBe("bash");
    expect(toolPart.toolCallId).toBe("tc-1");
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toBeDefined();

    expect(detail.turnCount).toBe(2);
  });

  it("tool error results map to output-error state", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    const assistantMsgs = detail.messages.filter(
      (m) => m.role === "assistant",
    );
    const writeAssistant = assistantMsgs.find((m) =>
      (m.parts as any[]).some(
        (p) => p.type === "tool-write" && p.toolName === "write",
      ),
    );
    expect(writeAssistant).toBeDefined();

    const writeTool = (writeAssistant!.parts as any[]).find(
      (p) => p.type === "tool-write" && p.toolName === "write",
    );
    expect(writeTool.state).toBe("output-error");
    expect(writeTool.errorText).toContain("permission denied");
  });

  it("stream adapter handles all pi event types without crashing", () => {
    const eventTypes: Array<[string, AgentSessionEvent]> = [
      [
        "message_start",
        { type: "message_start", message: fakeMsg } as AgentSessionEvent,
      ],
      ["text_start", msgUpdate("text_start", { contentIndex: 0 })],
      [
        "text_delta",
        msgUpdate("text_delta", { contentIndex: 0, delta: "hi" }),
      ],
      [
        "text_end",
        msgUpdate("text_end", { contentIndex: 0, content: "hi" }),
      ],
      [
        "thinking_start",
        msgUpdate("thinking_start", { contentIndex: 1 }),
      ],
      [
        "thinking_delta",
        msgUpdate("thinking_delta", { contentIndex: 1, delta: "hmm" }),
      ],
      [
        "thinking_end",
        msgUpdate("thinking_end", { contentIndex: 1, content: "hmm" }),
      ],
      [
        "toolcall_start",
        msgUpdate("toolcall_start", { contentIndex: 2 }),
      ],
      [
        "toolcall_delta",
        msgUpdate("toolcall_delta", { contentIndex: 2, delta: "{" }),
      ],
      [
        "toolcall_end",
        msgUpdate("toolcall_end", {
          contentIndex: 2,
          toolCall: {
            type: "toolCall",
            id: "tc-x",
            name: "bash",
            arguments: {},
          },
        }),
      ],
      [
        "done",
        msgUpdate("done", { reason: "stop", message: fakeMsg }),
      ],
      [
        "error_aborted",
        msgUpdate("error", {
          reason: "aborted",
          error: { ...fakeMsg, stopReason: "aborted" },
        }),
      ],
      [
        "error_other",
        msgUpdate("error", {
          reason: "error",
          error: { ...fakeMsg, stopReason: "error", errorMessage: "fail" },
        }),
      ],
      [
        "tool_execution_end_ok",
        {
          type: "tool_execution_end",
          toolCallId: "tc-x",
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "ok" }],
            details: null,
          },
          isError: false,
        } as AgentSessionEvent,
      ],
      [
        "tool_execution_end_err",
        {
          type: "tool_execution_end",
          toolCallId: "tc-y",
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "fail" }],
            details: null,
          },
          isError: true,
        } as AgentSessionEvent,
      ],
      [
        "message_end",
        { type: "message_end", message: fakeMsg } as AgentSessionEvent,
      ],
      [
        "agent_start",
        { type: "agent_start" } as AgentSessionEvent,
      ],
      [
        "agent_end",
        { type: "agent_end", messages: [], willRetry: false } as AgentSessionEvent,
      ],
      [
        "turn_start",
        { type: "turn_start" } as AgentSessionEvent,
      ],
      [
        "turn_end",
        { type: "turn_end" } as AgentSessionEvent,
      ],
      [
        "compaction_start",
        { type: "compaction_start" } as AgentSessionEvent,
      ],
      [
        "compaction_end",
        { type: "compaction_end" } as AgentSessionEvent,
      ],
      [
        "tool_execution_start",
        { type: "tool_execution_start" } as AgentSessionEvent,
      ],
      [
        "tool_execution_update",
        { type: "tool_execution_update" } as AgentSessionEvent,
      ],
      [
        "queue_update",
        { type: "queue_update" } as AgentSessionEvent,
      ],
      [
        "auto_retry_start",
        { type: "auto_retry_start" } as AgentSessionEvent,
      ],
      [
        "auto_retry_end",
        { type: "auto_retry_end" } as AgentSessionEvent,
      ],
    ];

    const coverage: Record<string, number> = {};
    for (const [label, event] of eventTypes) {
      const chunks = piEventToChunks(event);
      expect(Array.isArray(chunks)).toBe(true);
      coverage[label] = chunks.length;
    }

    expect(Object.keys(coverage).length).toBe(eventTypes.length);
  });

  it("unknown event types produce warnings, not crashes", () => {
    const unknown1 = piEventToChunks({
      type: "brand_new_event_2027",
    } as any);
    expect(unknown1).toHaveLength(1);
    expect((unknown1[0] as any).type).toBe("data-status");
    expect((unknown1[0] as any).data.level).toBe("warn");

    const unknown2 = piEventToChunks(
      msgUpdate("brand_new_ame_2027"),
    );
    expect(unknown2).toHaveLength(1);
    expect((unknown2[0] as any).type).toBe("data-status");
    expect((unknown2[0] as any).data.level).toBe("warn");
  });

  it("both paths produce equivalent semantic content", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    const loadedUserTexts = detail.messages
      .filter((m) => m.role === "user")
      .map((m) => (m.parts[0] as any).text);

    const loadedAssistantTexts = detail.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        (m.parts as any[])
          .filter((p) => p.type === "text")
          .map((p) => p.text),
      );

    const loadedToolNames = detail.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        (m.parts as any[])
          .filter((p) => typeof p.type === "string" && p.type.startsWith("tool-"))
          .map((p) => p.toolName),
      );

    expect(loadedUserTexts).toEqual([
      "List files in /tmp",
      "Now write hello to a file",
    ]);
    expect(loadedAssistantTexts).toContain(
      "I'll list the files for you.",
    );
    expect(loadedAssistantTexts).toContain(
      "The write failed due to a permission error.",
    );
    expect(loadedToolNames).toContain("bash");
    expect(loadedToolNames).toContain("write");

    const streamChunkTypes = new Set<string>();
    const events: AgentSessionEvent[] = [
      { type: "message_start", message: fakeMsg } as AgentSessionEvent,
      msgUpdate("text_start", { contentIndex: 0 }),
      msgUpdate("text_delta", {
        contentIndex: 0,
        delta: "I'll list the files for you.",
      }),
      msgUpdate("text_end", {
        contentIndex: 0,
        content: "I'll list the files for you.",
      }),
      msgUpdate("toolcall_start", { contentIndex: 1 }),
      msgUpdate("toolcall_end", {
        contentIndex: 1,
        toolCall: {
          type: "toolCall",
          id: "tc-1",
          name: "bash",
          arguments: { command: "ls /tmp" },
        },
      }),
      {
        type: "tool_execution_end",
        toolCallId: "tc-1",
        toolName: "bash",
        result: {
          content: [{ type: "text", text: "file1.txt\nfile2.txt\ndir1/" }],
          details: null,
        },
        isError: false,
      } as AgentSessionEvent,
      msgUpdate("done", { reason: "stop", message: fakeMsg }),
      {
        type: "message_end",
        message: fakeMsg,
      } as AgentSessionEvent,
    ];

    for (const event of events) {
      for (const chunk of piEventToChunks(event)) {
        streamChunkTypes.add((chunk as any).type);
      }
    }

    expect(streamChunkTypes.has("text-delta")).toBe(true);
    expect(streamChunkTypes.has("tool-input-available")).toBe(true);
    expect(streamChunkTypes.has("tool-output-available")).toBe(true);
  });

  it("non-message entry types are preserved without crashing", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    expect(detail.messages.length).toBeGreaterThan(0);
    expect(detail.title).toBe("File listing chat");
  });
});

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
    cost: {
      input: 0.01,
      output: 0.02,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.03,
    },
  },
  stopReason: "stop" as const,
  timestamp: Date.now(),
};

function msgUpdate(
  ameType: string,
  extra: Record<string, unknown> = {},
): AgentSessionEvent {
  return {
    type: "message_update",
    message: fakeMsg,
    assistantMessageEvent: { type: ameType, partial: fakeMsg, ...extra },
  } as AgentSessionEvent;
}
