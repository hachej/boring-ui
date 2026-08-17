import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { textFromPiContent } from "./piSessionMessages.js";
import { userSessionTitleFromPair } from "./sessionTitleAuthority.js";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

const NATIVE_TAIL_CHUNK_BYTES = 64 * 1024;
export const NATIVE_TAIL_MAX_RECORD_BYTES = 256 * 1024;
export const NATIVE_TAIL_MAX_RECORD_FRAGMENTS = 4;

export async function latestNativeMessageTimestamp(filepath: string, size: number): Promise<number | undefined> {
  const handle = await open(filepath, "r");
  let end = size;
  let lineFragments: Buffer[] = [];
  try {
    while (end > 0) {
      const start = Math.max(0, end - NATIVE_TAIL_CHUNK_BYTES);
      const chunk = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start);
      let lineEnd = bytesRead;
      while (lineEnd > 0) {
        const newline = chunk.lastIndexOf(0x0a, lineEnd - 1);
        if (newline < 0) break;
        // Once a record start is found, retain only its bounded prefix and
        // the immediately following chunks. Never reconstruct a full record.
        const timestamp = nativeMessageTimestampFromBoundedPrefix(
          nativeTailRecordPrefix(chunk.subarray(newline + 1, lineEnd), lineFragments),
        );
        lineFragments = [];
        if (timestamp !== undefined) return timestamp;
        lineEnd = newline;
      }
      if (lineEnd > 0) {
        lineFragments = retainNativeTailFragment(chunk.subarray(0, lineEnd), lineFragments);
      }
      end = start;
    }
    // At file start, the last retained fragment is the record prefix and the
    // preceding fragments are its immediate continuation in reverse-read order.
    return nativeMessageTimestampFromBoundedPrefix(
      nativeTailRecordPrefix(lineFragments.at(-1) ?? Buffer.alloc(0), lineFragments.slice(0, -1)),
    );
  } finally {
    await handle.close();
  }
}

function retainNativeTailFragment(fragment: Buffer, fragments: Buffer[]): Buffer[] {
  const next = [...fragments, fragment.subarray(0, NATIVE_TAIL_MAX_RECORD_BYTES)];
  while (next.length > NATIVE_TAIL_MAX_RECORD_FRAGMENTS || nativeTailFragmentBytes(next) > NATIVE_TAIL_MAX_RECORD_BYTES) {
    next.shift();
  }
  return next;
}

function nativeTailFragmentBytes(fragments: Buffer[]): number {
  return fragments.reduce((total, fragment) => total + fragment.length, 0);
}

/** Combines a record start with its retained following chunks in file order. */
function nativeTailRecordPrefix(recordStart: Buffer, followingFragments: Buffer[]): Buffer {
  const total = Math.min(
    NATIVE_TAIL_MAX_RECORD_BYTES,
    recordStart.length + nativeTailFragmentBytes(followingFragments),
  );
  const prefix = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const fragment of [recordStart, ...followingFragments.slice().reverse()]) {
    const length = Math.min(fragment.length, total - offset);
    if (length <= 0) break;
    fragment.copy(prefix, offset, 0, length);
    offset += length;
  }
  return prefix;
}

export function nativeMessageTimestampFromBoundedPrefix(prefix: Buffer): number | undefined {
  if (prefix.length === 0) return undefined;
  const line = prefix.subarray(0, NATIVE_TAIL_MAX_RECORD_BYTES).toString("utf-8");
  // Pi writes `type` first and its timestamp before message payloads. This is
  // intentionally a root-prefix check, not a JSON parser for a whole record.
  if (!/^\s*\{\s*"type"\s*:\s*"message"(?:\s*,|\s*})/.test(line)) return undefined;
  const timestampMatch = /"timestamp"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(line);
  if (!timestampMatch) return undefined;
  const timestamp = Date.parse(timestampMatch[1]);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export async function summarizeNativeTranscript(filepath: string): Promise<{
  title?: string;
  userTitle?: string;
  firstUserTitle?: string;
  turnCount: number;
  hasAssistantReply: boolean;
  latestMessageAtMs?: number;
}> {
  let title: string | undefined;
  let userTitle: string | undefined;
  let firstUserTitle: string | undefined;
  let turnCount = 0;
  let hasAssistantReply = false;
  let latestMessageAtMs: number | undefined;
  let previousEntry: SessionEntry | undefined;
  const input = createReadStream(filepath, { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as SessionEntry;
      const persistedUserTitle = userSessionTitleFromPair(previousEntry, entry);
      previousEntry = entry;
      if (persistedUserTitle) userTitle = persistedUserTitle.title;
      if (entry.type === "session_info" && typeof entry.name === "string") {
        title = entry.name;
        continue;
      }
      if (entry.type !== "message") continue;
      const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
      if (!Number.isNaN(timestamp)) latestMessageAtMs = timestamp;
      if (entry.message?.role === "user") {
        turnCount += 1;
        firstUserTitle ??= textFromPiContent(entry.message.content).slice(0, 80) || undefined;
      } else if (entry.message?.role === "assistant") {
        hasAssistantReply = true;
      }
    } catch {
      // A malformed transcript record must not hide later valid records.
    }
  }
  return { title, userTitle, firstUserTitle, turnCount, hasAssistantReply, latestMessageAtMs };
}
