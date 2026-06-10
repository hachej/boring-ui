import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSubscribers, promptCalls, mockSessions } = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
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
        return Promise.resolve();
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

function makeCtx(ac = new AbortController()): RunContext {
  return { abortSignal: ac.signal, workdir: "/tmp/test-followup" };
}

// Creates the harness and registers a live pi session handle the way the
// pi-chat service does: through getPiSessionAdapter (sessions are created
// lazily; followUp requires the handle to exist).
async function makeHarnessWithSession(sessionId: string) {
  const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
  await harness.getPiSessionAdapter({ sessionId, message: "" }, makeCtx());
  return harness;
}

function simulatePiConsumes(session: any): void {
  session.agent.followUpQueue.messages.shift();
  session._followUpMessages.shift();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  promptCalls.length = 0;
  mockSessions.length = 0;
});

describe("native pi follow-up integration", () => {
  it("queues follow-up through pi's native followUp API", async () => {
    const harness = await makeHarnessWithSession("sess-native");

    await harness.followUp!("sess-native", "second visible");

    expect(promptCalls.map((c) => c.message)).toEqual(["second visible"]);
    expect(promptCalls[0]?.opts).toMatchObject({ nativeFollowUp: true });
  });

  it("dedupes repeated queued follow-up posts with the same nonce", async () => {
    const harness = await makeHarnessWithSession("sess-dedupe");

    await harness.followUp!("sess-dedupe", "same nonce", undefined, "same nonce", { clientNonce: "nonce-dedupe", clientSeq: 1 });
    await harness.followUp!("sess-dedupe", "same nonce", undefined, "same nonce", { clientNonce: "nonce-dedupe", clientSeq: 1 });

    expect(promptCalls.map((c) => c.message)).toEqual(["same nonce"]);
    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["same nonce"]);
  });

  it("does not dedupe distinct nonces that reuse a client sequence", async () => {
    const harness = await makeHarnessWithSession("sess-seq-reuse");

    await harness.followUp!("sess-seq-reuse", "first seq", undefined, "first seq", { clientNonce: "nonce-seq-a", clientSeq: 1 });
    await harness.followUp!("sess-seq-reuse", "second seq", undefined, "second seq", { clientNonce: "nonce-seq-b", clientSeq: 1 });

    expect(promptCalls.map((c) => c.message)).toEqual(["first seq", "second seq"]);
    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["first seq", "second seq"]);
  });

  it("dedupes a repeated follow-up post after pi consumes the first copy", async () => {
    const harness = await makeHarnessWithSession("sess-consumed-dedupe");

    await harness.followUp!("sess-consumed-dedupe", "same consumed nonce", undefined, "same consumed nonce", { clientNonce: "nonce-consumed", clientSeq: 1 });
    simulatePiConsumes(mockSessions[0]);

    await harness.followUp!("sess-consumed-dedupe", "same consumed nonce", undefined, "same consumed nonce", { clientNonce: "nonce-consumed", clientSeq: 1 });

    // seen nonces survive consumption until the turn/session boundary, so the
    // retried post is dropped instead of double-queueing.
    expect(promptCalls.map((c) => c.message)).toEqual(["same consumed nonce"]);
    expect(mockSessions[0].agent.followUpQueue.messages).toEqual([]);
  });

  it("can delete a queued follow-up before pi drains it", async () => {
    const harness = await makeHarnessWithSession("sess-delete");

    await harness.followUp!("sess-delete", "delete me", undefined, "delete me", { clientNonce: "nonce-delete", clientSeq: 1 });
    harness.clearFollowUp!("sess-delete", { clientNonce: "nonce-delete" });

    expect(promptCalls.map((c) => c.message)).toEqual(["delete me"]);
    expect(mockSessions[0].agent.followUpQueue.messages).toEqual([]);
    expect(mockSessions[0]._followUpMessages).toEqual([]);
  });

  it("deleting one duplicate-text follow-up leaves the other queued", async () => {
    const harness = await makeHarnessWithSession("sess-delete-dupe");

    await harness.followUp!("sess-delete-dupe", "same text", undefined, "same text", { clientNonce: "nonce-1", clientSeq: 1 });
    await harness.followUp!("sess-delete-dupe", "same text", undefined, "same text", { clientNonce: "nonce-2", clientSeq: 2 });
    harness.clearFollowUp!("sess-delete-dupe", { clientNonce: "nonce-2" });

    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["same text"]);
    expect(mockSessions[0]._followUpMessages).toEqual(["same text"]);
  });

  it("deletes the remaining duplicate-text follow-up after pi consumes the first one", async () => {
    const harness = await makeHarnessWithSession("sess-delete-dupe-consumed");

    await harness.followUp!("sess-delete-dupe-consumed", "same text", undefined, "same text", { clientNonce: "nonce-1", clientSeq: 1 });
    await harness.followUp!("sess-delete-dupe-consumed", "same text", undefined, "same text", { clientNonce: "nonce-2", clientSeq: 2 });

    simulatePiConsumes(mockSessions[0]);

    harness.clearFollowUp!("sess-delete-dupe-consumed", { clientNonce: "nonce-2" });

    expect(mockSessions[0].agent.followUpQueue.messages).toEqual([]);
    expect(mockSessions[0]._followUpMessages).toEqual([]);
  });

  it("prefers clientNonce over colliding clientSeq when deleting a queued follow-up", async () => {
    const harness = await makeHarnessWithSession("sess-delete-seq-collision");

    await harness.followUp!("sess-delete-seq-collision", "keep me", undefined, "keep me", { clientNonce: "nonce-1", clientSeq: 1 });
    await harness.followUp!("sess-delete-seq-collision", "delete me", undefined, "delete me", { clientNonce: "nonce-2", clientSeq: 1 });
    harness.clearFollowUp!("sess-delete-seq-collision", { clientNonce: "nonce-2", clientSeq: 1 });

    expect(mockSessions[0].agent.followUpQueue.messages.map((msg: any) => msg.content[0].text)).toEqual(["keep me"]);
    expect(mockSessions[0]._followUpMessages).toEqual(["keep me"]);
  });
});
