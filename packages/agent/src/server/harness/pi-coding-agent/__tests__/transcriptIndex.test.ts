import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { mapWithConcurrency, TranscriptIndex } from "../transcriptIndex.js";

describe("TranscriptIndex", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("projects oversized and malformed JSONL records without retaining their payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-transcript-index-"));
    directories.push(directory);
    const filepath = join(directory, "2026-06-04_native-large.jsonl");
    const oversizedMalformed = `{"type":"message","message":{"role":"assistant","content":"${"x".repeat(2 * 1024 * 1024)}`;
    await writeFile(filepath, [
      JSON.stringify({ type: "session", version: 1, id: "native-large", timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      oversizedMalformed,
      JSON.stringify({
        type: "message", id: "user", timestamp: "2026-06-04T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "recovered prompt" }] },
      }),
      JSON.stringify({
        type: "message", id: "assistant", timestamp: "2026-06-04T00:00:02.000Z",
        message: { role: "assistant", content: "reply" },
      }),
      "",
    ].join("\n"), "utf-8");

    const index = new TranscriptIndex();
    const fileStat = await stat(filepath);
    await expect(index.activity(filepath, fileStat)).resolves.toEqual({
      latestMessageTimestamp: "2026-06-04T00:00:02.000Z",
    });
    await expect(index.summary(filepath, fileStat)).resolves.toEqual(expect.objectContaining({
      firstUserTitle: "recovered prompt",
      latestMessageTimestamp: "2026-06-04T00:00:02.000Z",
      userTurnCount: 1,
      hasAssistantReply: true,
    }));
  });

  it("refreshes an appended direct transcript without losing its page projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-transcript-index-"));
    directories.push(directory);
    const filepath = join(directory, "direct.jsonl");
    await writeFile(filepath, [
      JSON.stringify({ type: "session", version: 1, id: "direct", timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "first", timestamp: "2026-06-04T00:00:01.000Z", message: { role: "user", content: "first" } }),
      "",
    ].join("\n"), "utf-8");
    const index = new TranscriptIndex();
    await index.summary(filepath, await stat(filepath));
    await appendFile(filepath, `${JSON.stringify({
      type: "message", id: "second", timestamp: "2026-06-04T00:00:02.000Z", message: { role: "assistant", content: "second" },
    })}\n`);

    await expect(index.activity(filepath, await stat(filepath))).resolves.toEqual({
      latestMessageTimestamp: "2026-06-04T00:00:02.000Z",
    });
    await expect(index.summary(filepath, await stat(filepath))).resolves.toEqual(expect.objectContaining({
      userTurnCount: 1,
      hasAssistantReply: true,
      latestMessageTimestamp: "2026-06-04T00:00:02.000Z",
    }));
  });

  it("refreshes after a multibyte character split at a stream boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-transcript-index-"));
    directories.push(directory);
    const filepath = join(directory, "direct.jsonl");
    const header = `${JSON.stringify({ type: "session", version: 1, id: "direct", timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" })}\n`;
    const messagePrefix = "{\"type\":\"message\",\"id\":\"first\",\"timestamp\":\"2026-06-04T00:00:01.000Z\",\"message\":{\"role\":\"user\",\"content\":\"";
    const filler = "x".repeat(64 * 1024 - 1 - Buffer.byteLength(header + messagePrefix));
    const first = `${header}${messagePrefix}${filler}é\"}}\n`;
    expect(Buffer.byteLength(header + messagePrefix + filler)).toBe(64 * 1024 - 1);
    await writeFile(filepath, first, "utf-8");

    const index = new TranscriptIndex();
    await index.summary(filepath, await stat(filepath));
    await appendFile(filepath, `${JSON.stringify({
      type: "message", id: "second", timestamp: "2026-06-04T00:00:02.000Z", message: { role: "assistant", content: "second" },
    })}\n`);

    await expect(index.summary(filepath, await stat(filepath))).resolves.toEqual(expect.objectContaining({
      userTurnCount: 1,
      hasAssistantReply: true,
      latestMessageTimestamp: "2026-06-04T00:00:02.000Z",
    }));
  });

  it("bounds cold work while preserving caller order", async () => {
    let active = 0;
    let peak = 0;
    const result = await mapWithConcurrency([3, 1, 2, 4, 5], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    });

    expect(result).toEqual([6, 2, 4, 8, 10]);
    expect(peak).toBe(2);
  });
});
