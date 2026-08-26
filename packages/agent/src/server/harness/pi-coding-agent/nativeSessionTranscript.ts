import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionEntry, SessionHeader } from "@mariozechner/pi-coding-agent";
import { textFromPiContent } from "./piSessionMessages.js";
import {
  USER_SESSION_TITLE_CUSTOM_TYPE,
  createUserSessionTitleProjection,
} from "./sessionTitleAuthority.js";

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

export interface SessionTranscriptSummary {
  title?: string;
  titleTimestamp?: string;
  userTitle?: string;
  userTitleTimestamp?: string;
  firstUserTitle?: string;
  entryCount: number;
  turnCount: number;
  hasAssistantReply: boolean;
  latestMessageAtMs?: number;
}

interface SessionTranscriptAccumulator {
  acceptLine(line: string, committed?: boolean): (SessionHeader | SessionEntry) | undefined;
  summary(): SessionTranscriptSummary;
}

function createSessionTranscriptAccumulator(): SessionTranscriptAccumulator {
  let title: string | undefined;
  let titleTimestamp: string | undefined;
  let firstUserTitle: string | undefined;
  let entryCount = 0;
  let turnCount = 0;
  let hasAssistantReply = false;
  let latestMessageAtMs: number | undefined;
  const userTitle = createUserSessionTitleProjection();
  const authorityMarkerIds = new Set<string>();

  return {
    acceptLine(line, committed = true) {
      // Blank separators are formatting, not physical records.
      if (!line.trim()) return undefined;
      let entry: SessionHeader | SessionEntry;
      try {
        entry = JSON.parse(line) as SessionHeader | SessionEntry;
      } catch {
        userTitle.breakSequence();
        return undefined;
      }
      if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
        userTitle.breakSequence();
        return undefined;
      }

      const record = entry as SessionEntry;
      if (record.type === "custom"
        && record.customType === USER_SESSION_TITLE_CUSTOM_TYPE
        && typeof record.id === "string") authorityMarkerIds.add(record.id);

      // An EOF fragment without a newline may still be in flight. It remains
      // readable as legacy content, but cannot commit manual-title authority.
      if (committed) userTitle.accept(entry);
      else userTitle.breakSequence();
      if (entry.type !== "session") entryCount += 1;
      if (entry.type === "session_info" && typeof entry.name === "string") {
        // A title linked to a manual-authority marker is never an auto-title
        // fallback. Failed optimistic attempts therefore stay projection-inert.
        if (!authorityMarkerIds.has(entry.parentId ?? "")) {
          title = entry.name;
          titleTimestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
        }
      } else if (entry.type === "message") {
        const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
        if (!Number.isNaN(timestamp)) latestMessageAtMs = timestamp;
        if (entry.message?.role === "user") {
          turnCount += 1;
          firstUserTitle ??= textFromPiContent(entry.message.content).slice(0, 80) || undefined;
        } else if (entry.message?.role === "assistant") {
          hasAssistantReply = true;
        }
      }
      return entry;
    },
    summary() {
      return {
        ...(title ? { title } : {}),
        ...(titleTimestamp ? { titleTimestamp } : {}),
        ...(userTitle.title ? { userTitle: userTitle.title } : {}),
        ...(userTitle.timestamp ? { userTitleTimestamp: userTitle.timestamp } : {}),
        ...(firstUserTitle ? { firstUserTitle } : {}),
        entryCount,
        turnCount,
        hasAssistantReply,
        ...(latestMessageAtMs !== undefined ? { latestMessageAtMs } : {}),
      };
    },
  };
}

/** Parse entries and title projection together so cold loads never scan twice. */
export function parseSessionTranscript(content: string): {
  entries: (SessionHeader | SessionEntry)[];
  summary: SessionTranscriptSummary;
} {
  const accumulator = createSessionTranscriptAccumulator();
  const entries: (SessionHeader | SessionEntry)[] = [];
  const physicalLines = content.split("\n");
  const lastIndex = physicalLines.length - 1;
  for (const [index, line] of physicalLines.entries()) {
    const entry = accumulator.acceptLine(line, index < lastIndex);
    if (entry) entries.push(entry);
  }
  return { entries, summary: accumulator.summary() };
}

async function transcriptEndsWithNewline(filepath: string): Promise<boolean> {
  const handle = await open(filepath, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return true;
    const byte = Buffer.allocUnsafe(1);
    const { bytesRead } = await handle.read(byte, 0, 1, size - 1);
    return bytesRead === 1 && byte[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

/** One streaming summary path for direct-native and wrapped JSONL transcripts. */
export async function summarizeSessionTranscript(filepath: string): Promise<SessionTranscriptSummary> {
  const accumulator = createSessionTranscriptAccumulator();
  const endsWithNewline = await transcriptEndsWithNewline(filepath);
  const input = createReadStream(filepath, { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let pending: string | undefined;
  for await (const line of lines) {
    if (pending !== undefined) accumulator.acceptLine(pending);
    pending = line;
  }
  if (pending !== undefined) accumulator.acceptLine(pending, endsWithNewline);
  return accumulator.summary();
}
