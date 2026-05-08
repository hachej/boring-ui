import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  mockSubscribers,
  promptHandle,
  promptCalls,
} = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  // Tracks every prompt() call's arguments so tests can assert multi-turn sequencing.
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
    create: () => ({ find: vi.fn(), getAvailable: () => [] }),
  },
}));

import { createPiCodingAgentHarness } from "../createHarness.js";
import type { RunContext, SendMessageInput } from "../../../../shared/harness.js";

function emit(event: any): void {
  for (const sub of mockSubscribers) sub(event);
}

function makeCtx(ac = new AbortController()): RunContext {
  return { abortSignal: ac.signal, workdir: "/tmp/test-followup" };
}

/** Drain the iterator until it closes, returning all chunks. */
async function drain(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

async function waitForPromptCallCount(count: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (promptCalls.length >= count) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  promptHandle.resolve = undefined;
  promptCalls.length = 0;
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe("followUp: server-side multi-turn streaming", () => {
  it("emits data-followup-consumed and starts a second turn inline without replaying duplicate start ids", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup" });
    const input: SendMessageInput = { sessionId: "sess-fu-1", message: "first" };
    const iter = harness.sendMessage(input, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    // Let the generator boot and register its subscriber.
    const r1 = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    emit({ type: "message_start", message: { id: "same-pi-message-id" } });
    const firstStart = await r1; // consume message_start chunk
    expect((firstStart.value as any).type).toBe("start");
    expect((firstStart.value as any).messageId).toBe("same-pi-message-id");

    // Queue a follow-up while the turn is still in flight.
    harness.followUp!("sess-fu-1", "second");

    // End the first turn. The subscriber sets pendingFollowUpMsg.
    emit({ type: "agent_end" });

    // Collect the data-followup-consumed chunk that arrives immediately.
    const fuChunk = await reader.next();
    expect((fuChunk.value as any).type).toBe("data-followup-consumed");

    // The stream must still be open (not done yet).
    expect(fuChunk.done).toBe(false);

    // Resolve the first prompt() so startTurn() .then() fires and calls
    // prompt("second") — this is the critical deferred call.
    promptHandle.resolve!();
    await new Promise((r) => setTimeout(r, 5));

    // The second prompt() should have been called with the queued message.
    expect(promptCalls.map((c) => c.message)).toEqual(["first", "second"]);

    // Now run the second turn to completion.
    emit({ type: "message_start", message: { id: "same-pi-message-id" } });
    emit({ type: "agent_end" });
    promptHandle.resolve!();

    // Drain remaining chunks — iterator must close.
    const remaining: unknown[] = [];
    for (;;) {
      const { value, done } = await reader.next();
      if (done) break;
      remaining.push(value);
    }

    // Both prompt() calls happened, but the duplicate pi message_start id was
    // not re-emitted into the single AI SDK stream.
    expect(promptCalls).toHaveLength(2);
    expect(remaining.map((c) => (c as any).type)).not.toContain("start");
  });

  it("passes follow-up image attachments to vision and saves them to the workspace", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "followup-attachment-"));
    try {
      const harness = createPiCodingAgentHarness({ tools: [], cwd: workdir });
      const iter = harness.sendMessage(
        { sessionId: "sess-fu-img", message: "first" },
        { abortSignal: new AbortController().signal, workdir },
      );
      const reader = iter[Symbol.asyncIterator]();

      const boot = reader.next();
      await new Promise((r) => setTimeout(r, 5));
      emit({ type: "message_start" });
      await boot;

      harness.followUp!("sess-fu-img", "can you read this", [
        {
          filename: "grafik.png",
          mediaType: "image/png",
          url: "data:image/png;base64,aGVsbG8=",
        },
      ]);

      emit({ type: "agent_end" });
      const fuChunk = await reader.next();
      expect((fuChunk.value as any).type).toBe("data-followup-consumed");

      promptHandle.resolve!();
      await waitForPromptCallCount(2);

      expect(promptCalls).toHaveLength(2);
      const second = promptCalls[1];
      expect(second.opts?.images).toEqual([
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
      ]);
      expect(second.message).toContain("Attached file(s) saved to workspace");
      const savedPath = second.message.match(/- (assets\/images\/grafik-[^\n]+\.png)/)?.[1];
      expect(savedPath).toBeTruthy();
      await expect(readFile(join(workdir, savedPath!), "utf8")).resolves.toBe("hello");

      emit({ type: "agent_end" });
      promptHandle.resolve!();
      await reader.return?.();
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("does NOT set done=true at first agent_end when follow-up is queued", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-nodone" });
    const iter = harness.sendMessage({ sessionId: "sess-fu-nodone", message: "m1" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));

    harness.followUp!("sess-fu-nodone", "m2");

    emit({ type: "message_start" });
    await boot;
    emit({ type: "agent_end" });

    // Should yield the consumed sentinel, NOT close.
    const { value, done: isDone } = await reader.next();
    expect((value as any).type).toBe("data-followup-consumed");
    expect(isDone).toBe(false);

    // Clean up.
    promptHandle.resolve!();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "agent_end" });
    promptHandle.resolve!();
    await reader.return?.();
  });
});

