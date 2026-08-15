import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRawJsonlPageFile } from "../rawJsonlPager.js";

describe("readRawJsonlPageFile", () => {
  let dir: string;
  let filepath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "raw-jsonl-pager-"));
    filepath = join(dir, "session.jsonl");
  });
  afterEach(async () => await rm(dir, { recursive: true, force: true }));

  it("preserves records split across stream chunks and withholds an incomplete append", async () => {
    const large = JSON.stringify({ type: "message", text: "x".repeat(70_000) });
    await writeFile(filepath, `first\n${large}\npartial`, "utf-8");

    await expect(readRawJsonlPageFile(filepath, { cursor: 0, limit: 10, maxBytes: 100_000 }))
      .resolves.toEqual({ lines: ["first", large], nextCursor: 2, hasMore: false });
  });

  it("honors cancellation during file admission", async () => {
    await writeFile(filepath, "first\n", "utf-8");
    const controller = new AbortController();
    controller.abort();
    await expect(readRawJsonlPageFile(filepath, {
      cursor: 0, limit: 10, maxBytes: 100_000, signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
