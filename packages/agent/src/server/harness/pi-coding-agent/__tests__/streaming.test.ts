import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSubscribers,
  promptHandle,
  mockCurrentModel,
  mockSetModel,
  mockSetThinkingLevel,
  mockFindModel,
} = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  mockCurrentModel: {
    value: undefined as undefined | { provider: string; id: string },
  },
  mockSetModel: vi.fn(async (model: { provider: string; id: string }) => {
    mockCurrentModel.value = model;
  }),
  mockSetThinkingLevel: vi.fn(),
  mockFindModel: vi.fn((provider: string, id: string) => ({ provider, id })),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn().mockImplementation(async (config: any) => {
    mockCurrentModel.value = config.model;
    return {
      session: {
        subscribe(listener: (event: any) => void) {
          mockSubscribers.push(listener);
          return () => {
            const idx = mockSubscribers.indexOf(listener);
            if (idx >= 0) mockSubscribers.splice(idx, 1);
          };
        },
        // prompt() resolves only when the test calls promptHandle.resolve().
        // This mirrors pi-coding-agent's real behaviour where prompt() waits
        // for agent_end before returning.
        prompt: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              promptHandle.resolve = resolve;
            }),
        ),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
        setModel: mockSetModel,
        setThinkingLevel: mockSetThinkingLevel,
        get model() {
          return mockCurrentModel.value;
        },
        // Mirrors pi's `get systemPrompt(): string` accessor — used by the
        // harness to satisfy AgentHarness.getSystemPrompt without a route
        // round-trip through the LLM.
        get systemPrompt() {
          return "You are a fake test agent.";
        },
      },
    };
  }),
  SessionManager: { inMemory: () => ({}), create: () => ({ getSessionFile: () => null }), open: () => ({ getSessionFile: () => null }) },
  AuthStorage: { inMemory: () => ({}), create: () => ({}) },
  ModelRegistry: {
    inMemory: () => ({
      find: mockFindModel,
      // Return every model find() has been called with — keeps the mock
      // consistent: anything the registry "knows about" is also available.
      getAvailable: () => mockFindModel.mock.calls.map(([provider, id]: [string, string]) => ({ provider, id })),
    }),
    create: () => ({
      find: mockFindModel,
      getAvailable: () => mockFindModel.mock.calls.map(([provider, id]: [string, string]) => ({ provider, id })),
    }),
  },
}));

import { createPiCodingAgentHarness } from "../createHarness.js";
import type { RunContext, SendMessageInput } from "../../../../shared/harness.js";

function emitPiEvent(event: any): void {
  for (const sub of mockSubscribers) sub(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  promptHandle.resolve = undefined;
  mockCurrentModel.value = undefined;
});

