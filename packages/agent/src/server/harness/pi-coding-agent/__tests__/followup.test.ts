import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubscribers, promptHandle, promptCalls } = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  promptCalls: [] as Array<{ message: string; opts?: any }>,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn().mockImplementation(async () => ({
    session: {
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
        return Promise.resolve();
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      get model() { return undefined },
      get systemPrompt() { return "test agent" },
    },
  })),
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
    const seqs = chunks.map((chunk) => chunk.data?.seq).filter(Boolean);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    promptHandle.resolve?.();
    await reader.return?.();
  });
});
