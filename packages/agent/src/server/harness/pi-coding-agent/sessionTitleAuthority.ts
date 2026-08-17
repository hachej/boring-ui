import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export const USER_SESSION_TITLE_CUSTOM_TYPE = "boring.session-title-authority";
const MAX_PARSED_AUTHORITY_RECORD_BYTES = 64 * 1024;

interface UserSessionTitleData {
  titleSetByUser: true;
  title: string;
}

interface PhysicalSessionEntry {
  type: string;
  id: string;
  parentId?: string | null;
  customType?: string;
  data?: unknown;
  name?: unknown;
}

type PhysicalRecord =
  | { kind: "session-header" }
  | { kind: "entry"; entry: PhysicalSessionEntry }
  | { kind: "invalid" };

export function userSessionTitleData(title: string): UserSessionTitleData {
  return { titleSetByUser: true, title };
}

/**
 * Authority is a physically contiguous parent -> marker -> session_info chain.
 * Partial, stale-branch, and malformed/interleaved appends therefore stay inert.
 */
export function userSessionTitleFromSequence(
  parent: PhysicalSessionEntry | undefined,
  marker: PhysicalSessionEntry | undefined,
  titleEntry: PhysicalSessionEntry | undefined,
): string | undefined {
  if (marker?.type !== "custom" || marker.customType !== USER_SESSION_TITLE_CUSTOM_TYPE) return undefined;
  if (marker.parentId !== (parent?.id ?? null)) return undefined;
  if (titleEntry?.type !== "session_info" || titleEntry.parentId !== marker.id) return undefined;
  const data = marker.data as Partial<UserSessionTitleData> | null | undefined;
  if (data?.titleSetByUser !== true || typeof data.title !== "string") return undefined;
  const title = data.title.replace(/[\r\n]+/g, " ").trim();
  return title && titleEntry.name === title ? title : undefined;
}

/** Streams only compact authority records; giant snapshot/message payloads are never JSON-parsed. */
export async function summarizeUserSessionTitle(filepath: string): Promise<string | undefined> {
  let parent: PhysicalSessionEntry | undefined;
  let marker: PhysicalSessionEntry | undefined;
  let userTitle: string | undefined;
  const lines = createInterface({ input: createReadStream(filepath, { encoding: "utf-8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = physicalRecord(line);
    if (record.kind !== "entry") {
      parent = undefined;
      marker = undefined;
      continue;
    }
    userTitle = userSessionTitleFromSequence(parent, marker, record.entry) ?? userTitle;
    parent = marker;
    marker = record.entry;
  }
  return userTitle;
}

function physicalRecord(line: string): PhysicalRecord {
  if (!line.trim()) return { kind: "invalid" };

  if (Buffer.byteLength(line, "utf-8") <= MAX_PARSED_AUTHORITY_RECORD_BYTES) {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (!value || typeof value !== "object" || typeof value.type !== "string") return { kind: "invalid" };
      if (value.type === "session") return { kind: "session-header" };
      if (typeof value.id !== "string") return { kind: "invalid" };
      return { kind: "entry", entry: value as unknown as PhysicalSessionEntry };
    } catch {
      return { kind: "invalid" };
    }
  }

  // Pi writes type then id before payloads. Validate container boundaries while
  // scanning the line, but do not materialize giant message/snapshot payloads.
  if (!hasValidJsonSyntax(line)) return { kind: "invalid" };
  const type = /^\s*\{\s*"type"\s*:\s*"([^"\\]+)"/.exec(line)?.[1];
  if (!type) return { kind: "invalid" };
  if (type === "session") return { kind: "session-header" };
  const id = /^\s*\{\s*"type"\s*:\s*"[^"\\]+"\s*,\s*"id"\s*:\s*"([^"\\]+)"/.exec(line)?.[1];
  return id
    ? { kind: "entry", entry: { type, id } }
    : { kind: "invalid" };
}

function hasValidJsonSyntax(source: string): boolean {
  let offset = 0;
  let depth = 0;

  const skipWhitespace = () => {
    while (offset < source.length && /[\t\n\r ]/.test(source[offset])) offset += 1;
  };
  const parseString = (): boolean => {
    if (source[offset++] !== '"') return false;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === '"') return true;
      if (char.charCodeAt(0) < 0x20) return false;
      if (char !== "\\") continue;
      const escape = source[offset++];
      if ('"\\/bfnrt'.includes(escape)) continue;
      if (escape !== "u" || !/^[0-9a-fA-F]{4}$/.test(source.slice(offset, offset + 4))) return false;
      offset += 4;
    }
    return false;
  };
  const parseNumber = (): boolean => {
    const start = offset;
    if (source[offset] === "-") offset += 1;
    if (source[offset] === "0") offset += 1;
    else if (/[1-9]/.test(source[offset] ?? "")) {
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    } else return false;
    if (source[offset] === ".") {
      offset += 1;
      if (!/[0-9]/.test(source[offset] ?? "")) return false;
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    }
    if (source[offset] === "e" || source[offset] === "E") {
      offset += 1;
      if (source[offset] === "+" || source[offset] === "-") offset += 1;
      if (!/[0-9]/.test(source[offset] ?? "")) return false;
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    }
    return offset > start;
  };
  const parseValue = (): boolean => {
    skipWhitespace();
    if (depth > 128) return false;
    if (source[offset] === '"') return parseString();
    if (source[offset] === "-" || /[0-9]/.test(source[offset] ?? "")) return parseNumber();
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return true;
      }
    }
    const opening = source[offset];
    if (opening !== "{" && opening !== "[") return false;
    const closing = opening === "{" ? "}" : "]";
    offset += 1;
    depth += 1;
    skipWhitespace();
    if (source[offset] === closing) {
      offset += 1;
      depth -= 1;
      return true;
    }
    while (offset < source.length) {
      if (opening === "{" && (!parseString() || (skipWhitespace(), source[offset++] !== ":"))) return false;
      if (!parseValue()) return false;
      skipWhitespace();
      const separator = source[offset++];
      if (separator === closing) {
        depth -= 1;
        return true;
      }
      if (separator !== ",") return false;
      skipWhitespace();
    }
    return false;
  };

  const valid = parseValue();
  skipWhitespace();
  return valid && offset === source.length && depth === 0;
}