describe("streaming concurrency", () => {
  // The bug we're guarding against: an earlier implementation did
  //   await piSession.prompt(input.message);
  //   while (!done) { ... yield chunks.shift() ... }
  // which serialised the prompt with consumption — chunks accumulated in a
  // local array and were only flushed *after* prompt() resolved (i.e. at
  // agent_end), producing one big end-of-turn dump instead of streaming.
  //
  // The fix runs prompt() concurrently. This test asserts the contract:
  // chunks must yield from the generator while prompt() is still pending.
  it("yields chunks while prompt() is still in flight", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-stream",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-stream",
    };
    const input: SendMessageInput = {
      sessionId: "sess-stream-1",
      message: "hello",
    };

    const iter = harness.sendMessage(input, ctx);
    const reader = iter[Symbol.asyncIterator]();

    // Kick the generator. It registers the subscriber and starts prompt(),
    // which is parked on our deferred promise.
    const firstReadPromise = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    // Sanity: prompt() has NOT resolved yet.
    expect(promptHandle.resolve).toBeDefined();

    // Subscriber emits a chunk mid-turn. The fix means the generator drains
    // it through the consumer loop without waiting for prompt() to finish.
    emitPiEvent({ type: "message_start" });

    const firstRead = await firstReadPromise;
    expect(firstRead.done).toBe(false);
    // prompt() is still pending — proves we yielded *during* the turn,
    // not after it.
    expect(promptHandle.resolve).toBeDefined();

    // Emit several more chunks while prompt() is still pending — each
    // should arrive in its own next() tick, not be batched.
    const secondReadPromise = reader.next();
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi " },
    });
    const secondRead = await secondReadPromise;
    expect(secondRead.done).toBe(false);

    const thirdReadPromise = reader.next();
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "there" },
    });
    const thirdRead = await thirdReadPromise;
    expect(thirdRead.done).toBe(false);

    // Now end the turn. agent_end + prompt() resolution should drain any
    // remaining chunks and close the iterator.
    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve!();

    for (;;) {
      const final = await reader.next();
      if (final.done) break;
    }
  });

  it("does not buffer chunks until prompt() resolves", async () => {
    // Stronger form of the previous test: emit N chunks before the
    // generator is read, then read N times — each read should advance.
    // (Pre-fix, all reads after the first would block until prompt resolved.)
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-stream-buf",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-stream-buf",
    };

    const iter = harness.sendMessage(
      { sessionId: "sess-stream-2", message: "x" },
      ctx,
    );
    const reader = iter[Symbol.asyncIterator]();

    // Start the generator so it registers its subscriber and starts prompt().
    const r1 = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    // Pump 3 chunks into the queue while prompt() hangs.
    emitPiEvent({ type: "message_start" });
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "a" },
    });
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "b" },
    });

    // All three reads should resolve while prompt() is still pending.
    const a = await r1;
    const b = await reader.next();
    const c = await reader.next();
    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    expect(c.done).toBe(false);
    expect(promptHandle.resolve).toBeDefined();

    // Clean up.
    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve!();
    await reader.next();
  });

  it("emits a text delta when pi only provides final text on text_end", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-stream-text-end",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-stream-text-end",
    };

    const iter = harness.sendMessage(
      { sessionId: "sess-stream-text-end", message: "x" },
      ctx,
    );
    const reader = iter[Symbol.asyncIterator]();
    const chunks: unknown[] = [];

    const firstRead = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    emitPiEvent({ type: "message_start" });
    chunks.push((await firstRead).value);
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_start", contentIndex: 0 },
    });
    emitPiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        contentIndex: 0,
        content: "final-only text",
      },
    });
    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve!();

    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-text-end",
      data: expect.objectContaining({ text: "final-only text" }),
    }));
  });

  it("emits a text delta when pi only provides final text on agent_end", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-stream-agent-end",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-stream-agent-end",
    };

    const iter = harness.sendMessage(
      { sessionId: "sess-stream-agent-end", message: "x" },
      ctx,
    );
    const reader = iter[Symbol.asyncIterator]();
    const chunks: unknown[] = [];

    const firstRead = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    emitPiEvent({ type: "message_start" });
    chunks.push((await firstRead).value);
    emitPiEvent({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "x" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "agent-end text" }],
        },
      ],
    });
    promptHandle.resolve!();

    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-message-end",
      data: expect.objectContaining({ text: "agent-end text" }),
    }));
  });

  it("does not treat user pi history text as assistant output", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-stream-agent-end-after-user",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-stream-agent-end-after-user",
    };

    const iter = harness.sendMessage(
      { sessionId: "sess-stream-agent-end-after-user", message: "hi" },
      ctx,
    );
    const reader = iter[Symbol.asyncIterator]();
    const chunks: unknown[] = [];

    const firstRead = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    emitPiEvent({
      type: "message_start",
      message: { id: "user-1", role: "user", content: [{ type: "text", text: "hi" }] },
    });
    chunks.push((await firstRead).value);
    emitPiEvent({
      type: "message_end",
      message: { id: "user-1", role: "user", content: [{ type: "text", text: "hi" }] },
    });
    emitPiEvent({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "hello from fallback" }],
        },
      ],
    });
    promptHandle.resolve!();

    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      chunks.push(next.value);
    }

    expect(chunks).toContainEqual(expect.objectContaining({
      type: "data-pi-message-end",
      data: expect.objectContaining({ role: "assistant", text: "hello from fallback" }),
    }));
  });
});

describe("getSystemPrompt", () => {
  it("returns undefined before any session has been materialised", () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-sysprompt",
    });
    expect(harness.getSystemPrompt?.("never-sent")).toBeUndefined();
  });

  it("returns pi's systemPrompt once a session has been opened", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-sysprompt-2",
    });

    // Trigger lazy session creation by starting a turn.
    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-sysprompt-2",
    };
    const iter = harness.sendMessage(
      { sessionId: "sess-sysprompt", message: "hi" },
      ctx,
    );
    const reader = iter[Symbol.asyncIterator]();
    void reader.next();
    // Yield once so the harness completes getOrCreatePiSession.
    await new Promise((r) => setTimeout(r, 10));

    expect(harness.getSystemPrompt?.("sess-sysprompt")).toBe(
      "You are a fake test agent.",
    );
    expect(harness.getSystemPrompt?.("different-session")).toBeUndefined();

    // Clean up — let the generator terminate.
    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve?.();
    await reader.next();
  });
});

describe("model switching", () => {
  it("applies requested model changes to an existing pi session", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-model-switch",
    });
    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/tmp/test-model-switch",
    };

    const first = harness.sendMessage(
      {
        sessionId: "sess-model-switch",
        message: "first",
        model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      },
      ctx,
    );
    const firstReader = first[Symbol.asyncIterator]();
    const firstPending = firstReader.next();
    await new Promise((r) => setTimeout(r, 5));
    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve!();
    await firstPending;

    expect(mockCurrentModel.value).toEqual({
      provider: "anthropic",
      id: "claude-sonnet-4-6",
    });
    expect(mockSetModel).not.toHaveBeenCalled();

    const second = harness.sendMessage(
      {
        sessionId: "sess-model-switch",
        message: "second",
        model: { provider: "openai-codex", id: "gpt-5.1" },
        thinkingLevel: "low",
      },
      ctx,
    );
    const secondReader = second[Symbol.asyncIterator]();
    const secondPending = secondReader.next();
    await new Promise((r) => setTimeout(r, 5));

    expect(mockSetModel).toHaveBeenCalledWith({
      provider: "openai-codex",
      id: "gpt-5.1",
    });
    expect(mockSetThinkingLevel).toHaveBeenCalledWith("low");

    emitPiEvent({ type: "agent_end" });
    promptHandle.resolve!();
    await secondPending;
  });
});
