import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { normalizedTimestamp } from "./transcript.js";

const SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_JSONL_LINE_CHARS = 1024 * 1024;
const MAX_STREAMED_PROMPT_CHARS = 80;

export type TranscriptStat = {
  size: number | bigint;
  mtime: Date;
  ctimeMs: number | bigint;
  dev: number | bigint;
  ino: number | bigint;
};

export interface TranscriptActivity {
  latestMessageTimestamp?: string;
}

export interface TranscriptSummary extends TranscriptActivity {
  lastTitle?: string;
  firstUserTitle?: string;
  userTurnCount: number;
  hasAssistantReply: boolean;
}

interface TranscriptFingerprint {
  mtimeMs: number;
  ctimeMs: number | bigint;
  size: number;
  identity: string;
}

/** One cache record per resolved transcript, regardless of wrapper/native origin. */
interface TranscriptIndexRecord {
  fingerprint: TranscriptFingerprint;
  activity: TranscriptActivity;
  summary?: TranscriptSummary;
}

interface EntryProjection {
  sessionInfoTitle?: string;
  messageRole?: "user" | "assistant";
  messageText?: string;
  messageTimestamp?: string;
}

/**
 * Bounded transcript projections for the list path. A wrapper never owns a
 * second linked cache: native and direct files meet at their resolved path.
 *
 * Activity is deliberately indexed separately from summaries. Listing scans
 * cheap ordering data for every visible transcript, pages it, and only then
 * asks for title/turn/assistant projections for that page.
 */
export class TranscriptIndex {
  #records = new Map<string, TranscriptIndexRecord>();

  clear(filepath: string): void {
    this.#records.delete(resolve(filepath));
  }

  async activity(filepath: string, stat: TranscriptStat): Promise<TranscriptActivity> {
    const resolvedPath = resolve(filepath);
    const fingerprint = fingerprintFor(stat);
    const cached = this.#records.get(resolvedPath);
    if (cached && sameFingerprint(cached.fingerprint, fingerprint)) return { ...cached.activity };

    const summary = await scanTranscript(resolvedPath, "activity", fingerprint.size);
    this.#records.set(resolvedPath, {
      fingerprint,
      activity: pickActivity(summary),
    });
    return pickActivity(summary);
  }

  async summary(filepath: string, stat: TranscriptStat): Promise<TranscriptSummary> {
    const resolvedPath = resolve(filepath);
    const fingerprint = fingerprintFor(stat);
    const cached = this.#records.get(resolvedPath);
    if (cached && sameFingerprint(cached.fingerprint, fingerprint) && cached.summary) return { ...cached.summary };

    const summary = await scanTranscript(resolvedPath, "summary", fingerprint.size);
    this.#records.set(resolvedPath, {
      fingerprint,
      activity: pickActivity(summary),
      summary,
    });
    return { ...summary };
  }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, worker));
  return results;
}

function fingerprintFor(stat: TranscriptStat): TranscriptFingerprint {
  return {
    mtimeMs: stat.mtime.getTime(),
    ctimeMs: stat.ctimeMs,
    size: Number(stat.size),
    identity: `${stat.dev}:${stat.ino}`,
  };
}

function sameFingerprint(a: TranscriptFingerprint, b: TranscriptFingerprint): boolean {
  return a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs
    && a.size === b.size
    && a.identity === b.identity;
}

function pickActivity(summary: TranscriptActivity): TranscriptActivity {
  return summary.latestMessageTimestamp ? { latestMessageTimestamp: summary.latestMessageTimestamp } : {};
}

/**
 * Stream JSONL one record at a time. Records larger than MAX_JSONL_LINE_CHARS
 * are skipped, which keeps the list path bounded while still recovering on the
 * next newline after a malformed or huge tool/assistant payload.
 */
async function scanTranscript(
  filepath: string,
  mode: "activity" | "summary",
  end: number,
): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = { userTurnCount: 0, hasAssistantReply: false };
  const decoder = new TextDecoder();
  let line = "";
  let lineTooLarge = false;

  const appendLine = (content: string) => {
    if (lineTooLarge) return;
    if (line.length + content.length > MAX_JSONL_LINE_CHARS) {
      line = "";
      lineTooLarge = true;
    } else line += content;
  };
  const consumeLine = () => {
    if (!lineTooLarge) applyEntryProjection(summary, mode, parseEntryProjection(line));
    line = "";
    lineTooLarge = false;
  };
  const scan = (content: string, final = false) => {
    let start = 0;
    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      if (newline === -1) break;
      appendLine(content.slice(start, newline));
      consumeLine();
      start = newline + 1;
    }
    appendLine(content.slice(start));
    if (final && (line.length > 0 || lineTooLarge)) consumeLine();
  };

  if (end <= 0) return summary;
  for await (const chunk of createReadStream(filepath, {
    highWaterMark: SCAN_CHUNK_BYTES,
    end: end - 1,
  })) {
    scan(decoder.decode(chunk, { stream: true }));
  }
  scan(decoder.decode(), true);
  return summary;
}

function parseEntryProjection(line: string): EntryProjection | null {
  try {
    const entry = JSON.parse(line) as unknown;
    if (!isRecord(entry)) return null;
    if (entry.type === "session_info") {
      return typeof entry.name === "string" ? { sessionInfoTitle: entry.name } : null;
    }
    if (entry.type !== "message") return null;
    const message = isRecord(entry.message) ? entry.message : null;
    if (!message || typeof message.role !== "string" || message.role.length === 0) return null;
    const messageRole = message.role === "user" || message.role === "assistant" ? message.role : undefined;
    return {
      ...(messageRole ? { messageRole } : {}),
      messageTimestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
      ...(message.role === "user" ? { messageText: messageText(message.content) } : {}),
    };
  } catch {
    return null;
  }
}

function applyEntryProjection(
  summary: TranscriptSummary,
  mode: "activity" | "summary",
  entry: EntryProjection | null,
): void {
  if (!entry) return;
  const timestamp = normalizedTimestamp(entry.messageTimestamp);
  if (timestamp && (!summary.latestMessageTimestamp || timestamp > summary.latestMessageTimestamp)) {
    summary.latestMessageTimestamp = timestamp;
  }
  if (mode !== "summary") return;
  if (entry.sessionInfoTitle !== undefined) summary.lastTitle = entry.sessionInfoTitle;
  if (entry.messageRole === "user") {
    summary.userTurnCount += 1;
    if (summary.firstUserTitle === undefined && entry.messageText) summary.firstUserTitle = entry.messageText;
  }
  if (entry.messageRole === "assistant") summary.hasAssistantReply = true;
}

function messageText(content: unknown): string | undefined {
  if (typeof content === "string") return truncateTitle(content);
  if (!Array.isArray(content)) return undefined;
  let text = "";
  for (const part of content) {
    if (!isRecord(part) || typeof part.text !== "string") continue;
    text = truncateTitle(text + part.text);
    if (text.length >= MAX_STREAMED_PROMPT_CHARS) break;
  }
  return text || undefined;
}

function truncateTitle(value: string): string {
  return value.slice(0, MAX_STREAMED_PROMPT_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