// ─── clearFollowUp ────────────────────────────────────────────────────────────

describe("clearFollowUp: discards queued message", () => {
  it("prevents follow-up from being sent when cleared before agent_end", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-clear" });
    const iter = harness.sendMessage({ sessionId: "sess-clear-1", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start" });
    await boot;

    // Queue then immediately clear.
    harness.followUp!("sess-clear-1", "should-not-send");
    harness.clearFollowUp!("sess-clear-1");

    emit({ type: "agent_end" });
    promptHandle.resolve!();

    // Stream should close normally with no data-followup-consumed chunk.
    const chunks = await drain(iter);
    const types = chunks.map((c) => (c as any).type);
    expect(types).not.toContain("data-followup-consumed");

    // prompt() was only called once.
    expect(promptCalls.map((c) => c.message)).toEqual(["first"]);
  });

  it("does not send follow-up if cleared after queue but before agent_end", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-clear2" });
    const iter = harness.sendMessage({ sessionId: "sess-clear-2", message: "first" }, makeCtx());
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start" });
    await boot;

    harness.followUp!("sess-clear-2", "also-should-not-send");

    // Clear BEFORE the turn ends (stop-button path: stop + clearFollowUp).
    harness.clearFollowUp!("sess-clear-2");

    emit({ type: "agent_end" });
    promptHandle.resolve!();

    const chunks = await drain(iter);
    expect(chunks.map((c) => (c as any).type)).not.toContain("data-followup-consumed");
    expect(promptCalls).toHaveLength(1);
  });
});

// ─── new sendMessage clears stale queue (Escape path) ────────────────────────

describe("new sendMessage clears stale server queue", () => {
  it("discards a queued follow-up when sendMessage is called again on the same session", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-escape" });
    const ctx = makeCtx();

    // First turn.
    const iter1 = harness.sendMessage({ sessionId: "sess-escape", message: "first" }, ctx);
    const reader1 = iter1[Symbol.asyncIterator]();
    const boot1 = reader1.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start" });
    await boot1;
    emit({ type: "agent_end" });
    promptHandle.resolve!();
    await drain(iter1);

    // Queue a follow-up for the (now-closed) session.
    harness.followUp!("sess-escape", "stale-follow-up");

    // Start a new turn — this should clear the queue.
    const iter2 = harness.sendMessage({ sessionId: "sess-escape", message: "fresh" }, makeCtx());
    const reader2 = iter2[Symbol.asyncIterator]();
    const boot2 = reader2.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start" });
    await boot2;
    emit({ type: "agent_end" });
    promptHandle.resolve!();
    const chunks2 = await drain(iter2);

    // No data-followup-consumed: stale queue was discarded.
    expect(chunks2.map((c) => (c as any).type)).not.toContain("data-followup-consumed");
    // Only ["first", "fresh"] — "stale-follow-up" never got sent.
    expect(promptCalls.map((c) => c.message)).toEqual(["first", "fresh"]);
  });
});

// ─── abort signal suppresses follow-up ───────────────────────────────────────

describe("abort suppresses follow-up", () => {
  it("does not start a second turn when the abort signal fires before agent_end", async () => {
    const harness = createPiCodingAgentHarness({ tools: [], cwd: "/tmp/test-followup-abort" });
    const ac = new AbortController();
    const iter = harness.sendMessage(
      { sessionId: "sess-abort-fu", message: "first" },
      makeCtx(ac),
    );
    const reader = iter[Symbol.asyncIterator]();

    const boot = reader.next();
    await new Promise((r) => setTimeout(r, 5));
    emit({ type: "message_start" });
    await boot;

    // Queue follow-up.
    harness.followUp!("sess-abort-fu", "should-not-run");

    // Abort the stream before agent_end fires.
    ac.abort();

    // Emit agent_end: the subscriber checks abortSignal.aborted → skips follow-up.
    emit({ type: "agent_end" });
    promptHandle.resolve!();

    const chunks = await drain(iter);
    expect(chunks.map((c) => (c as any).type)).not.toContain("data-followup-consumed");
    // Only the first prompt() call happened.
    expect(promptCalls.map((c) => c.message)).toEqual(["first"]);
  });
});
