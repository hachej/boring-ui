import { randomUUID } from "node:crypto";
import { appendFile, readFile, stat as fsStat, utimes } from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type SessionEntry,
  type SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
import { parseJsonlPrefixEntries, readJsonlPrefix } from "./sessionJsonlPrefix.js";
import { parseSessionTranscript } from "./nativeSessionTranscript.js";
import {
  USER_SESSION_TITLE_CUSTOM_TYPE,
  createUserSessionTitleEntries,
  userSessionTitleData,
  userSessionTitleFromSequence,
  type PhysicalSessionEntry,
} from "./sessionTitleAuthority.js";

const SESSION_TITLE_MAX_APPEND_ATTEMPTS = 3;
const SESSION_TITLE_RETRY_CUSTOM_TYPE = "boring.session-title-retry";

interface SessionTitleAppend {
  title: { id: string; parentId: string | null };
  authority: { id: string; parentId: string | null };
}

interface StableFileRead {
  before: Stats;
  after: Stats;
  content: string;
}

function sameSnapshot(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino
    && a.size === b.size
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs;
}

async function readStableFile(filepath: string): Promise<StableFileRead | null> {
  const before = await fsStat(filepath);
  const content = await readFile(filepath, "utf-8");
  const after = await fsStat(filepath);
  return sameSnapshot(before, after) ? { before, after, content } : null;
}

/** Restore mtime only while the exact verified append is still the file tail. */
async function restoreVerifiedRenameMtime(
  filepath: string,
  before: Stats,
  verifiedSize: number,
): Promise<void> {
  try {
    const current = await fsStat(filepath);
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== verifiedSize) return;

    const atimeSeconds = fileTimeSeconds(before.atimeMs);
    const mtimeSeconds = fileTimeSeconds(before.mtimeMs);
    if (atimeSeconds === undefined || mtimeSeconds === undefined) return;
    await utimes(filepath, atimeSeconds, mtimeSeconds);

    const restored = await fsStat(filepath);
    if (restored.size !== verifiedSize) {
      const restoredAtimeSeconds = fileTimeSeconds(restored.atimeMs);
      if (restoredAtimeSeconds !== undefined) await utimes(filepath, restoredAtimeSeconds, Date.now() / 1000);
    }
  } catch {
    // A rename succeeded; timestamp restoration is strictly best-effort.
  }
}

function committedPhysicalLines(content: string): string[] {
  const lines = content.split("\n");
  if (!content.endsWith("\n")) lines.pop();
  return lines;
}

/** Verify the exact predecessor -> marker -> title chain from physical records. */
function hasVerifiedTitleSequence(
  content: string,
  append: SessionTitleAppend,
  title: string,
): boolean {
  let parent: PhysicalSessionEntry | undefined;
  let marker: PhysicalSessionEntry | undefined;
  let previousKnown = false;
  let markerPredecessorKnown = false;

  for (const line of committedPhysicalLines(content)) {
    if (!line.trim()) continue;
    let entry: PhysicalSessionEntry;
    try {
      entry = JSON.parse(line) as PhysicalSessionEntry;
    } catch {
      parent = undefined;
      marker = undefined;
      previousKnown = false;
      markerPredecessorKnown = false;
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
      parent = undefined;
      marker = undefined;
      previousKnown = false;
      markerPredecessorKnown = false;
      continue;
    }
    if (entry.type === "session" || entry.type === "pi_session_file") {
      parent = undefined;
      marker = undefined;
      previousKnown = true;
      markerPredecessorKnown = false;
      continue;
    }

    if (entry.id === append.title.id
      && marker?.id === append.authority.id
      && markerPredecessorKnown
      && marker.parentId === append.authority.parentId
      && entry.parentId === append.title.parentId
      && userSessionTitleFromSequence(parent, marker, entry) === title) return true;

    parent = marker;
    marker = entry;
    markerPredecessorKnown = previousKnown;
    previousKnown = true;
  }
  return false;
}

