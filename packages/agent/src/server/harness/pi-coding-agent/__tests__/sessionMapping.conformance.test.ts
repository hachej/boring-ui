import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiSessionStore } from "../sessions.js";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "pi-events-corpus.jsonl",
);

describe("Pi SessionEntry → UIMessage conformance", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-conform-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("PiSessionStore.load() maps all pi message types to UIMessages", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    expect(detail.id).toBe("fixture-session-001");
    expect(detail.title).toBe("File listing chat");

    const msgs = detail.messages;
    expect(msgs.length).toBeGreaterThanOrEqual(4);

    const userMsgs = msgs.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(2);
    expect((userMsgs[0].parts[0] as any).text).toBe("List files in /tmp");
    expect((userMsgs[1].parts[0] as any).text).toBe(
      "Now write hello to a file",
    );

    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);

    const firstAssistant = assistantMsgs[0];
    const parts = firstAssistant.parts as any[];

    const reasoningPart = parts.find((p) => p.type === "reasoning");
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart.text).toContain("list files");
    expect(reasoningPart.state).toBe("done");

    const textPart = parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    expect(textPart.text).toContain("list the files");

    const toolPart = parts.find((p) => p.type === "tool-bash");
    expect(toolPart).toBeDefined();
    expect(toolPart.toolName).toBe("bash");
    expect(toolPart.toolCallId).toBe("tc-1");
    expect(toolPart.state).toBe("output-available");
    expect(toolPart.output).toBeDefined();

    expect(detail.turnCount).toBe(2);
  });

  it("tool error results map to output-error state", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    const assistantMsgs = detail.messages.filter(
      (m) => m.role === "assistant",
    );
    const writeAssistant = assistantMsgs.find((m) =>
      (m.parts as any[]).some(
        (p) => p.type === "tool-write" && p.toolName === "write",
      ),
    );
    expect(writeAssistant).toBeDefined();

    const writeTool = (writeAssistant!.parts as any[]).find(
      (p) => p.type === "tool-write" && p.toolName === "write",
    );
    expect(writeTool.state).toBe("output-error");
    expect(writeTool.errorText).toContain("permission denied");
  });

  // Regression: reloading the browser used to visually duplicate chat history
  // because reconstructed UIMessage ids were generated with randomUUID(), so
  // every GET /messages returned identical content with fresh ids. The client
  // dedups by id, so unstable ids defeated dedup and the history stacked on
  // each reload. Reconstructed ids must be DETERMINISTIC across loads.
  it("PiSessionStore.load() returns stable message ids across repeated loads", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const first = await store.load({ workspaceId: "test" }, "fixture-session-001");
    const second = await store.load({ workspaceId: "test" }, "fixture-session-001");

    const firstIds = first.messages.map((m) => m.id);
    const secondIds = second.messages.map((m) => m.id);

    // Sanity: there are real reconstructed messages to compare.
    expect(firstIds.length).toBeGreaterThan(0);
    // Ids must be identical between the two independent loads.
    expect(secondIds).toEqual(firstIds);
    // And every id must be defined/non-empty (no accidental undefined).
    expect(firstIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("loads semantic content (texts + tool names) from the corpus fixture", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    const loadedUserTexts = detail.messages
      .filter((m) => m.role === "user")
      .map((m) => (m.parts[0] as any).text);

    const loadedAssistantTexts = detail.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        (m.parts as any[])
          .filter((p) => p.type === "text")
          .map((p) => p.text),
      );

    const loadedToolNames = detail.messages
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        (m.parts as any[])
          .filter((p) => typeof p.type === "string" && p.type.startsWith("tool-"))
          .map((p) => p.toolName),
      );

    expect(loadedUserTexts).toEqual([
      "List files in /tmp",
      "Now write hello to a file",
    ]);
    expect(loadedAssistantTexts).toContain(
      "I'll list the files for you.",
    );
    expect(loadedAssistantTexts).toContain(
      "The write failed due to a permission error.",
    );
    expect(loadedToolNames).toContain("bash");
    expect(loadedToolNames).toContain("write");
  });


  it("non-message entry types are preserved without crashing", async () => {
    await cp(
      FIXTURE_PATH,
      join(tmpDir, "fixture-session-001.jsonl"),
    );

    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load(
      { workspaceId: "test" },
      "fixture-session-001",
    );

    expect(detail.messages.length).toBeGreaterThan(0);
    expect(detail.title).toBe("File listing chat");
  });
});
