import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

vi.mock("@mariozechner/pi-coding-agent", async () => {
  const actual = await vi.importActual("@mariozechner/pi-coding-agent");
  return {
    ...actual,
    createAgentSession: vi.fn(),
    SessionManager: { inMemory: () => ({}), create: () => ({ getSessionFile: () => null }), open: () => ({ getSessionFile: () => null }) },
    AuthStorage: {
      inMemory: () => ({}),
      create: () => ({}),
    },
    ModelRegistry: {
      inMemory: (auth: unknown) => ({ find: () => undefined }),
      create: (auth: unknown) => ({ find: () => undefined }),
    },
  };
});

import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { createPiCodingAgentHarness } from "../createHarness.js";

const mockedCreate = vi.mocked(createAgentSession);

describe("heartbeat during tool execution", () => {
  let subscriber: ((event: AgentSessionEvent) => void) | null = null;
  let promptResolve: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    subscriber = null;
    promptResolve = null;

    mockedCreate.mockResolvedValue({
      session: {
        subscribe: (fn: (event: AgentSessionEvent) => void) => {
          subscriber = fn;
          return () => { subscriber = null; };
        },
        prompt: () =>
          new Promise<void>((resolve) => {
            promptResolve = resolve;
          }),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function emit(event: AgentSessionEvent) {
    subscriber!(event);
  }

  it("emits data-status heartbeats every 2s during tool execution", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test",
    });

    const ctx = {
      workdir: "/tmp/test",
      abortSignal: new AbortController().signal,
    };

    const collected: any[] = [];
    const iter = harness.sendMessage(
      { sessionId: "s1", message: "test" },
      ctx as any,
    );

    const readLoop = (async () => {
      for await (const chunk of iter) {
        collected.push(chunk);
      }
    })();

    await vi.advanceTimersByTimeAsync(0);

    emit({ type: "tool_execution_start", toolCallId: "tc-1", toolName: "bash", args: {} } as AgentSessionEvent);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    emit({
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "ok" }], details: null },
      isError: false,
    } as AgentSessionEvent);

    emit({ type: "agent_end", messages: [] } as AgentSessionEvent);
    promptResolve!();

    await vi.advanceTimersByTimeAsync(0);
    await readLoop;

    const heartbeats = collected.filter(
      (c: any) => c.type === "data-status" && c.data?.toolCallId === "tc-1",
    );
    expect(heartbeats.length).toBe(3);
    for (const hb of heartbeats) {
      expect(hb.data.elapsedMs).toBeGreaterThan(0);
    }
  }, 15_000);

  it("stops heartbeat when tool ends", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test",
    });

    const ctx = {
      workdir: "/tmp/test",
      abortSignal: new AbortController().signal,
    };

    const collected: any[] = [];
    const iter = harness.sendMessage(
      { sessionId: "s2", message: "test" },
      ctx as any,
    );

    const readLoop = (async () => {
      for await (const chunk of iter) {
        collected.push(chunk);
      }
    })();

    await vi.advanceTimersByTimeAsync(0);

    emit({ type: "tool_execution_start", toolCallId: "tc-2", toolName: "bash", args: {} } as AgentSessionEvent);
    await vi.advanceTimersByTimeAsync(2000);

    const heartbeatCountBeforeEnd = collected.filter(
      (c: any) => c.type === "data-status" && c.data?.toolCallId === "tc-2",
    ).length;
    expect(heartbeatCountBeforeEnd).toBeGreaterThanOrEqual(1);

    emit({
      type: "tool_execution_end",
      toolCallId: "tc-2",
      toolName: "bash",
      result: { content: [{ type: "text", text: "ok" }], details: null },
      isError: false,
    } as AgentSessionEvent);

    await vi.advanceTimersByTimeAsync(4000);

    emit({ type: "agent_end", messages: [] } as AgentSessionEvent);
    promptResolve!();

    await vi.advanceTimersByTimeAsync(0);
    await readLoop;

    const heartbeats = collected.filter(
      (c: any) => c.type === "data-status" && c.data?.toolCallId === "tc-2",
    );
    expect(heartbeats.length).toBe(heartbeatCountBeforeEnd);
  });

  it("stops heartbeat on abort", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/test",
    });

    const abortCtrl = new AbortController();
    const ctx = {
      workdir: "/tmp/test",
      abortSignal: abortCtrl.signal,
    };

    const collected: any[] = [];
    const iter = harness.sendMessage(
      { sessionId: "s3", message: "test" },
      ctx as any,
    );

    const readLoop = (async () => {
      try {
        for await (const chunk of iter) {
          collected.push(chunk);
        }
      } catch {
        // expected abort error
      }
    })();

    await vi.advanceTimersByTimeAsync(0);

    emit({ type: "tool_execution_start", toolCallId: "tc-3", toolName: "bash", args: {} } as AgentSessionEvent);
    await vi.advanceTimersByTimeAsync(2000);

    abortCtrl.abort();
    await vi.advanceTimersByTimeAsync(4000);
    promptResolve!();

    await vi.advanceTimersByTimeAsync(0);
    await readLoop;

    const heartbeats = collected.filter(
      (c: any) => c.type === "data-status" && c.data?.toolCallId === "tc-3",
    );
    expect(heartbeats.length).toBe(1);
  });
});
