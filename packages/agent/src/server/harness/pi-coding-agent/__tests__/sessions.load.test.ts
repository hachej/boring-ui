import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPiChatHistory } from "../../../pi-chat/piChatHistory";
import type { BoringChatMessage, BoringChatPart } from "../../../../shared/chat";

const mockedBuildSessionContext = vi.hoisted(() => vi.fn(() => ({
  messages: [
    { role: "assistant", content: [{ type: "text", text: "[summary] compacted tail only" }] },
  ],
})));

vi.mock("@mariozechner/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-coding-agent")>("@mariozechner/pi-coding-agent");
  return {
    ...actual,
    buildSessionContext: mockedBuildSessionContext,
  };
});

import { PiSessionStore } from "../sessions.js";

// The cold-load surface is now loadEntries() (raw pi messages) → buildPiChatHistory,
// the same projection the live event path uses. These helpers mirror what
// HarnessPiChatService.readPersistedState does.
async function loadHistory(store: PiSessionStore, sessionId: string): Promise<BoringChatMessage[]> {
  const { id, messages } = await store.loadEntries({ workspaceId: "test-ws" }, sessionId);
  return buildPiChatHistory(messages, { sessionId: id });
}

function textOf(message: BoringChatMessage): string {
  return message.parts
    .filter((part): part is Extract<BoringChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

describe("PiSessionStore.loadEntries transcript reconstruction", () => {
  const ctx = { workspaceId: "test-ws" };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-session-load-"));
    mockedBuildSessionContext.mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists and rebuilds a linked Pi transcript only under the Boring session id", async () => {
    const boringSessionId = "boring-session";
    const nativeSessionId = "native-session";
    const nativePath = join(tmpDir, `2026-06-02_${nativeSessionId}.jsonl`);
    const boringPath = join(tmpDir, `${boringSessionId}.jsonl`);
    const nativeLines = [
      {
        type: "session",
        version: 1,
        id: nativeSessionId,
        timestamp: "2026-06-02T00:00:01.000Z",
        cwd: "/workspace",
      },
      {
        type: "message",
        id: "m-user-1",
        parentId: null,
        timestamp: "2026-06-02T00:00:02.000Z",
        message: { role: "user", content: [{ type: "text", text: "linked prompt" }] },
      },
      {
        type: "message",
        id: "m-assistant-1",
        parentId: "m-user-1",
        timestamp: "2026-06-02T00:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "linked answer" }] },
      },
    ];
    const boringLines = [
      {
        type: "session",
        version: 1,
        id: boringSessionId,
        timestamp: "2026-06-02T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "pi_session_file",
        timestamp: "2026-06-02T00:00:03.000Z",
        path: nativePath,
      },
    ];
    await writeFile(nativePath, `${nativeLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    await writeFile(boringPath, `${boringLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const summaries = await store.list(ctx);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual(expect.objectContaining({
      id: boringSessionId,
      title: "linked prompt",
      turnCount: 1,
    }));

    const detail = await store.load(ctx, boringSessionId);
    expect(detail.id).toBe(boringSessionId);
    expect(detail.turnCount).toBe(1);

    const history = await loadHistory(store, boringSessionId);
    expect(history.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(history.map(textOf)).toEqual(["linked prompt", "linked answer"]);

    await store.delete(ctx, boringSessionId);
    await expect(store.list(ctx)).resolves.toEqual([]);
  });

  it("drops empty assistant turns out of the rebuilt history", async () => {
    const sessionId = "sess-empty-assistant";
    const filepath = join(tmpDir, `${sessionId}.jsonl`);
    const lines = [
      {
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: "2026-05-01T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "message",
        id: "m-user-1",
        parentId: null,
        timestamp: "2026-05-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "message",
        id: "m-assistant-empty",
        parentId: "m-user-1",
        timestamp: "2026-05-01T00:00:02.000Z",
        message: { role: "assistant", content: [] },
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const history = await loadHistory(store, sessionId);

    // buildPiChatHistory keeps the empty assistant turn (with no parts) — the
    // canonical live mapping does the same, so the cold path matches it.
    expect(history.map((message) => ({ role: message.role, text: textOf(message) }))).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "" },
    ]);
  });

  it("rebuilds the full transcript from message entries (not the compacted context)", async () => {
    const sessionId = "sess-compacted-no-snapshot";
    const filepath = join(tmpDir, `${sessionId}.jsonl`);
    const lines = [
      {
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: "2026-05-01T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "session_info",
        id: "info-1",
        parentId: null,
        timestamp: "2026-05-01T00:00:00.000Z",
        name: "Compacted session",
      },
      {
        type: "message",
        id: "m-user-1",
        parentId: null,
        timestamp: "2026-05-01T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "first question" }] },
      },
      {
        type: "message",
        id: "m-assistant-1",
        parentId: "m-user-1",
        timestamp: "2026-05-01T00:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
      },
      {
        type: "compaction",
        id: "compact-1",
        parentId: "m-assistant-1",
        timestamp: "2026-05-01T00:01:00.000Z",
        summary: "summary that should not replace transcript on reload",
        firstKeptEntryId: "m-user-2",
        tokensBefore: 1234,
      },
      {
        type: "message",
        id: "m-user-2",
        parentId: "compact-1",
        timestamp: "2026-05-01T00:01:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "second question" }] },
      },
      {
        type: "message",
        id: "m-assistant-2",
        parentId: "m-user-2",
        timestamp: "2026-05-01T00:01:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "second answer" }] },
      },
    ];

    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, sessionId);
    const history = await loadHistory(store, sessionId);

    expect(mockedBuildSessionContext).not.toHaveBeenCalled();
    expect(detail.title).toBe("Compacted session");
    expect(detail.turnCount).toBe(2);
    expect(history.map((message) => ({ role: message.role, text: textOf(message) }))).toEqual([
      { role: "user", text: "first question" },
      { role: "assistant", text: "first answer" },
      { role: "user", text: "second question" },
      { role: "assistant", text: "second answer" },
    ]);
  });

  it("tolerates malformed transcript content while rebuilding", async () => {
    const sessionId = "sess-malformed";
    const filepath = join(tmpDir, `${sessionId}.jsonl`);
    const lines = [
      {
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: "2026-05-01T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "message",
        id: "malformed-user",
        parentId: null,
        timestamp: "2026-05-01T00:00:02.000Z",
        message: {
          role: "user",
          content: [null, { type: "text", text: "fresh prompt" }],
        },
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const history = await loadHistory(store, sessionId);

    expect(history).toHaveLength(1);
    expect(history[0].role).toBe("user");
    expect(textOf(history[0])).toBe("fresh prompt");
  });
});
