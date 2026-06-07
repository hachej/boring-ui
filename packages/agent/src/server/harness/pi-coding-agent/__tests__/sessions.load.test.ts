import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

describe("PiSessionStore.load fallback transcript reconstruction", () => {
  const ctx = { workspaceId: "test-ws" };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-session-load-"));
    mockedBuildSessionContext.mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists a linked Pi transcript only under the Boring session id", async () => {
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
        id: "m-assistant-empty",
        parentId: "m-user-1",
        timestamp: "2026-06-02T00:00:03.000Z",
        message: { role: "assistant", content: [] },
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
      {
        type: "ui_snapshot",
        id: "snapshot-1",
        timestamp: "2026-06-02T00:00:04.000Z",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "linked prompt" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "same answer", state: "done" }] },
          { id: "assistant-123", role: "assistant", parts: [{ type: "reasoning", text: "" }, { type: "text", text: "same answer" }] },
        ],
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
    expect(detail.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(detail.messages.filter((message) => message.role === "assistant")).toHaveLength(1);

    await store.delete(ctx, boringSessionId);
    await expect(store.list(ctx)).resolves.toEqual([]);
  });

  it("sanitizes duplicate users and repeated assistant text in ui snapshots", async () => {
    const sessionId = "sess-poisoned-ui-snapshot";
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
        type: "ui_snapshot",
        id: "snapshot-1",
        timestamp: "2026-05-01T00:00:01.000Z",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "wait10s before response" }] },
          { id: "a-tool", role: "assistant", parts: [{ type: "tool-bash", state: "output-available", input: {}, output: [] }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "donedone" }, { type: "text", text: "done" }] },
          { id: "user-1780472366061", role: "user", parts: [{ type: "text", text: "wait10s before response" }] },
        ],
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, sessionId);

    expect(detail.messages.map((message) => ({
      role: message.role,
      text: message.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join(""),
    }))).toEqual([
      { role: "user", text: "wait10s before response" },
      { role: "assistant", text: "" },
      { role: "assistant", text: "done" },
    ]);
  });

  it("ignores stale ui snapshots when the linked transcript has newer messages", async () => {
    const boringSessionId = "boring-stale-snapshot";
    const nativeSessionId = "native-fresh-transcript";
    const nativePath = join(tmpDir, `2026-06-03_${nativeSessionId}.jsonl`);
    const boringPath = join(tmpDir, `${boringSessionId}.jsonl`);
    const nativeLines = [
      {
        type: "session",
        version: 1,
        id: nativeSessionId,
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "message",
        id: "fresh-user",
        parentId: null,
        timestamp: "2026-06-03T00:00:05.000Z",
        message: { role: "user", content: [{ type: "text", text: "fresh prompt" }] },
      },
    ];
    const boringLines = [
      {
        type: "session",
        version: 1,
        id: boringSessionId,
        timestamp: "2026-06-03T00:00:00.000Z",
        cwd: "/workspace",
      },
      {
        type: "pi_session_file",
        timestamp: "2026-06-03T00:00:01.000Z",
        path: nativePath,
      },
      {
        type: "ui_snapshot",
        id: "stale-snapshot",
        timestamp: "2026-06-03T00:00:02.000Z",
        messages: [
          { id: "stale-user", role: "user", parts: [{ type: "text", text: "stale prompt" }] },
        ],
      },
    ];
    await writeFile(nativePath, `${nativeLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    await writeFile(boringPath, `${boringLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, boringSessionId);

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].id).toBe(`${boringSessionId}-user-0`);
    expect(detail.messages[0].parts).toEqual([{ type: "text", text: "fresh prompt" }]);
  });

  it("uses current ui snapshots without reconstructing malformed transcript messages", async () => {
    const sessionId = "sess-current-snapshot";
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
        timestamp: "2026-05-01T00:00:01.000Z",
        message: {
          role: "user",
          content: [null],
        },
      },
      {
        type: "ui_snapshot",
        id: "snapshot-current",
        timestamp: "2026-05-01T00:00:02.000Z",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "snapshot prompt" }] },
        ],
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, sessionId);

    expect(detail.messages).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "snapshot prompt" }] },
    ]);
  });

  it("reconstructs stale snapshots while skipping malformed transcript parts", async () => {
    const sessionId = "sess-stale-snapshot-malformed";
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
        type: "ui_snapshot",
        id: "snapshot-stale",
        timestamp: "2026-05-01T00:00:01.000Z",
        messages: [
          { id: "stale", role: "user", parts: [{ type: "text", text: "stale prompt" }] },
        ],
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
    const detail = await store.load(ctx, sessionId);

    expect(detail.messages).toEqual([
      { id: `${sessionId}-user-0`, role: "user", parts: [{ type: "text", text: "fresh prompt" }] },
    ]);
  });

  it("uses current ui snapshots already stored in raw timestamp-named native sessions", async () => {
    const sessionId = "native-snapshot";
    const filepath = join(tmpDir, `2026-06-04T15-23-19-668Z_${sessionId}.jsonl`);
    const lines = [
      {
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: "2026-06-04T15:23:19.668Z",
        cwd: "/workspace",
      },
      {
        type: "message",
        id: "native-user",
        parentId: null,
        timestamp: "2026-06-04T15:23:20.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "raw prompt" }],
        },
      },
      {
        type: "ui_snapshot",
        id: "native-snapshot-current",
        timestamp: "2026-06-04T15:23:21.000Z",
        messages: [
          { id: "snapshot-user", role: "user", parts: [{ type: "text", text: "snapshot prompt" }] },
        ],
      },
    ];
    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, sessionId);

    expect(detail.messages).toEqual([
      { id: "snapshot-user", role: "user", parts: [{ type: "text", text: "snapshot prompt" }] },
    ]);
  });

  it("rebuilds the full transcript from message entries when no ui snapshot exists", async () => {
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
        message: {
          role: "user",
          content: [{ type: "text", text: "first question" }],
        },
      },
      {
        type: "message",
        id: "m-assistant-1",
        parentId: "m-user-1",
        timestamp: "2026-05-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
        },
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
        message: {
          role: "user",
          content: [{ type: "text", text: "second question" }],
        },
      },
      {
        type: "message",
        id: "m-assistant-2",
        parentId: "m-user-2",
        timestamp: "2026-05-01T00:01:02.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "second answer" }],
        },
      },
    ];

    await writeFile(filepath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/workspace", tmpDir);
    const detail = await store.load(ctx, sessionId);

    expect(mockedBuildSessionContext).not.toHaveBeenCalled();
    expect(detail.title).toBe("Compacted session");
    expect(detail.turnCount).toBe(2);
    expect(detail.messages.map((message) => ({
      role: message.role,
      text: message.parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text)
        .join(" "),
    }))).toEqual([
      { role: "user", text: "first question" },
      { role: "assistant", text: "first answer" },
      { role: "user", text: "second question" },
      { role: "assistant", text: "second answer" },
    ]);
  });
});
