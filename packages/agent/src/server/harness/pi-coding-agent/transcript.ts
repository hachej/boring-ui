import { open, readFile, stat as fsStat } from "node:fs/promises";
import { closeSync, openSync, readSync } from "node:fs";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionInfoEntry,
  type SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";

export const TRANSCRIPT_PREFIX_BYTES = 64 * 1024;

export type TranscriptEntry = SessionHeader | SessionEntry;

/**
 * Reads only complete JSONL records from the start of a transcript. Metadata
 * records are deliberately small; never let a huge message become list-path
 * allocation just to find a header or native link.
 */
export async function readJsonlPrefix(filepath: string, maxBytes = TRANSCRIPT_PREFIX_BYTES): Promise<string> {
  const handle = await open(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    await handle.close();
  }
}

export function readJsonlPrefixSync(filepath: string, maxBytes = TRANSCRIPT_PREFIX_BYTES): string {
  const fd = openSync(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    closeSync(fd);
  }
}

/** Full cold-load parser. It is intentionally tolerant of one bad JSONL row. */
export async function readTranscriptEntries(filepath: string): Promise<TranscriptEntry[]> {
  return safeParseEntries(await readFile(filepath, "utf-8"));
}

export async function readTranscript(filepath: string): Promise<{
  entries: TranscriptEntry[];
  stat: Awaited<ReturnType<typeof fsStat>>;
}> {
  const [fileStat, entries] = await Promise.all([fsStat(filepath), readTranscriptEntries(filepath)]);
  return { entries, stat: fileStat };
}

export function safeParseEntries(content: string): TranscriptEntry[] {
  try {
    return parseSessionEntries(content);
  } catch {
    return parseJsonlEntries(content);
  }
}

/** Prefix parsing intentionally tolerates a truncated final record. */
export function parseJsonlPrefixEntries(content: string): TranscriptEntry[] {
  return parseJsonlEntries(content);
}

function parseJsonlEntries(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A malformed record must not hide the rest of a transcript.
    }
  }
  return entries;
}

export function sessionHeader(entries: TranscriptEntry[]): SessionHeader | undefined {
  return entries.find((entry): entry is SessionHeader => entry.type === "session");
}

export function sessionEntries(entries: TranscriptEntry[]): SessionEntry[] {
  return entries.filter(
    (entry): entry is SessionEntry => entry.type !== "session" && (entry as { type?: string }).type !== "ui_snapshot",
  );
}

export function extractPiSessionFilePath(entries: TranscriptEntry[]): string | null {
  let piFilePath: string | null = null;
  for (const entry of entries) {
    const record = entry as { type?: string; path?: string };
    if (record.type === "pi_session_file" && typeof record.path === "string") piFilePath = record.path;
  }
  return piFilePath;
}

export function extractSessionHeaderId(entries: TranscriptEntry[]): string | null {
  return sessionHeader(entries)?.id ?? null;
}

export function activityMessageRole(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") return undefined;
  const message = (entry as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.length > 0 ? role : undefined;
}

export function latestMessageTimestampFromEntries(entries: SessionEntry[]): string | undefined {
  let latest: string | undefined;
  for (const entry of entries) {
    if (activityMessageRole(entry) === undefined) continue;
    const timestamp = normalizedTimestamp(typeof entry.timestamp === "string" ? entry.timestamp : undefined);
    if (timestamp && (!latest || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

export function countUserTurns(entries: SessionEntry[]): number {
  return entries.filter((entry) => activityMessageRole(entry) === "user").length;
}

export function hasAssistantReply(entries: SessionEntry[]): boolean {
  return entries.some((entry) => activityMessageRole(entry) === "assistant");
}

export function extractTitle(entries: SessionEntry[]): string | undefined {
  const last = entries
    .filter((entry): entry is SessionInfoEntry => entry.type === "session_info")
    .pop();
  return last?.name;
}

export function firstUserMessage(entries: SessionEntry[]): string | undefined {
  for (const entry of entries) {
    if (activityMessageRole(entry) !== "user") continue;
    const message = (entry as SessionMessageEntry).message as { content?: unknown };
    const text = textFromPiContent(message.content);
    if (text) return text.slice(0, 80);
  }
  return undefined;
}

export function normalizedTimestamp(value: string | undefined): string | undefined {
  const timestamp = timestampMs(value);
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

export function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function activityTimestampOrFallback(
  latestMessageTimestamp: string | undefined,
  headerTimestamp: string | undefined,
  fallbackTimestamp: number,
): string {
  return normalizedTimestamp(latestMessageTimestamp)
    ?? normalizedTimestamp(headerTimestamp)
    ?? new Date(fallbackTimestamp).toISOString();
}

function textFromPiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = part as { type?: unknown; text?: unknown } | null;
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("");
}
