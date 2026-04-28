import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubscribers, promptHandle } = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn().mockResolvedValue({
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
      // Mirrors pi's `get systemPrompt(): string` accessor — used by the
      // harness to satisfy AgentHarness.getSystemPrompt without a route
      // round-trip through the LLM.
      get systemPrompt() {
        return "You are a fake test agent.";
      },
    },
  }),
  SessionManager: { inMemory: () => ({}) },
  AuthStorage: { inMemory: () => ({}), create: () => ({}) },
  ModelRegistry: {
    inMemory: () => ({ find: () => undefined }),
    create: () => ({ find: () => undefined }),
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

    const final = await reader.next();
    expect(final.done).toBe(true);
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
