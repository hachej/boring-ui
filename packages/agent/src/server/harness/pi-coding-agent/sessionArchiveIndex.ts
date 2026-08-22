import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Archiving is a VISIBILITY state, never a deletion. Transcripts are host app
 * user data (AGENTS.md rule 9), so the flag is deliberately kept OUT of the
 * JSONL transcript and parked in a sidecar index beside it, in the very same
 * durable session directory (BORING_AGENT_SESSION_ROOT):
 *
 *   <sessionDir>/archived.json
 *
 * Two properties fall out of that choice, and both are what make "archive can
 * never lose data" checkable rather than merely asserted:
 *
 *  - The transcript bytes are untouched, so unarchive restores the exact
 *    session — there is nothing to restore, it was never modified.
 *  - The transcript mtime is untouched, so archiving does not reshuffle a list
 *    that sorts by last activity.
 *
 * A missing, empty, or corrupt index simply means "nothing is archived": the
 * sidecar can never make a real session disappear.
 */
export const SESSION_ARCHIVE_INDEX_FILENAME = "archived.json";

const ARCHIVE_INDEX_VERSION = 1;

interface ArchiveIndexFile {
  version: number;
  /** sessionId -> ISO timestamp the session was archived at. */
  archived: Record<string, string>;
}

function archiveIndexPath(sessionDir: string): string {
  return join(sessionDir, SESSION_ARCHIVE_INDEX_FILENAME);
}

function parseArchiveIndex(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) return {};
  const archived = (parsed as ArchiveIndexFile).archived;
  if (typeof archived !== "object" || archived === null) return {};
  const entries: Record<string, string> = {};
  for (const [sessionId, archivedAt] of Object.entries(archived)) {
    if (typeof sessionId === "string" && sessionId && typeof archivedAt === "string") {
      entries[sessionId] = archivedAt;
    }
  }
  return entries;
}

/**
 * Production creates several PiSessionStore instances over one shared session
 * directory, and each store serializes writers only through its OWN instance
 * queue — so caller-side serialization cannot protect the shared sidecar. All
 * read-modify-write mutations below therefore serialize HERE, keyed by the
 * canonical directory, which makes concurrent archives from any number of
 * store instances (or bare callers) accumulate instead of overwrite.
 */
const dirLocks = new Map<string, Promise<unknown>>();

async function withDirectoryLock<T>(sessionDir: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(sessionDir);
  const previous = dirLocks.get(key) ?? Promise.resolve();
  const gate = previous.then(() => {}, () => {});
  const result = gate.then(action);
  const tail = result.then(() => {}, () => {});
  dirLocks.set(key, tail);
  void tail.then(() => {
    if (dirLocks.get(key) === tail) dirLocks.delete(key);
  });
  return result;
}

/** Every archived session id in this directory. Absent/corrupt index = none. */
export async function readSessionArchiveIndex(sessionDir: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(archiveIndexPath(sessionDir), "utf-8");
  } catch {
    return {};
  }
  try {
    return parseArchiveIndex(raw);
  } catch {
    // A truncated or hand-edited index must not hide real sessions.
    return {};
  }
}

export async function readArchivedSessionIds(sessionDir: string): Promise<Set<string>> {
  return new Set(Object.keys(await readSessionArchiveIndex(sessionDir)));
}

/**
 * Read-modify-write the sidecar atomically (temp file + rename inside the same
 * directory, so the swap is never half-written) and serialized across ALL
 * store instances sharing the directory via the per-directory lock above.
 *
 * Returns true when the index changed.
 */
export async function writeSessionArchived(
  sessionDir: string,
  sessionId: string,
  archived: boolean,
  now = new Date(),
): Promise<boolean> {
  return await withDirectoryLock(sessionDir, async () => {
    const entries = await readSessionArchiveIndex(sessionDir);
    const wasArchived = entries[sessionId] !== undefined;
    if (wasArchived === archived) return false;
    if (archived) entries[sessionId] = now.toISOString();
    else delete entries[sessionId];
    await persist(sessionDir, entries);
    return true;
  });
}

/** Housekeeping for a genuinely deleted session; never called by archiving. */
export async function forgetArchivedSession(sessionDir: string, sessionId: string): Promise<void> {
  await withDirectoryLock(sessionDir, async () => {
    const entries = await readSessionArchiveIndex(sessionDir);
    if (entries[sessionId] === undefined) return;
    delete entries[sessionId];
    await persist(sessionDir, entries);
  });
}

async function persist(sessionDir: string, entries: Record<string, string>): Promise<void> {
  const file: ArchiveIndexFile = { version: ARCHIVE_INDEX_VERSION, archived: entries };
  await mkdir(sessionDir, { recursive: true });
  const target = archiveIndexPath(sessionDir);
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}
