import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAbort, mockDispose, mockSubscribers } = vi.hoisted(() => ({
  mockAbort: vi.fn().mockResolvedValue(undefined),
  mockDispose: vi.fn(),
  mockSubscribers: [] as Array<(event: any) => void>,
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
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: mockAbort,
      dispose: mockDispose,
    },
  }),
  SessionManager: { inMemory: () => ({}) },
  AuthStorage: {
    inMemory: () => ({}),
    create: () => ({}),
  },
  ModelRegistry: {
    inMemory: (auth: unknown) => ({ find: () => undefined }),
    create: (auth: unknown) => ({ find: () => undefined }),
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
});

describe("abort propagation", () => {
  it("calls piSession.abort() when abortSignal fires between yields", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-abort",
    });

    const abortController = new AbortController();
    const ctx: RunContext = {
      abortSignal: abortController.signal,
      workdir: "/tmp/test-abort",
    };
    const input: SendMessageInput = {
      sessionId: "sess-abort-1",
      message: "hello",
    };

    const iter = harness.sendMessage(input, ctx);
    const reader = iter[Symbol.asyncIterator]();

    // Start the generator — suspends on wake promise
    const firstRead = reader.next();
    await new Promise((r) => setTimeout(r, 10));

    // Emit a chunk, generator yields, firstRead resolves
    emitPiEvent({ type: "message_start" });
    await firstRead;

    // Abort while generator is suspended at yield point
    abortController.abort();

    // Stream should end cleanly (done: true) since abort fired between yields
    const result = await reader.next();
    expect(result.done).toBe(true);
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it("calls piSession.abort() and throws when abortSignal fires during await", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-abort",
    });

    const abortController = new AbortController();
    const ctx: RunContext = {
      abortSignal: abortController.signal,
      workdir: "/tmp/test-abort",
    };
    const input: SendMessageInput = {
      sessionId: "sess-abort-2",
      message: "hello",
    };

    const iter = harness.sendMessage(input, ctx);
    const reader = iter[Symbol.asyncIterator]();

    // Start the generator — suspends on wake promise (no chunks available)
    const pendingRead = reader.next();
    await new Promise((r) => setTimeout(r, 10));

    // Abort while generator is waiting for chunks (at await point)
    abortController.abort();

    // Should throw "Aborted"
    const result = await pendingRead.catch((e: Error) => e);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Aborted");
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it("does not call piSession.abort() when stream completes normally", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-abort",
    });

    const abortController = new AbortController();
    const ctx: RunContext = {
      abortSignal: abortController.signal,
      workdir: "/tmp/test-abort",
    };
    const input: SendMessageInput = {
      sessionId: "sess-normal",
      message: "hello",
    };

    const chunks: unknown[] = [];
    const iter = harness.sendMessage(input, ctx);

    // Simulate a full turn lifecycle
    setTimeout(() => {
      emitPiEvent({ type: "message_start" });
      emitPiEvent({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "hi",
        },
      });
      emitPiEvent({
        type: "message_update",
        assistantMessageEvent: {
          type: "done",
          message: {
            usage: { input: 10, output: 5, cost: { total: 0.001 } },
          },
        },
      });
      emitPiEvent({ type: "message_end" });
      emitPiEvent({ type: "agent_end" });
    }, 10);

    for await (const chunk of iter) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(mockAbort).not.toHaveBeenCalled();
  });

  it("abort removes event listener after stream ends", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test-abort",
    });

    const abortController = new AbortController();
    const ctx: RunContext = {
      abortSignal: abortController.signal,
      workdir: "/tmp/test-abort",
    };
    const input: SendMessageInput = {
      sessionId: "sess-cleanup",
      message: "hello",
    };

    const iter = harness.sendMessage(input, ctx);

    // End turn immediately
    setTimeout(() => {
      emitPiEvent({ type: "agent_end" });
    }, 10);

    for await (const _ of iter) {
      // drain
    }

    // Aborting after stream ends should NOT call piSession.abort()
    abortController.abort();
    expect(mockAbort).not.toHaveBeenCalled();
  });
});
