import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubscribers, promptHandle, promptCalls, mockSessions } = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  promptCalls: [] as Array<{ message: string; opts?: any }>,
  mockSessions: [] as any[],
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn().mockImplementation(async () => {
    const followUpQueue = { messages: [] as any[] };
    const session: any = {
      _followUpMessages: [] as string[],
      _emitQueueUpdate: vi.fn(),
      agent: {
        followUpQueue,
        clearFollowUpQueue: vi.fn(() => { followUpQueue.messages = []; }),
      },
      subscribe(listener: (event: any) => void) {
        mockSubscribers.push(listener);
        return () => {
          const idx = mockSubscribers.indexOf(listener);
          if (idx >= 0) mockSubscribers.splice(idx, 1);
        };
      },
      prompt: vi.fn().mockImplementation((msg: string, opts?: any) => {
        promptCalls.push({ message: msg, opts });
        return new Promise<void>((resolve) => {
          promptHandle.resolve = resolve;
        });
      }),
      followUp: vi.fn().mockImplementation((msg: string, opts?: any) => {
        promptCalls.push({ message: msg, opts: { ...(opts ?? {}), nativeFollowUp: true } });
        session._followUpMessages.push(msg);
        followUpQueue.messages.push({ role: "user", content: [{ type: "text", text: msg }] });
        return Promise.resolve();
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      get model() { return undefined },
      get systemPrompt() { return "test agent" },
    };
    mockSessions.push(session);
    return { session };
  }),
  SessionManager: {
    inMemory: () => ({}),
    create: () => ({ getSessionFile: () => null }),
    open: () => ({ getSessionFile: () => null }),
  },
  AuthStorage: { inMemory: () => ({}), create: () => ({}) },
  ModelRegistry: {
    inMemory: () => ({ find: vi.fn(), getAvailable: () => [] }),
    create: () => ({ find: vi.fn(), getAvailable: () => [], hasConfiguredAuth: () => true, isUsingOAuth: () => false }),
  },
  // createHarness now always builds a DefaultResourceLoader (workspace-paths
  // guideline). Stub the pi-side lookups it needs.
  getAgentDir: () => "/tmp/test-agent-dir",
  DefaultResourceLoader: class {
    constructor(_opts: unknown) {}
    async reload() { /* no-op */ }
  },
  SettingsManager: {
    create: () => ({ getResolvedSettings: () => ({}), loadAllSettings: vi.fn() }),
  },
}));

import { createPiCodingAgentHarness } from "../createHarness.js";
import type { RunContext } from "../../../../shared/harness.js";

function emit(event: any): void {
  for (const sub of [...mockSubscribers]) sub(event);
}

function makeCtx(ac = new AbortController()): RunContext {
  return { abortSignal: ac.signal, workdir: "/tmp/test-followup" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  promptHandle.resolve = undefined;
  promptCalls.length = 0;
  mockSessions.length = 0;
});