async function verifyTitleSequence(
  filepath: string,
  append: SessionTitleAppend,
  title: string,
): Promise<{ stat: Stats; content: string; tailId: string | null } | null> {
  const snapshot = await readStableFile(filepath);
  if (!snapshot || !hasVerifiedTitleSequence(snapshot.content, append, title)) return null;
  const parsed = parseSessionTranscript(snapshot.content);
  const tailId = parsed.entries
    .filter((entry): entry is SessionEntry => entry.type !== "session" && typeof (entry as { id?: unknown }).id === "string")
    .at(-1)?.id ?? null;
  return { stat: snapshot.after, content: snapshot.content, tailId };
}

function isExactRenameOnlyAppend(origin: StableFileRead, verifiedContent: string, append: SessionTitleAppend): boolean {
  const prefix = `${origin.content}${origin.content.endsWith("\n") ? "" : "\n"}`;
  if (!verifiedContent.startsWith(prefix)) return false;
  const suffix = verifiedContent.slice(prefix.length);
  const lines = suffix.split("\n");
  if (lines.length !== 3 || lines[2] !== "" || !lines[0]?.trim() || !lines[1]?.trim()) return false;
  try {
    const entries = lines.slice(0, 2).map((line) => JSON.parse(line) as PhysicalSessionEntry);
    return entries[0]?.id === append.authority.id && entries[1]?.id === append.title.id;
  } catch {
    return false;
  }
}

function physicalTail(content: string): {
  endsWithNewline: boolean;
  valid: boolean;
  parentId: string | null;
} {
  const endsWithNewline = content.length === 0 || content.endsWith("\n");
  const line = content.split("\n").reverse().find((candidate) => candidate.trim());
  if (!line) return { endsWithNewline, valid: true, parentId: null };
  try {
    const entry = JSON.parse(line) as PhysicalSessionEntry;
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
      return { endsWithNewline, valid: false, parentId: null };
    }
    if (entry.type === "session" || entry.type === "pi_session_file") {
      return { endsWithNewline, valid: true, parentId: null };
    }
    return typeof entry.id === "string" && entry.id
      ? { endsWithNewline, valid: true, parentId: entry.id }
      : { endsWithNewline, valid: false, parentId: null };
  } catch {
    return { endsWithNewline, valid: false, parentId: null };
  }
}

function latestConcurrentEntryId(manager: SessionManager, staleRenameIds: ReadonlySet<string>): string | null {
  for (const entry of manager.getEntries().reverse()) {
    if (!staleRenameIds.has(entry.id)) return entry.id;
  }
  return null;
}

function sessionTitleLockedError(message = "session changed while renaming; retry"): Error {
  return Object.assign(new Error(message), {
    code: ErrorCode.enum.SESSION_LOCKED,
    statusCode: 409,
    retryable: true,
  });
}

function sessionTranscriptUnreadableError(message: string): Error {
  return Object.assign(new Error(message), {
    code: ErrorCode.enum.SESSION_TRANSCRIPT_UNREADABLE,
    statusCode: 500,
    retryable: false,
  });
}

async function repairNativeTerminalNewline(filepath: string): Promise<boolean> {
  const snapshot = await readStableFile(filepath);
  if (!snapshot) return false;
  const tail = physicalTail(snapshot.content);
  if (tail.endsWithNewline) return true;
  if (!tail.valid) throw sessionTitleLockedError("native session has an incomplete transcript record");
  await appendFile(filepath, "\n");
  const repaired = await readStableFile(filepath);
  return Boolean(repaired?.content.endsWith("\n"));
}

