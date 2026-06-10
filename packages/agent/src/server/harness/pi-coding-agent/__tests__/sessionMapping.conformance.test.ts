import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiSessionStore } from "../sessions.js";
import { buildPiChatHistory } from "../../../pi-chat/piChatHistory";
import type { BoringChatMessage, BoringChatPart } from "../../../../shared/chat";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "pi-events-corpus.jsonl",
);

const SESSION_ID = "fixture-session-001";

async function loadHistory(tmpDir: string): Promise<BoringChatMessage[]> {
  await cp(FIXTURE_PATH, join(tmpDir, `${SESSION_ID}.jsonl`));
  const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
  const { id, messages } = await store.loadEntries({ workspaceId: "test" }, SESSION_ID);
  return buildPiChatHistory(messages, { sessionId: id });
}

function partsOf(message: BoringChatMessage): BoringChatPart[] {
  return message.parts;
}

// The cold-load path (store entries → buildPiChatHistory) is the SAME canonical
// projection the live event path uses. These assertions pin that the persisted
// transcript recovers the full conversation with the BoringChatMessage shape.
describe("Pi SessionEntry → BoringChatMessage cold-load conformance", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-conform-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("maps all pi message types to BoringChatMessage parts", async () => {
    const msgs = await loadHistory(tmpDir);
    expect(msgs.length).toBeGreaterThanOrEqual(4);

    const userMsgs = msgs.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(2);
    expect((partsOf(userMsgs[0])[0] as Extract<BoringChatPart, { type: "text" }>).text).toBe("List files in /tmp");
    expect((partsOf(userMsgs[1])[0] as Extract<BoringChatPart, { type: "text" }>).text).toBe("Now write hello to a file");

    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);

    const parts = partsOf(assistantMsgs[0]);

    const reasoningPart = parts.find((p) => p.type === "reasoning") as Extract<BoringChatPart, { type: "reasoning" }> | undefined;
    expect(reasoningPart).toBeDefined();
    expect(reasoningPart!.text).toContain("list files");
    expect(reasoningPart!.state).toBe("done");

    const textPart = parts.find((p) => p.type === "text") as Extract<BoringChatPart, { type: "text" }> | undefined;
    expect(textPart).toBeDefined();
    expect(textPart!.text).toContain("list the files");

    const toolPart = parts.find((p) => p.type === "tool-call") as Extract<BoringChatPart, { type: "tool-call" }> | undefined;
    expect(toolPart).toBeDefined();
    expect(toolPart!.toolName).toBe("bash");
    expect(toolPart!.id).toBe("tc-1");
    expect(toolPart!.state).toBe("output-available");
    expect(toolPart!.output).toBeDefined();
  });

  it("maps tool error results to output-error with errorText", async () => {
    const msgs = await loadHistory(tmpDir);
    const writeTool = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) => partsOf(m))
      .find(
        (p): p is Extract<BoringChatPart, { type: "tool-call" }> =>
          p.type === "tool-call" && p.toolName === "write",
      );
    expect(writeTool).toBeDefined();
    expect(writeTool!.state).toBe("output-error");
    expect(writeTool!.errorText).toContain("permission denied");
  });

  // Regression: reloading the browser used to visually duplicate chat history
  // because reconstructed ids were random, so every refresh returned identical
  // content with fresh ids and the client's merge-by-id dedup failed. Ids must
  // be DETERMINISTIC across repeated loads.
  it("returns stable message ids across repeated loads", async () => {
    const first = await loadHistory(tmpDir);
    const second = await loadHistory(tmpDir);

    const firstIds = first.map((m) => m.id);
    const secondIds = second.map((m) => m.id);

    expect(firstIds.length).toBeGreaterThan(0);
    expect(secondIds).toEqual(firstIds);
    expect(firstIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("loads semantic content (texts + tool names) from the corpus fixture", async () => {
    const msgs = await loadHistory(tmpDir);

    const loadedUserTexts = msgs
      .filter((m) => m.role === "user")
      .map((m) => (partsOf(m)[0] as Extract<BoringChatPart, { type: "text" }>).text);

    const loadedAssistantTexts = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        partsOf(m)
          .filter((p): p is Extract<BoringChatPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text),
      );

    const loadedToolNames = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) =>
        partsOf(m)
          .filter((p): p is Extract<BoringChatPart, { type: "tool-call" }> => p.type === "tool-call")
          .map((p) => p.toolName),
      );

    expect(loadedUserTexts).toEqual([
      "List files in /tmp",
      "Now write hello to a file",
    ]);
    expect(loadedAssistantTexts).toContain("I'll list the files for you.");
    expect(loadedAssistantTexts).toContain("The write failed due to a permission error.");
    expect(loadedToolNames).toContain("bash");
    expect(loadedToolNames).toContain("write");
  });

  it("extracts the session title and ignores non-message entry types", async () => {
    await cp(FIXTURE_PATH, join(tmpDir, `${SESSION_ID}.jsonl`));
    const store = new PiSessionStore("/tmp/test-workspace", tmpDir);
    const detail = await store.load({ workspaceId: "test" }, SESSION_ID);
    expect(detail.id).toBe(SESSION_ID);
    expect(detail.title).toBe("File listing chat");
    expect(detail.turnCount).toBe(2);

    const msgs = await loadHistory(tmpDir);
    expect(msgs.length).toBeGreaterThan(0);
  });
});