describe("native pi follow-up integration", () => {
  it("queues follow-up through pi's native followUp API", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-native", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-native", "second visible");

    expect(promptCalls.map((c) => c.message)).toEqual(["first", "second visible"]);
    expect(promptCalls[1]?.opts).toMatchObject({ nativeFollowUp: true });

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("dedupes repeated queued follow-up posts with the same nonce", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-dedupe", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-dedupe", "same nonce", undefined, "same nonce", { clientNonce: "nonce-dedupe", clientSeq: 1 });
    await harness.followUp!("sess-dedupe", "same nonce", undefined, "same nonce", { clientNonce: "nonce-dedupe", clientSeq: 1 });

    expect(promptCalls.map((c) => c.message)).toEqual(["first", "same nonce"]);
    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["same nonce"]);

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("does not dedupe distinct nonces that reuse a client sequence", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-seq-reuse", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-seq-reuse", "first seq", undefined, "first seq", { clientNonce: "nonce-seq-a", clientSeq: 1 });
    await harness.followUp!("sess-seq-reuse", "second seq", undefined, "second seq", { clientNonce: "nonce-seq-b", clientSeq: 1 });

    expect(promptCalls.map((c) => c.message)).toEqual(["first", "first seq", "second seq"]);
    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["first seq", "second seq"]);

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("dedupes a repeated follow-up post after pi consumes the first copy", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-consumed-dedupe", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-consumed-dedupe", "same consumed nonce", undefined, "same consumed nonce", { clientNonce: "nonce-consumed", clientSeq: 1 });

    const consumed = reader.next();
    emit({
      type: "message_start",
      message: { id: "u2", role: "user", content: [{ type: "text", text: "same consumed nonce" }] },
    });
    await consumed;

    await harness.followUp!("sess-consumed-dedupe", "same consumed nonce", undefined, "same consumed nonce", { clientNonce: "nonce-consumed", clientSeq: 1 });

    expect(promptCalls.map((c) => c.message)).toEqual(["first", "same consumed nonce"]);
    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["same consumed nonce"]);

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("can delete a queued follow-up before pi drains it", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-delete", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-delete", "delete me", undefined, "delete me", { clientNonce: "nonce-delete", clientSeq: 1 });
    harness.clearFollowUp!("sess-delete", { clientNonce: "nonce-delete" });
    emit({ type: "agent_end" });

    expect(promptCalls.map((c) => c.message)).toEqual(["first", "delete me"]);
    expect(mockSessions[0].agent.followUpQueue.messages).toEqual([]);
    expect(mockSessions[0]._followUpMessages).toEqual([]);

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("deleting one duplicate-text follow-up leaves the other queued", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-delete-dupe", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await boot;

    await harness.followUp!("sess-delete-dupe", "same text", undefined, "same text", { clientNonce: "nonce-1", clientSeq: 1 });
    await harness.followUp!("sess-delete-dupe", "same text", undefined, "same text", { clientNonce: "nonce-2", clientSeq: 2 });
    harness.clearFollowUp!("sess-delete-dupe", { clientNonce: "nonce-2" });

    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["same text"]);
    expect(mockSessions[0]._followUpMessages).toEqual(["same text"]);

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("maps pi's consumed follow-up user message into a data marker and namespaces the next assistant parts", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const iter = harness.sendMessage({ sessionId: "sess-events", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const chunks: any[] = [];
    const first = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    chunks.push((await first).value);

    const markerNext = reader.next();
    emit({
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "queued question" }] },
    });
    chunks.push((await markerNext).value);

    const piUserStartNext = reader.next();
    chunks.push((await piUserStartNext).value);

    const assistantStartNext = reader.next();
    emit({ type: "message_start", message: { id: "a2", role: "assistant" } });
    chunks.push((await assistantStartNext).value);

    const sdkAssistantStartNext = reader.next();
    chunks.push((await sdkAssistantStartNext).value);

    const textStartNext = reader.next();
    emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    chunks.push((await textStartNext).value);

    const textDeltaNext = reader.next();
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } });
    chunks.push((await textDeltaNext).value);
    chunks.push((await reader.next()).value);

    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-followup-consumed", data: { text: "queued question" } }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-pi-message-start", data: expect.objectContaining({ role: "user", text: "queued question" }) }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-pi-message-start", data: expect.objectContaining({ role: "assistant", messageId: "a2" }) }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "start", messageId: "a2" }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-pi-text-start", data: expect.objectContaining({ messageId: "a2", partId: "0" }) }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-pi-text-delta", data: expect.objectContaining({ messageId: "a2", partId: "0", delta: "hello" }) }));
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: "text-start" }));
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: "text-delta", delta: "hello" }));
    const seqs = chunks.map((chunk) => chunk.data?.seq).filter(Boolean);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    promptHandle.resolve?.();
    await reader.return?.();
  });

  it("suppresses canonical visible tool chunks for queued inline turns while keeping data-pi tool side channel", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-tools" });
    const iter = harness.sendMessage({ sessionId: "sess-followup-tools", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();
    const chunks: any[] = [];

    const first = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    chunks.push((await first).value);

    emit({
      type: "message_start",
      message: { id: "u2", role: "user", content: [{ type: "text", text: "queued question" }] },
    });
    emit({ type: "message_start", message: { id: "a2", role: "assistant" } });
    emit({
      type: "message_update",
      messageId: "a2",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: { id: "tool-inline", name: "bash", arguments: { command: "pwd" } },
      },
    });
    emit({
      type: "tool_execution_end",
      toolCallId: "tool-inline",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    });
    emit({ type: "agent_end" });
    promptHandle.resolve?.();

    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toContainEqual(expect.objectContaining({ type: "data-followup-consumed", data: { text: "queued question" } }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-tool-call-end",
      data: expect.objectContaining({ messageId: "a2", toolCallId: "tool-inline", toolName: "bash", input: { command: "pwd" } }),
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-tool-result",
      data: expect.objectContaining({ messageId: "a2", toolCallId: "tool-inline", output: { content: [{ type: "text", text: "ok" }] } }),
    }));
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: "tool-input-available", toolCallId: "tool-inline" }));
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: "tool-output-available", toolCallId: "tool-inline" }));
  });

  it("preserves snapshot-only assistant fallback after a consumed follow-up", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-snapshot" });
    const iter = harness.sendMessage({ sessionId: "sess-snapshot-followup", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();
    const chunks: any[] = [];

    const first = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    chunks.push((await first).value);

    await harness.followUp!("sess-snapshot-followup", "queued question");

    const consumed = reader.next();
    emit({
      type: "message_start",
      message: { id: "u2", role: "user", content: [{ type: "text", text: "queued question" }] },
    });
    chunks.push((await consumed).value);

    const userStart = reader.next();
    chunks.push((await userStart).value);

    const userEnd = reader.next();
    emit({
      type: "message_end",
      message: { id: "u2", role: "user", content: [{ type: "text", text: "queued question" }] },
    });
    chunks.push((await userEnd).value);

    emit({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "first answer" }] },
        { role: "user", content: [{ type: "text", text: "queued question" }] },
        { role: "assistant", content: [{ type: "text", text: "follow-up answer" }] },
      ],
    });
    promptHandle.resolve?.();

    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-message-end",
      data: expect.objectContaining({ role: "assistant", text: "follow-up answer" }),
    }));
  });

  it("closes the stream if pi resolves before consuming a queued follow-up", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-settle" });
    const iter = harness.sendMessage({ sessionId: "sess-settle-followup", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const first = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start", message: { id: "a1", role: "assistant" } });
    await first;

    await harness.followUp!("sess-settle-followup", "queued question");

    const next = reader.next();
    emit({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "first answer" }] },
      ],
    });
    promptHandle.resolve?.();

    await expect(next).resolves.toMatchObject({ done: false });
    let closed = false;
    for (let i = 0; i < 5; i++) {
      const item = await reader.next();
      if (item.done) {
        closed = true;
        break;
      }
    }
    expect(closed).toBe(true);
  });
});
