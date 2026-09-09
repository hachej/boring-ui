import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Archive state is physically sharded by session, just like the transcript it
 * describes. A shared aggregate would turn unrelated sessions into one
 * read-modify-write contention domain and cannot be made safe across host
 * processes without a separate lock service.
 *
 * Each final marker is created by atomic rename inside this directory:
 *
 *   <sessionDir>/.archive/<base64url(sessionId)>.json
 *
 * Marker files never contain transcript data and never require opening a
 * transcript through a load/repair path.
 */
export const SESSION_ARCHIVE_DIRECTORY_NAME = ".archive";

const ARCHIVE_MARKER_VERSION = 1;
const ARCHIVE_MARKER_SUFFIX = ".json";

interface ArchiveMarkerFile {
  version: number;
  sessionId: string;
  archivedAt: string;
}

function archiveDirectory(sessionDir: string): string {
  return join(sessionDir, SESSION_ARCHIVE_DIRECTORY_NAME);
}

function markerFilename(sessionId: string): string {
  return `${Buffer.from(sessionId, "utf8").toString("base64url")}${ARCHIVE_MARKER_SUFFIX}`;
}

function markerPath(sessionDir: string, sessionId: string): string {
  return join(archiveDirectory(sessionDir), markerFilename(sessionId));
}

function parseMarker(raw: string): ArchiveMarkerFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ArchiveMarkerFile>;
    return parsed.version === ARCHIVE_MARKER_VERSION
      && typeof parsed.sessionId === "string"
      && parsed.sessionId.length > 0
      && typeof parsed.archivedAt === "string"
      ? parsed as ArchiveMarkerFile
      : null;
  } catch {
    return null;
  }
}

/** Every valid archived session id in this directory. Corrupt markers are ignored. */
export async function readArchivedSessionIds(sessionDir: string): Promise<Set<string>> {
  const directory = archiveDirectory(sessionDir);
  const files = await readdir(directory).catch(() => []);
  const ids = new Set<string>();
  await Promise.all(files
    .filter((file) => file.endsWith(ARCHIVE_MARKER_SUFFIX))
    .map(async (file) => {
      const marker = parseMarker(await readFile(join(directory, file), "utf8").catch(() => ""));
      // The filename binds the marker to the id. This also ignores a marker
      // copied or hand-edited under another session's name.
      if (marker && file === markerFilename(marker.sessionId)) ids.add(marker.sessionId);
    }));
  return ids;
}

/**
 * Atomically create or remove one session's marker. Different sessions never
 * share a writable file, so independent processes cannot lose one another's
 * updates. Concurrent opposite-state operations are ordinary last-filesystem-
 * operation-wins updates and never affect the transcript.
 */
export async function writeSessionArchived(
  sessionDir: string,
  sessionId: string,
  archived: boolean,
  now = new Date(),
): Promise<boolean> {
  const target = markerPath(sessionDir, sessionId);
  if (!archived) {
    try {
      await rm(target);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw error;
    }
  }

  await mkdir(archiveDirectory(sessionDir), { recursive: true });
  const marker: ArchiveMarkerFile = {
    version: ARCHIVE_MARKER_VERSION,
    sessionId,
    archivedAt: now.toISOString(),
  };
  const tmp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(marker)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tmp, target);
    return true;
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Housekeeping for a genuinely deleted session; never called by archiving. */
export async function forgetArchivedSession(sessionDir: string, sessionId: string): Promise<void> {
  await rm(markerPath(sessionDir, sessionId), { force: true });
}
