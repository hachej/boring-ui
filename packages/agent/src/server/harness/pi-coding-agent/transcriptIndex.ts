import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

const SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_JSON_NESTING_DEPTH = 100;
const MAX_STREAMED_TITLE_CHARS = 4 * 1024;
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
 * The scanner consumes a JSONL record a chunk at a time and retains only the
 * few short fields needed for a list row. JSON.parse cannot be used here:
 * one persisted assistant/tool record can be many megabytes, while the list
 * path must retain bounded memory and recover after a malformed record.
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
  let line = new JsonlAssistantEntryScanner();
  let byteOffset = options.start ?? 0;
  let lastNewlineOffset = byteOffset;
  let newlineOffsets: number[] = [];
  let nextNewlineOffset = 0;
  const consumeLine = (newlineOffset?: number): boolean => {
    const entry = line.summary();
    if (entry) {
      const timestamp = normalizedTimestamp(entry.messageTimestamp);
      if (timestamp && (!summary.latestMessageTimestamp || timestamp > summary.latestMessageTimestamp)) {
        summary.latestMessageTimestamp = timestamp;
      }
      if (mode === "summary") {
        if (entry.sessionInfoTitle !== undefined) summary.lastTitle = entry.sessionInfoTitle;
        if (entry.messageRole === "user") {
          summary.userTurnCount += 1;
          if (summary.firstUserTitle === undefined && entry.messageText) summary.firstUserTitle = entry.messageText;
        }
        if (entry.messageRole === "assistant") summary.hasAssistantReply = true;
      }
    }
    line = new JsonlAssistantEntryScanner();
    if (newlineOffset !== undefined) lastNewlineOffset = newlineOffset;
    return entry !== null;
  };
  const scan = (content: string, final = false) => {
    let start = 0;
    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      if (newline === -1) break;
      line.write(content.slice(start, newline));
      consumeLine(newlineOffsets[nextNewlineOffset++]);
      start = newline + 1;
    }
    line.write(content.slice(start));
    if (final && consumeLine()) lastNewlineOffset = byteOffset;
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

function normalizedTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

type JsonContainer =
  | { kind: "array"; state: "valueOrEnd" | "commaOrEnd"; afterComma: boolean; isMessageContent: boolean }
  | {
    kind: "object";
    state: "keyOrEnd" | "colon" | "value" | "commaOrEnd";
    key: string | null;
    afterComma: boolean;
    isRoot: boolean;
    isMessageObject: boolean;
    isContentItem: boolean;
  };

type JsonNumberState = "minus" | "zero" | "integer" | "fractionStart" | "fraction" | "exponentStart" | "exponentSign" | "exponent";
type JsonToken = { kind: "literal"; expected: string; index: number } | { kind: "number"; state: JsonNumberState };
type JsonString = {
  role: "key" | "value";
  value: string;
  overflow: boolean;
  maxLength: number;
  truncate: boolean;
  escaped: boolean;
  unicode: string | null;
};

class JsonlAssistantEntryScanner {
  #valid = true;
  #rootState: "value" | "done" = "value";
  #rootType: "message" | "session_info" | null = null;
  #messageRole: "user" | "assistant" | null = null;
  #hasMessageObject = false;
  #hasMessageRole = false;
  #sessionInfoTitle: string | undefined;
  #rootTimestamp: string | undefined;
  #messageText: string | undefined;
  #stack: JsonContainer[] = [];
  #token: JsonToken | null = null;
  #string: JsonString | null = null;

  write(content: string): void {
    for (let index = 0; this.#valid && index < content.length;) {
      const char = content[index]!;
      if (this.#string) {
        this.#consumeString(char);
        index += 1;
      } else if (this.#token) {
        if (isJsonDelimiter(char)) this.#finishToken();
        else {
          this.#consumeToken(char);
          index += 1;
        }
      } else if (isJsonWhitespace(char)) {
        index += 1;
      } else {
        this.#consumeStructure(char);
        index += 1;
      }
    }
  }

