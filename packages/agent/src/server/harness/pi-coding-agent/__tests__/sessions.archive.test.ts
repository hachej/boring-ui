import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiSessionStore } from "../sessions.js";
import { SESSION_ARCHIVE_INDEX_FILENAME } from "../sessionArchiveIndex.js";

/**
 * Archiving is a VISIBILITY state. The contract these tests defend is that it
 * can never lose a session: the transcript bytes and mtime are untouched, the
 * flag survives a fresh store instance (it is on the durable session volume,
 * not in process memory), and unarchive restores the row exactly.
 */
describe("PiSessionStore archive state", () => {
  const ctx = { workspaceId: "default" };
  let sessionDir: string;
  let store: PiSessionStore;

  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), "pi-session-archive-"));
    store = new PiSessionStore("/workspace", { sessionDir });
  });

  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  /** A real chat: the transcript the store creates plus one user turn, so the
   * session is not the turn-less placeholder that listings deliberately hide. */
  async function seedTranscript(title: string): Promise<string> {
    const created = await store.create(ctx, { title });
    const path = await transcriptPathFor(created.id);
    const existing = await readFile(path, "utf-8");
    const turn = `${JSON.stringify({
      type: "message",
      id: `${created.id}-turn`,
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
    })}\n`;
    await writeFile(path, `${existing}${turn}`, "utf-8");
    return created.id;
  }

  async function transcriptPathFor(sessionId: string): Promise<string> {
    const files = await readdir(sessionDir);
    const file = files.find((name) => name.endsWith(".jsonl") && name.includes(sessionId));
    if (!file) throw new Error(`transcript for ${sessionId} not found`);
    return join(sessionDir, file);
  }

  it("archives and unarchives without touching the transcript on disk", async () => {
    const sessionId = await seedTranscript("Keep me");
    const path = await transcriptPathFor(sessionId);
    const before = await readFile(path, "utf-8");
    const beforeStat = await stat(path);
    const beforeSummary = await store.load(ctx, sessionId);

    const archived = await store.setArchived(ctx, sessionId, true);
    expect(archived.archived).toBe(true);

    // The bytes AND the last-activity mtime are the same file they were.
    expect(await readFile(path, "utf-8")).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);

    const restored = await store.setArchived(ctx, sessionId, false);
    expect(restored.archived).toBeUndefined();
    expect(await readFile(path, "utf-8")).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);

    // Round trip: every field the session had before it was archived.
    expect(restored).toEqual(beforeSummary);
    const entries = await store.loadEntries(ctx, sessionId);
    expect(entries.messages).toHaveLength(1);
  });

  it("keeps the archived flag on a listing and filters on request", async () => {
    const kept = await seedTranscript("Still working");
    const shelved = await seedTranscript("Finished");
    await store.setArchived(ctx, shelved, true);

    const active = await store.list(ctx, { archived: "active" });
    expect(active.map((session) => session.id)).toEqual([kept]);

    const onlyArchived = await store.list(ctx, { archived: "archived" });
    expect(onlyArchived.map((session) => session.id)).toEqual([shelved]);
    expect(onlyArchived[0]?.archived).toBe(true);

    // The default listing is unchanged for every caller that predates archiving.
    const all = await store.list(ctx);
    expect(all.map((session) => session.id).sort()).toEqual([kept, shelved].sort());
    expect(all.find((session) => session.id === shelved)?.archived).toBe(true);
    expect(all.find((session) => session.id === kept)?.archived).toBeUndefined();
  });

  it("persists the state across store instances on the session volume", async () => {
    const sessionId = await seedTranscript("Durable");
    await store.setArchived(ctx, sessionId, true);

    const index = JSON.parse(await readFile(join(sessionDir, SESSION_ARCHIVE_INDEX_FILENAME), "utf-8")) as {
      version: number
      archived: Record<string, string>
    };
    expect(index.version).toBe(1);
    expect(typeof index.archived[sessionId]).toBe("string");

    const reopened = new PiSessionStore("/workspace", { sessionDir });
    expect((await reopened.load(ctx, sessionId)).archived).toBe(true);
    expect(await reopened.list(ctx, { archived: "active" })).toEqual([]);
  });

  it("treats an unreadable index as nothing archived rather than hiding sessions", async () => {
    const sessionId = await seedTranscript("Never lost");
    await store.setArchived(ctx, sessionId, true);
    await writeFile(join(sessionDir, SESSION_ARCHIVE_INDEX_FILENAME), "{ not json", "utf-8");

    const listed = await store.list(ctx, { archived: "active" });
    expect(listed.map((session) => session.id)).toEqual([sessionId]);
  });

  it("drops the sidecar entry when a session is really deleted", async () => {
    const sessionId = await seedTranscript("Doomed");
    await store.setArchived(ctx, sessionId, true);
    await store.delete(ctx, sessionId);

    const index = JSON.parse(await readFile(join(sessionDir, SESSION_ARCHIVE_INDEX_FILENAME), "utf-8")) as {
      archived: Record<string, string>
    };
    expect(index.archived[sessionId]).toBeUndefined();
  });

  it("keeps both entries when two store instances archive concurrently on one directory", async () => {
    // Production runs several PiSessionStore instances over one shared
    // session root; each instance only serializes through its own writer
    // queue, so the sidecar itself must serialize cross-instance writes.
    const first = await seedTranscript("Concurrent A");
    const second = await seedTranscript("Concurrent B");
    const other = new PiSessionStore("/workspace", { sessionDir });

    const [receiptA, receiptB] = await Promise.all([
      store.setArchived(ctx, first, true),
      other.setArchived(ctx, second, true),
    ]);
    expect(receiptA.archived).toBe(true);
    expect(receiptB.archived).toBe(true);

    const index = JSON.parse(
      await readFile(join(sessionDir, SESSION_ARCHIVE_INDEX_FILENAME), "utf-8"),
    ) as { archived: Record<string, string> };
    expect(typeof index.archived[first]).toBe("string");
    expect(typeof index.archived[second]).toBe("string");

    // Both rows survive from either instance's point of view.
    const archivedList = await other.list(ctx, { archived: "archived" });
    expect(archivedList.map((session) => session.id).sort()).toEqual([first, second].sort());
  });

  it("still resolves an archived session asked for by id", async () => {
    const sessionId = await seedTranscript("Included");
    await store.setArchived(ctx, sessionId, true);
    const listed = await store.list(ctx, { archived: "active", includeId: sessionId });
    expect(listed.map((session) => session.id)).toEqual([sessionId]);
  });
});
