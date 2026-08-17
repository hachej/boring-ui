import { open, stat as fsStat, utimes } from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type SessionHeader,
} from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
import { parseJsonlPrefixEntries, readJsonlPrefix } from "./sessionJsonlPrefix.js";
import { USER_SESSION_TITLE_CUSTOM_TYPE, userSessionTitleData } from "./sessionTitleAuthority.js";

const NATIVE_RENAME_MAX_APPEND_BYTES = 64 * 1024;
const NATIVE_RENAME_MAX_ATTEMPTS = 3;

interface NativeRenameAppend {
  title: { id: string; parentId: string | null };
  authority: { id: string; parentId: string | null };
}

/** Restore mtime only while the exact verified append is still the file tail. */
async function restoreVerifiedNativeRenameMtime(
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

/** Reads only the bounded suffix written since the attempt's pre-append stat. */
async function verifiedNativeRenameAppend(
  filepath: string,
  before: Stats,
  append: NativeRenameAppend,
  title: string,
): Promise<number | null> {
  const after = await fsStat(filepath);
  if (after.dev !== before.dev || after.ino !== before.ino) return null;

  const appendedBytes = after.size - before.size;
  if (!Number.isSafeInteger(before.size) || !Number.isSafeInteger(after.size)
    || appendedBytes <= 0 || appendedBytes > NATIVE_RENAME_MAX_APPEND_BYTES) return null;

  const handle = await open(filepath, "r");
  try {
    const record = Buffer.allocUnsafe(appendedBytes);
    const { bytesRead } = await handle.read(record, 0, record.length, before.size);
    if (bytesRead !== record.length || record.at(-1) !== 0x0a) return null;
    const lines = record.toString("utf-8").trimEnd().split("\n");
    if (lines.length !== 2) return null;
    const authorityEntry = JSON.parse(lines[0]!) as { type?: unknown; id?: unknown; parentId?: unknown; customType?: unknown; data?: unknown };
    const titleEntry = JSON.parse(lines[1]!) as { type?: unknown; id?: unknown; parentId?: unknown; name?: unknown };
    const data = authorityEntry.data as { titleSetByUser?: unknown; title?: unknown } | null | undefined;
    return titleEntry.type === "session_info"
      && titleEntry.id === append.title.id
      && titleEntry.parentId === append.title.parentId
      && titleEntry.name === title
      && authorityEntry.type === "custom"
      && authorityEntry.id === append.authority.id
      && authorityEntry.parentId === append.authority.parentId
      && authorityEntry.customType === USER_SESSION_TITLE_CUSTOM_TYPE
      && data?.titleSetByUser === true
      && data.title === title
      ? after.size
      : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

function latestConcurrentEntryId(manager: SessionManager, staleRenameIds: ReadonlySet<string>): string | null {
  for (const entry of manager.getEntries().reverse()) {
    if (!staleRenameIds.has(entry.id)) return entry.id;
  }
  return null;
}

function nativeRenameLockedError(message = "native session changed while renaming; retry"): Error {
  return Object.assign(new Error(message), {
    code: ErrorCode.enum.SESSION_LOCKED,
    statusCode: 409,
    retryable: true,
  });
}

export async function appendVerifiedNativeRename(
  filepath: string,
  sessionDir: string,
  cwd: string,
  title: string,
): Promise<void> {
  const staleRenameIds = new Set<string>();
  for (let attempt = 0; attempt < NATIVE_RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Stat before opening so any append between open and append is inside the
      // bounded inspected suffix and forces a fresh branch attempt.
      const before = await fsStat(filepath);
      const header = parseJsonlPrefixEntries(await readJsonlPrefix(filepath)).find(
        (entry): entry is SessionHeader => entry.type === "session",
      );
      if (header?.version !== CURRENT_SESSION_VERSION) {
        throw nativeRenameLockedError("This native session was created by an unsupported Pi version and cannot be renamed.");
      }
      const manager = SessionManager.open(filepath, sessionDir, cwd);
      if (staleRenameIds.size > 0) {
        const concurrentLeaf = latestConcurrentEntryId(manager, staleRenameIds);
        if (!concurrentLeaf) break;
        manager.branch(concurrentLeaf);
      }
      const authorityParentId = manager.getLeafId();
      const authorityId = manager.appendCustomEntry(
        USER_SESSION_TITLE_CUSTOM_TYPE,
        userSessionTitleData(title),
      );
      const titleParentId = manager.getLeafId();
      const titleId = manager.appendSessionInfo(title);
      const append: NativeRenameAppend = {
        title: { id: titleId, parentId: titleParentId },
        authority: { id: authorityId, parentId: authorityParentId },
      };
      staleRenameIds.add(titleId);
      staleRenameIds.add(authorityId);
      const verifiedSize = await verifiedNativeRenameAppend(filepath, before, append, title);
      if (verifiedSize !== null) {
        await restoreVerifiedNativeRenameMtime(filepath, before, verifiedSize);
        return;
      }
    } catch (error) {
      if ((error as { code?: unknown }).code === ErrorCode.enum.SESSION_LOCKED) throw error;
      // The next bounded optimistic attempt reopens Pi's latest session tree.
    }
  }
  throw nativeRenameLockedError();
}

function fileTimeSeconds(milliseconds: number): number | undefined {
  const seconds = milliseconds / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
}
