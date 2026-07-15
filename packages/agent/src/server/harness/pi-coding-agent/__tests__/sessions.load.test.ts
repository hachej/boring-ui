import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readdir, rm, writeFile, readFile, stat } from "node:fs/promises";
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
import { SessionManager } from "@mariozechner/pi-coding-agent";

// The cold-load surface is now loadEntries() (raw pi messages) → buildPiChatHistory,
// the same projection the live event path uses. These helpers mirror what
// HarnessPiChatService.readPersistedState does.
async function loadHistory(store: PiSessionStore, sessionId: string): Promise<BoringChatMessage[]> {
  const { id, messages } = await store.loadEntries({ workspaceId: "default" }, sessionId);
  return buildPiChatHistory(messages, { sessionId: id });
}

function textOf(message: BoringChatMessage): string {
  return message.parts
    .filter((part): part is Extract<BoringChatPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

describe("PiSessionStore.loadEntries transcript reconstruction", () => {
  const ctx = { workspaceId: "default" };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-session-load-"));
    mockedBuildSessionContext.mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("admits, lists, and loads a bare native transcript in unnamespaced direct/local storage", async () => {
    const store = new PiSessionStore("/workspace", {
      sessionRoot: tmpDir,
      storageCwd: "/direct-local-workspace",
      allowNativeUnscopedAccess: true,
    });
    const nativeDir = store.getSessionDir();
    const manager = SessionManager.create("/workspace", nativeDir);
    const nativeSessionId = manager.getSessionId();
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "first native prompt" }] } as never);
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "first native reply" }] } as never);

    await expect(store.list(ctx)).resolves.toEqual([
      expect.objectContaining({
        id: nativeSessionId,
        nativeSessionId,
        hasAssistantReply: true,
        turnCount: 1,
      }),
    ]);
    expect(await readdir(nativeDir)).toHaveLength(1);

    await expect(store.rename(ctx, nativeSessionId, "Native title")).resolves.toMatchObject({
      id: nativeSessionId,
      title: "Native title",
      nativeSessionId,
    });
    const files = await readdir(nativeDir);
    expect(files).toHaveLength(1);
    const content = await readFile(join(nativeDir, files[0]!), "utf-8");
    expect(content).toContain('"type":"session_info"');
    expect(content).toContain('"name":"Native title"');
    expect(content).not.toContain("pi_session_file");
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

  it("serves historical image attachment bytes from the raw transcript without requiring /state to inline them", async () => {
    const sessionId = "sess-image-history";
    const filepath = join(tmpDir, `${sessionId}.jsonl`);
    const imageBase64 = Buffer.from("tiny-png-bytes").toString("base64");
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
        id: "m-user-image",
        parentId: null,
        timestamp: "2026-05-01T00:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "attached" },
            { type: "image", mimeType: "image/png", filename: "image.png", data: imageBase64 },
          ],
        },
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const { id, messages } = await store.loadEntries(ctx, sessionId);
    const history = buildPiChatHistory(messages, {
      sessionId: id,
      attachmentUrl: ({ messageId, index }) => `/api/v1/agent/pi-chat/${id}/attachments/${messageId}/${index}`,
    });
    const attachment = await store.loadAttachment(ctx, sessionId, "m-user-image", 1);

    expect(history[0].id).toBe("m-user-image");
    expect(history[0].parts).toEqual([
      { type: "text", id: "m-user-image:text:0", text: "attached" },
      { type: "file", id: "m-user-image:file:1", filename: "image.png", mediaType: "image/png", url: `/api/v1/agent/pi-chat/${sessionId}/attachments/m-user-image/1` },
    ]);
    expect(attachment.mediaType).toBe("image/png");
    expect(attachment.filename).toBe("image.png");
    expect(Buffer.from(attachment.data).toString()).toBe("tiny-png-bytes");
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

  it("compacts legacy ui_snapshot bloat out of the file on first load (repair-on-read)", async () => {
    const sessionId = "sess-legacy-bloat";
    const filepath = join(tmpDir, `${sessionId}.jsonl`);

    // Simulate a pre-#227 session: session header + session_info + many huge ui_snapshots
    // (each snapshot is a full transcript copy — 60 of them could reach 90 MB in production)
    const hugeSnapshotMessages = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i}`, role: "user", parts: [{ type: "text", text: `q${i}`.repeat(500) }],
    }));
    const lines = [
      { type: "session", version: 1, id: sessionId, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/workspace" },
      { type: "session_info", id: "info-1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", name: "Legacy session" },
      { type: "message", id: "m-u1", parentId: null, timestamp: "2026-01-01T00:00:02.000Z",
        message: { role: "user", content: [{ type: "text", text: "real question" }] } },
      { type: "message", id: "m-a1", parentId: "m-u1", timestamp: "2026-01-01T00:00:03.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "real answer" }] } },
      // Ten legacy snapshots (each containing the full message list, potentially huge)
      ...Array.from({ length: 10 }, (_, i) => ({
        type: "ui_snapshot", id: `snap-${i}`, timestamp: "2026-01-01T00:01:00.000Z",
        messages: hugeSnapshotMessages,
      })),
    ];
    const originalContent = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    await writeFile(filepath, originalContent, "utf-8");

    const sizeBefore = (await stat(filepath)).size;
    const store = new PiSessionStore("/workspace", tmpDir);

    // loadEntries triggers resolveSessionTranscript which should compact the file
    const { messages } = await store.loadEntries(ctx, sessionId);
    const history = buildPiChatHistory(messages, { sessionId });

    // Messages are intact after compaction
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(textOf(history[0])).toBe("real question");

    // The file was compacted — ui_snapshot records stripped
    const compactedContent = await readFile(filepath, "utf-8");
    const snapshotCount = compactedContent
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => { try { return (JSON.parse(l) as { type?: string }).type === "ui_snapshot" } catch { return false } })
      .length;
    expect(snapshotCount).toBe(0);
    expect((await stat(filepath)).size).toBeLessThan(sizeBefore / 2);

    // Non-snapshot records (session_info) survive
    const detail = await store.load(ctx, sessionId);
    expect(detail.title).toBe("Legacy session");
  });
});
