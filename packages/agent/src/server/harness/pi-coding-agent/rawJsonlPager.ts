import { createReadStream } from "node:fs";
import type { SessionJsonlPage, SessionJsonlPageInput } from "../../../shared/session.js";

/** Pages newline-complete UTF-8 JSONL records without buffering a whole file or partial append. */
export async function readRawJsonlPageFile(
  filepath: string,
  input: SessionJsonlPageInput,
): Promise<SessionJsonlPage> {
  const stream = createReadStream(filepath, { signal: input.signal });
  const lines: string[] = [];
  let lineIndex = 0;
  let pageBytes = 0;
  let currentBytes = 0;
  let currentParts: Buffer[] = [];
  let blocked: "limit" | "bytes" | null = null;
  let hasMore = false;
  let stop = false;
  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      let start = 0;
      while (start < chunk.length && !stop) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline;
        const segment = chunk.subarray(start, end);
        if (lineIndex >= input.cursor && blocked === null) {
          if (lines.length >= input.limit) {
            blocked = "limit";
          } else if (pageBytes + currentBytes + segment.length > input.maxBytes) {
            blocked = "bytes";
            currentParts = [];
          } else if (segment.length > 0) {
            currentParts.push(segment);
            currentBytes += segment.length;
          }
        }
        if (newline === -1) break;
        if (lineIndex >= input.cursor) {
          if (blocked === "bytes" && lines.length === 0) {
            throw new RangeError("JSONL line exceeds page byte limit");
          }
          if (blocked !== null) {
            hasMore = true;
            stop = true;
            break;
          }
          lines.push(Buffer.concat(currentParts, currentBytes).toString("utf-8"));
          pageBytes += currentBytes;
        }
        lineIndex += 1;
        currentBytes = 0;
        currentParts = [];
        start = newline + 1;
      }
      if (stop) break;
    }
  } finally {
    stream.destroy();
  }
  return { lines, nextCursor: input.cursor + lines.length, hasMore };
}
