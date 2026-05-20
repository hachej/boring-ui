import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createAgentSession, type AgentSession } from "@mariozechner/pi-coding-agent";

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
  SessionManager: { inMemory: () => ({}), create: () => ({ getSessionFile: () => null }), open: () => ({ getSessionFile: () => null }) },
  AuthStorage: {
    inMemory: () => ({}),
    create: () => ({}),
  },
  ModelRegistry: {
    inMemory: (auth: unknown) => ({ find: () => undefined }),
    create: (auth: unknown) => ({ find: () => undefined }),
  },
  // createHarness now always builds a DefaultResourceLoader to inject the
  // workspace-paths system-prompt guideline. Stub the pi-side lookups.
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
import type { RunContext, SendMessageInput } from "../../../../shared/harness.js";

const mockedCreateAgentSession = vi.mocked(createAgentSession);
type CreateAgentSessionResult = Awaited<ReturnType<typeof createAgentSession>>;

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

  it.skipIf(process.platform === "win32")(
    "client abort propagates to pi child process termination",
    async () => {
    let child: ChildProcess | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exitCode: number | null = null;
    const promptAbortController = new AbortController();
    const abortSpy = vi.fn(async () => {
      promptAbortController.abort();
    });

    const session = {
      subscribe(listener: (event: any) => void) {
        mockSubscribers.push(listener);
        return () => {
          const idx = mockSubscribers.indexOf(listener);
          if (idx >= 0) mockSubscribers.splice(idx, 1);
        };
      },
      prompt: async () => {
        child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
          signal: promptAbortController.signal,
        });
        await new Promise<void>((resolve, reject) => {
          child!.once("exit", (code, signal) => {
            exitCode = code;
            exitSignal = signal;
            resolve();
          });
          child!.once("error", (err) => {
            if ((err as Error).name === "AbortError") {
              resolve();
              return;
            }
            reject(err);
          });
        });
      },
      abort: abortSpy,
      dispose: mockDispose,
    } as unknown as AgentSession;

    mockedCreateAgentSession.mockImplementationOnce(async () => ({
      session,
      extensionsResult: {} as CreateAgentSessionResult["extensionsResult"],
    }));

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
      sessionId: "sess-abort-child",
      message: "hello",
    };

    try {
      const iter = harness.sendMessage(input, ctx);
      const pendingRead = iter[Symbol.asyncIterator]().next();

      await vi.waitFor(() => {
        expect(child).not.toBeNull();
        expect(child!.exitCode).toBeNull();
      });

      abortController.abort();

      const abortResult = await pendingRead;
      expect(abortResult.done).toBe(true);

      await vi.waitFor(() => {
        expect(abortSpy).toHaveBeenCalledTimes(1);
        expect(exitSignal).toBe("SIGTERM");
      });
      expect(exitCode).toBeNull();
    } finally {
      const runningChild = child as ChildProcess | null;
      if (runningChild?.exitCode === null) {
        runningChild.kill("SIGKILL");
      }
    }
    },
  );
});
