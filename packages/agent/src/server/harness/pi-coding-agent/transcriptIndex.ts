import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

const SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_JSONL_LINE_CHARS = 1024 * 1024;
const MAX_STREAMED_PROMPT_CHARS = 80;
const APPEND_CHECKPOINT_BYTES = 4 * 1024;

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
  activityNextStart: number;
  appendCheckpoint?: string;
  appendReuseAllowed: boolean;
  summary?: TranscriptSummary;
  summaryNextStart?: number;
}

export interface TranscriptActivityOptions {
  /** Only direct native appenders may reuse a checked byte offset. */
  allowAppendReuse?: boolean;
}

interface ScanResult {
  summary: TranscriptSummary;
  nextStart: number;
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

  async activity(
    filepath: string,
    stat: TranscriptStat,
    options: TranscriptActivityOptions = {},
  ): Promise<TranscriptActivity> {
    const resolvedPath = resolve(filepath);
    const fingerprint = fingerprintFor(stat);
    const cached = this.#records.get(resolvedPath);
    if (cached && sameFingerprint(cached.fingerprint, fingerprint)) return { ...cached.activity };

    const canResume = options.allowAppendReuse === true
      && cached !== undefined
      && cached.fingerprint.identity === fingerprint.identity
      && cached.fingerprint.size < fingerprint.size
      && cached.appendReuseAllowed
      && cached.appendCheckpoint !== undefined
      && cached.appendCheckpoint === await appendCheckpoint(resolvedPath, cached.fingerprint.size);
    const scan = canResume && cached.summary && cached.summaryNextStart !== undefined
      ? await scanTranscript(resolvedPath, "summary", {
        start: cached.summaryNextStart,
        summary: cached.summary,
        end: fingerprint.size,
      })
      : await scanTranscript(resolvedPath, "activity", canResume && cached
        ? { start: cached.activityNextStart, summary: cached.activity, end: fingerprint.size }
        : { end: fingerprint.size });
    const summary = canResume && cached.summary ? scan.summary : undefined;
    const record: TranscriptIndexRecord = {
      fingerprint,
      activity: pickActivity(scan.summary),
      activityNextStart: scan.nextStart,
      appendCheckpoint: options.allowAppendReuse ? await appendCheckpoint(resolvedPath, fingerprint.size) : undefined,
      appendReuseAllowed: options.allowAppendReuse === true,
      ...(summary ? { summary, summaryNextStart: scan.nextStart } : {}),
    };
    this.#records.set(resolvedPath, record);
    return { ...record.activity };
  }

  async summary(
    filepath: string,
    stat: TranscriptStat,
    options: TranscriptActivityOptions = {},
  ): Promise<TranscriptSummary> {
    const resolvedPath = resolve(filepath);
    const fingerprint = fingerprintFor(stat);
    const cached = this.#records.get(resolvedPath);
    if (cached && sameFingerprint(cached.fingerprint, fingerprint) && cached.summary) return { ...cached.summary };

    const scan = await scanTranscript(resolvedPath, "summary", { end: fingerprint.size });
    const record: TranscriptIndexRecord = {
      fingerprint,
      activity: pickActivity(scan.summary),
      activityNextStart: scan.nextStart,
      appendCheckpoint: options.allowAppendReuse ? await appendCheckpoint(resolvedPath, fingerprint.size) : undefined,
      appendReuseAllowed: options.allowAppendReuse === true,
      summary: scan.summary,
      summaryNextStart: scan.nextStart,
    };
    this.#records.set(resolvedPath, record);
    return { ...scan.summary };
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

/** Verifies an append has not replaced either boundary of the prior file. */
async function appendCheckpoint(filepath: string, size: number): Promise<string | undefined> {
  const chunkSize = Math.min(size, APPEND_CHECKPOINT_BYTES);
  if (chunkSize === 0) return "";
  try {
    const handle = await open(filepath, "r");
    try {
      const head = Buffer.alloc(chunkSize);
      const tail = Buffer.alloc(chunkSize);
      const [{ bytesRead: headBytes }, { bytesRead: tailBytes }] = await Promise.all([
        handle.read(head, 0, chunkSize, 0),
        handle.read(tail, 0, chunkSize, Math.max(0, size - chunkSize)),
      ]);
      if (headBytes !== chunkSize || tailBytes !== chunkSize) return undefined;
      return createHash("sha256")
        .update(head.subarray(0, headBytes))
        .update(tail.subarray(0, tailBytes))
        .digest("hex");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

/**
 * Stream JSONL one record at a time. Records larger than MAX_JSONL_LINE_CHARS
 * are skipped, which keeps the list path bounded while still recovering on the
 * next newline after a malformed or huge tool/assistant payload.
 */
async function scanTranscript(
  filepath: string,
  mode: "activity" | "summary",
  options: { start?: number; summary?: TranscriptActivity | TranscriptSummary; end?: number } = {},
): Promise<ScanResult> {
  const summary: TranscriptSummary = mode === "summary"
    ? { userTurnCount: 0, hasAssistantReply: false, ...(options.summary ?? {}) }
    : { userTurnCount: 0, hasAssistantReply: false, ...(options.summary ? pickActivity(options.summary) : {}) };
  const decoder = new TextDecoder();
  let byteOffset = options.start ?? 0;
  let lastNewlineOffset = byteOffset;
  let line = "";
  let lineTooLarge = false;
  let newlineOffsets: number[] = [];
  let nextNewlineOffset = 0;

  const appendLine = (content: string) => {
    if (lineTooLarge) return;
    if (line.length + content.length > MAX_JSONL_LINE_CHARS) {
      line = "";
      lineTooLarge = true;
    } else line += content;
  };
  const consumeLine = (newlineOffset?: number) => {
    if (!lineTooLarge) applyEntryProjection(summary, mode, parseEntryProjection(line));
    line = "";
    lineTooLarge = false;
    if (newlineOffset !== undefined) lastNewlineOffset = newlineOffset;
  };
  const scan = (content: string, final = false) => {
    let start = 0;
    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      if (newline === -1) break;
      appendLine(content.slice(start, newline));
      consumeLine(newlineOffsets[nextNewlineOffset++]);
      start = newline + 1;
    }
    appendLine(content.slice(start));
    if (final && (line.length > 0 || lineTooLarge)) {
      consumeLine();
      lastNewlineOffset = byteOffset;
    }
  };

  if (options.end !== undefined && byteOffset >= options.end) return { summary, nextStart: lastNewlineOffset };
  for await (const chunk of createReadStream(filepath, {
    highWaterMark: SCAN_CHUNK_BYTES,
    ...(options.start !== undefined ? { start: options.start } : {}),
    ...(options.end !== undefined ? { end: options.end - 1 } : {}),
  })) {
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] === 0x0a) newlineOffsets.push(byteOffset + index + 1);
    }
    byteOffset += chunk.length;
    scan(decoder.decode(chunk, { stream: true }));
    if (nextNewlineOffset === newlineOffsets.length) {
      newlineOffsets = [];
      nextNewlineOffset = 0;
    }
  }
  scan(decoder.decode(), true);
  return { summary, nextStart: lastNewlineOffset };
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

function normalizedTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
