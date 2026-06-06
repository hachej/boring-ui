import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
  createPiAgentSessionAdapter,
  type PiAgentSessionLike,
} from "../PiAgentSessionAdapter.js";

function createFakeSession(overrides: Partial<PiAgentSessionLike> = {}) {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const unsubscribe = vi.fn((listener: (event: AgentSessionEvent) => void) => {
    listeners.delete(listener);
  });

  const session: PiAgentSessionLike = {
    state: { messages: [{ role: "user", content: "hello" }] },
    messages: [{ role: "user", content: "hello" }],
    isStreaming: true,
    isRetrying: false,
    retryAttempt: 0,
    pendingMessageCount: 2,
    followUpMode: "one-at-a-time",
    sessionId: "pi-session-1",
    sessionName: "Test session",
    getSteeringMessages: vi.fn(() => ["steer later"]),
    getFollowUpMessages: vi.fn(() => ["follow up later"]),
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      listeners.add(listener);
      return () => unsubscribe(listener);
    }),
    prompt: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    clearQueue: vi.fn(() => ({ steering: ["steer later"], followUp: ["follow up later"] })),
    abort: vi.fn(async () => {}),
    abortRetry: vi.fn(),
    ...overrides,
  };

  return {
    session,
    listeners,
    unsubscribe,
    emit(event: AgentSessionEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("PiAgentSessionAdapter", () => {
  it("reads a Pi-session-shaped snapshot without introducing a harness abstraction", () => {
    const { session } = createFakeSession();
    const continueQueuedFollowUp = vi.fn(async () => {});
    const adapter = createPiAgentSessionAdapter(session, { continueQueuedFollowUp });

    expect(adapter.readSnapshot()).toEqual({
      state: { messages: [{ role: "user", content: "hello" }] },
      messages: [{ role: "user", content: "hello" }],
      isStreaming: true,
      isRetrying: false,
      retryAttempt: 0,
      pendingMessageCount: 2,
      steeringMessages: ["steer later"],
      followUpMessages: ["follow up later"],
      followUpMode: "one-at-a-time",
      sessionId: "pi-session-1",
      sessionName: "Test session",
    });
    expect(session.getSteeringMessages).toHaveBeenCalledTimes(1);
    expect(session.getFollowUpMessages).toHaveBeenCalledTimes(1);
  });

  it("can expose a browser-visible session id when Pi uses a linked native session file", () => {
    const { session } = createFakeSession({ sessionId: "native-pi-session" });
    const adapter = createPiAgentSessionAdapter(session, { sessionId: "boring-session" });

    expect(adapter.readSnapshot().sessionId).toBe("boring-session");
  });

  it("subscribes through Pi and returns Pi's unsubscribe function", () => {
    const { session, emit, unsubscribe, listeners } = createFakeSession();
    const adapter = createPiAgentSessionAdapter(session);
    const seen: AgentSessionEvent[] = [];

    const off = adapter.subscribe((event) => seen.push(event));
    const event = { type: "queue_update" } as AgentSessionEvent;
    emit(event);

    expect(session.subscribe).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([event]);
    expect(listeners.size).toBe(1);

    off();
    emit({ type: "agent_end", messages: [], willRetry: false } as AgentSessionEvent);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(seen).toEqual([event]);
  });

  it("forwards prompt text and prompt options to Pi", async () => {
    const { session } = createFakeSession();
    const adapter = createPiAgentSessionAdapter(session);

    await adapter.prompt("hello");
    await adapter.prompt({ text: "with options", options: { expandPromptTemplates: false } });

    expect(session.prompt).toHaveBeenNthCalledWith(1, "hello", undefined);
    expect(session.prompt).toHaveBeenNthCalledWith(2, "with options", { expandPromptTemplates: false });
  });

  it("forwards followUp, clearQueue, abort, abortRetry, and queued continuation to Pi", async () => {
    const { session } = createFakeSession();
    const continueQueuedFollowUp = vi.fn(async () => {});
    const adapter = createPiAgentSessionAdapter(session, { continueQueuedFollowUp });

    await adapter.followUp("next question");
    const cleared = adapter.clearQueue();
    await adapter.abort();
    adapter.abortRetry?.();
    await adapter.continueQueuedFollowUp?.();

    expect(session.followUp).toHaveBeenCalledWith("next question");
    expect(session.clearQueue).toHaveBeenCalledTimes(1);
    expect(cleared).toEqual({ steering: ["steer later"], followUp: ["follow up later"] });
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.abortRetry).toHaveBeenCalledTimes(1);
    expect(continueQueuedFollowUp).toHaveBeenCalledTimes(1);
  });

  it("omits abortRetry when the installed Pi session does not expose it", () => {
    const { session } = createFakeSession({ abortRetry: undefined });
    const adapter = createPiAgentSessionAdapter(session);

    expect(adapter.abortRetry).toBeUndefined();
  });

  it("omits queued continuation when no adapter option supplies it", () => {
    const { session } = createFakeSession();
    const adapter = createPiAgentSessionAdapter(session);

    expect(adapter.continueQueuedFollowUp).toBeUndefined();
  });
});