export async function appendVerifiedNativeRename(
  filepath: string,
  sessionDir: string,
  cwd: string,
  title: string,
): Promise<void> {
  const staleRenameIds = new Set<string>();
  let renameOnlyOrigin: StableFileRead | undefined;
  for (let attempt = 0; attempt < SESSION_TITLE_MAX_APPEND_ATTEMPTS; attempt += 1) {
    const attemptOrigin = await readStableFile(filepath);
    if (!attemptOrigin) continue;
    if (attempt === 0) renameOnlyOrigin = attemptOrigin;
    const header = parseJsonlPrefixEntries(await readJsonlPrefix(filepath)).find(
        (entry): entry is SessionHeader => entry.type === "session",
      );
      if (header?.version !== CURRENT_SESSION_VERSION) {
        throw sessionTitleLockedError("This native session was created by an unsupported Pi version and cannot be renamed.");
      }
      if (!await repairNativeTerminalNewline(filepath)) continue;
      const committed = await readStableFile(filepath);
      if (!committed) continue;
      if (!physicalTail(committed.content).valid) {
        throw sessionTranscriptUnreadableError("native session contains a malformed transcript record");
      }
      const manager = SessionManager.open(filepath, sessionDir, cwd);
      if (staleRenameIds.size > 0) {
        const concurrentLeaf = latestConcurrentEntryId(manager, staleRenameIds);
        if (!concurrentLeaf) break;
        manager.branch(concurrentLeaf);
        manager.appendCustomEntry(SESSION_TITLE_RETRY_CUSTOM_TYPE, {});
      }

      const beforeAppend = await readStableFile(filepath);
      if (!beforeAppend || !beforeAppend.content.endsWith("\n")) continue;
      const tail = physicalTail(beforeAppend.content);
      const authorityParentId = manager.getLeafId();
      if (!tail.valid || tail.parentId !== authorityParentId) continue;
      const authorityId = manager.appendCustomEntry(
        USER_SESSION_TITLE_CUSTOM_TYPE,
        userSessionTitleData(title),
      );
      const titleId = manager.appendSessionInfo(title);
      const append: SessionTitleAppend = {
        authority: { id: authorityId, parentId: authorityParentId },
        title: { id: titleId, parentId: authorityId },
      };
      staleRenameIds.add(authorityId);
      staleRenameIds.add(titleId);

      const verified = await verifyTitleSequence(filepath, append, title);
      if (!verified) continue;
      if (attempt === 0
        && verified.tailId === titleId
        && renameOnlyOrigin
        && isExactRenameOnlyAppend(renameOnlyOrigin, verified.content, append)) {
        await restoreVerifiedRenameMtime(filepath, renameOnlyOrigin.before, Number(verified.stat.size));
      }
      return;
  }
  throw sessionTitleLockedError();
}

function wrapperPredecessor(content: string): {
  parentId: string | null;
  separator: string;
} {
  const tail = physicalTail(content);
  if (!tail.valid) {
    if (!tail.endsWithNewline) throw sessionTitleLockedError("session has an incomplete transcript record");
    throw sessionTranscriptUnreadableError("session contains a malformed transcript record");
  }
  return {
    parentId: tail.parentId,
    separator: tail.endsWithNewline ? "" : "\n",
  };
}

/** Optimistic append for wrapper JSONL files; permanent filesystem errors propagate. */
export async function appendVerifiedWrapperRename(filepath: string, title: string): Promise<void> {
  let renameOnlyStart: Stats | undefined;
  for (let attempt = 0; attempt < SESSION_TITLE_MAX_APPEND_ATTEMPTS; attempt += 1) {
    const snapshot = await readStableFile(filepath);
    if (!snapshot) continue;
    renameOnlyStart ??= snapshot.before;
    const timestamp = new Date().toISOString();
    const predecessor = wrapperPredecessor(snapshot.content);
    const pair = createUserSessionTitleEntries({
      title,
      parentId: predecessor.parentId,
      timestamp,
      authorityId: randomUUID(),
      titleId: randomUUID(),
    });
    const append: SessionTitleAppend = {
      authority: { id: pair.authority.id, parentId: pair.authority.parentId },
      title: { id: pair.title.id, parentId: pair.title.parentId },
    };
    const records = [pair.authority, pair.title]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const payload = `${predecessor.separator}${records}\n`;
    await appendFile(filepath, payload);

    const verified = await verifyTitleSequence(filepath, append, title);
    if (!verified) continue;
    const exactSize = Number(snapshot.after.size) + Buffer.byteLength(payload);
    if (attempt === 0 && Number(verified.stat.size) === exactSize && renameOnlyStart) {
      await restoreVerifiedRenameMtime(filepath, renameOnlyStart, exactSize);
    }
    return;
  }
  throw sessionTitleLockedError();
}

function fileTimeSeconds(milliseconds: number): number | undefined {
  const seconds = milliseconds / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
}