  summary(): { sessionInfoTitle?: string; messageRole?: "user" | "assistant"; messageText?: string; messageTimestamp?: string } | null {
    if (this.#token) this.#finishToken();
    if (!this.#valid || this.#string !== null || this.#stack.length !== 0 || this.#rootState !== "done") return null;
    if (this.#rootType === "session_info") return { sessionInfoTitle: this.#sessionInfoTitle };
    if (this.#rootType === "message" && this.#hasMessageObject && this.#hasMessageRole) {
      return {
        ...(this.#messageRole ? { messageRole: this.#messageRole } : {}),
        ...(this.#messageText ? { messageText: this.#messageText } : {}),
        ...(this.#rootTimestamp ? { messageTimestamp: this.#rootTimestamp } : {}),
      };
    }
    return null;
  }

  #consumeStructure(char: string): void {
    const container = this.#stack.at(-1);
    if (!container) {
      if (this.#rootState !== "value") this.#valid = false;
      else this.#startValue(char);
      return;
    }
    if (container.kind === "object") {
      if (container.state === "keyOrEnd") {
        if (char === "}") {
          if (container.afterComma) this.#valid = false;
          else this.#closeContainer();
        } else if (char === '"') this.#startString("key");
        else this.#valid = false;
      } else if (container.state === "colon") {
        if (char === ":") container.state = "value";
        else this.#valid = false;
      } else if (container.state === "value") {
        this.#startValue(char);
      } else if (char === ",") {
        container.state = "keyOrEnd";
        container.afterComma = true;
      } else if (char === "}") {
        this.#closeContainer();
      } else this.#valid = false;
      return;
    }
    if (container.state === "valueOrEnd") {
      if (char === "]") {
        if (container.afterComma) this.#valid = false;
        else this.#closeContainer();
      } else this.#startValue(char);
    } else if (char === ",") {
      container.state = "valueOrEnd";
      container.afterComma = true;
    } else if (char === "]") this.#closeContainer();
    else this.#valid = false;
  }

  #startValue(char: string): void {
    const parent = this.#stack.at(-1);
    if (parent?.kind === "array") parent.afterComma = false;
    if (parent?.kind === "object" && parent.isRoot && parent.key === "message") {
      this.#messageRole = null;
      this.#messageText = undefined;
      this.#hasMessageObject = char === "{";
      this.#hasMessageRole = false;
    }
    if (char === '"') this.#startString("value");
    else if (char === "{" || char === "[") {
      this.#markNonStringValue(parent);
      if (this.#stack.length >= MAX_JSON_NESTING_DEPTH) {
        this.#valid = false;
        return;
      }
      if (char === "{") {
        this.#stack.push({
          kind: "object", state: "keyOrEnd", key: null, afterComma: false, isRoot: parent === undefined,
          isMessageObject: parent?.kind === "object" && parent.isRoot && parent.key === "message",
          isContentItem: parent?.kind === "array" && parent.isMessageContent,
        });
      } else {
        this.#stack.push({
          kind: "array", state: "valueOrEnd", afterComma: false,
          isMessageContent: parent?.kind === "object" && parent.isMessageObject && parent.key === "content",
        });
      }
    } else if (char === "t" || char === "f" || char === "n") {
      this.#markNonStringValue(parent);
      this.#token = { kind: "literal", expected: char === "t" ? "true" : char === "f" ? "false" : "null", index: 1 };
    } else if (char === "-" || isJsonDigit(char)) {
      this.#markNonStringValue(parent);
      this.#token = { kind: "number", state: char === "-" ? "minus" : char === "0" ? "zero" : "integer" };
    } else this.#valid = false;
  }

  #startString(role: JsonString["role"]): void {
    const parent = this.#stack.at(-1);
    const isTitle = role === "value" && parent?.kind === "object" && parent.isRoot && parent.key === "name";
    const isTimestamp = role === "value" && parent?.kind === "object" && parent.isRoot && parent.key === "timestamp";
    const isMessageRole = role === "value" && parent?.kind === "object" && parent.isMessageObject && parent.key === "role";
    const isUserText = role === "value" && parent?.kind === "object"
      && ((parent.isContentItem && parent.key === "text") || (parent.isMessageObject && parent.key === "content"));
    this.#string = {
      role, value: "", overflow: false,
      maxLength: isTitle ? MAX_STREAMED_TITLE_CHARS : isTimestamp ? 64 : isUserText ? MAX_STREAMED_PROMPT_CHARS : 32,
      truncate: isTitle || isTimestamp || isMessageRole || isUserText,
      escaped: false, unicode: null,
    };
  }

  #consumeString(char: string): void {
    const string = this.#string!;
    if (string.unicode !== null) {
      if (!/^[0-9a-fA-F]$/.test(char)) {
        this.#valid = false;
        return;
      }
      string.unicode += char;
      if (string.unicode.length === 4) {
        this.#appendStringCharacter(String.fromCharCode(Number.parseInt(string.unicode, 16)));
        string.unicode = null;
      }
      return;
    }
    if (string.escaped) {
      const escaped = JSON_ESCAPES[char];
      if (escaped === undefined) {
        if (char === "u") {
          string.unicode = "";
          string.escaped = false;
        } else this.#valid = false;
      } else {
        this.#appendStringCharacter(escaped);
        string.escaped = false;
      }
      return;
    }
    if (char === '"') this.#finishString();
    else if (char === "\\") string.escaped = true;
    else if (char.charCodeAt(0) < 0x20) this.#valid = false;
    else this.#appendStringCharacter(char);
  }

  #appendStringCharacter(char: string): void {
    const string = this.#string!;
    if (string.overflow || string.value.length >= string.maxLength) return;
    if (string.value.length + char.length > string.maxLength) {
      if (string.truncate) string.value += char.slice(0, string.maxLength - string.value.length);
      else {
        string.overflow = true;
        string.value = "";
      }
    } else string.value += char;
  }

  #finishString(): void {
    const string = this.#string!;
    this.#string = null;
    const value = string.overflow ? null : string.value;
    if (string.role === "key") {
      const container = this.#stack.at(-1);
      if (!container || container.kind !== "object" || container.state !== "keyOrEnd") {
        this.#valid = false;
        return;
      }
      container.key = value;
      container.afterComma = false;
      container.state = "colon";
    } else this.#completeValue(value);
  }

  #consumeToken(char: string): void {
    const token = this.#token!;
    if (token.kind === "literal") {
      if (token.expected[token.index] !== char) this.#valid = false;
      else token.index += 1;
      return;
    }
    const transitions: Record<JsonNumberState, string> = {
      minus: "digit", zero: "eE.", integer: "digit.eE", fractionStart: "digit", fraction: "digit eE",
      exponentStart: "digit+-", exponentSign: "digit", exponent: "digit",
    };
    if (!transitions[token.state].includes(isJsonDigit(char) ? "digit" : char)) {
      this.#valid = false;
      return;
    }
    if (token.state === "minus") token.state = char === "0" ? "zero" : "integer";
    else if (token.state === "zero" || token.state === "integer") {
      if (char === ".") token.state = "fractionStart";
      else if (char === "e" || char === "E") token.state = "exponentStart";
    } else if (token.state === "fractionStart") token.state = "fraction";
    else if (token.state === "fraction" && (char === "e" || char === "E")) token.state = "exponentStart";
    else if (token.state === "exponentStart") token.state = char === "+" || char === "-" ? "exponentSign" : "exponent";
    else if (token.state === "exponentSign") token.state = "exponent";
  }

  #finishToken(): void {
    const token = this.#token!;
    this.#token = null;
    if (token.kind === "literal" ? token.index !== token.expected.length : !["zero", "integer", "fraction", "exponent"].includes(token.state)) {
      this.#valid = false;
      return;
    }
    this.#completeValue(null);
  }

  #markNonStringValue(parent: JsonContainer | undefined): void {
    if (parent?.kind !== "object") return;
    if (parent.isRoot && parent.key === "type") this.#rootType = null;
    if (parent.isRoot && parent.key === "timestamp") this.#rootTimestamp = undefined;
    if (parent.isMessageObject && parent.key === "role") {
      this.#messageRole = null;
      this.#hasMessageRole = false;
    }
  }

  #completeValue(value: string | null): void {
    const parent = this.#stack.at(-1);
    if (!parent) {
      this.#rootState = "done";
      return;
    }
    if (parent.kind === "object") {
      if (parent.state !== "value") {
        this.#valid = false;
        return;
      }
      if (parent.isRoot && parent.key === "type") this.#rootType = value === "message" || value === "session_info" ? value : null;
      if (parent.isRoot && parent.key === "name" && value !== null) this.#sessionInfoTitle = value;
      if (parent.isRoot && parent.key === "timestamp" && value !== null) this.#rootTimestamp = value;
      if (parent.isMessageObject && parent.key === "role") {
        this.#hasMessageRole = value !== null && value.length > 0;
        this.#messageRole = value === "user" || value === "assistant" ? value : null;
      }
      if (((parent.isContentItem && parent.key === "text") || (parent.isMessageObject && parent.key === "content")) && value !== null) {
        this.#messageText = `${this.#messageText ?? ""}${value}`.slice(0, MAX_STREAMED_PROMPT_CHARS);
      }
      parent.state = "commaOrEnd";
    } else {
      if (parent.state !== "valueOrEnd") {
        this.#valid = false;
        return;
      }
      parent.state = "commaOrEnd";
    }
  }

  #closeContainer(): void {
    this.#stack.pop();
    this.#completeValue(null);
  }
}

const JSON_ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
function isJsonWhitespace(char: string): boolean { return char === " " || char === "\t" || char === "\r"; }
function isJsonDelimiter(char: string): boolean { return isJsonWhitespace(char) || char === "," || char === "]" || char === "}"; }
function isJsonDigit(char: string): boolean { return char >= "0" && char <= "9"; }
