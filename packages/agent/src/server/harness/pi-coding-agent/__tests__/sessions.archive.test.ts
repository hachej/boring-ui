import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { PiSessionStore } from "../sessions.js";
import {
  SESSION_ARCHIVE_DIRECTORY_NAME,
  readArchivedSessionIds,
  writeSessionArchived,
} from "../sessionArchiveIndex.js";

const execFileAsync = promisify(execFile);

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

    expect((await store.setArchived(ctx, sessionId, true)).archived).toBe(true);
    expect(await readFile(path, "utf-8")).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);

    const restored = await store.setArchived(ctx, sessionId, false);
    expect(restored.archived).toBeUndefined();
    expect(await readFile(path, "utf-8")).toBe(before);
    expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);
    expect(restored).toEqual(beforeSummary);
    expect((await store.loadEntries(ctx, sessionId)).messages).toHaveLength(1);
  });

  it("never invokes legacy ui_snapshot repair while archiving", async () => {
    const sessionId = "legacy-ui-snapshot";
    const timestamp = "2026-08-24T12:00:00.000Z";
    const filepath = join(sessionDir, `${sessionId}.jsonl`);
    const bytes = [
      { type: "session", version: 1, id: sessionId, timestamp, cwd: "/workspace", boringSessionCtx: ctx },
      { type: "session_info", id: "title", parentId: null, timestamp, name: "Legacy" },
      { type: "message", id: "turn", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: "hello" }] } },
      { type: "ui_snapshot", id: "legacy-bytes", payload: { must: "remain" } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    await writeFile(filepath, bytes, "utf8");
    const before = await stat(filepath);

    await expect(store.setArchived(ctx, sessionId, true)).resolves.toMatchObject({ id: sessionId, archived: true });
    expect(await readFile(filepath, "utf8")).toBe(bytes);
    expect((await stat(filepath)).mtimeMs).toBe(before.mtimeMs);
  });

  it("keeps the archived flag on a listing and filters on request", async () => {
    const kept = await seedTranscript("Still working");
    const shelved = await seedTranscript("Finished");
    await store.setArchived(ctx, shelved, true);

    expect((await store.list(ctx, { archived: "active" })).map((session) => session.id)).toEqual([kept]);
    const onlyArchived = await store.list(ctx, { archived: "archived" });
    expect(onlyArchived.map((session) => session.id)).toEqual([shelved]);
    expect(onlyArchived[0]?.archived).toBe(true);

    const all = await store.list(ctx);
    expect(all.map((session) => session.id).sort()).toEqual([kept, shelved].sort());
  });

  it("persists one marker per session and accepts prototype-looking ids", async () => {
    const sessionId = await seedTranscript("Durable");
    await store.setArchived(ctx, sessionId, true);
    await writeSessionArchived(sessionDir, "__proto__", true);

    const markers = await readdir(join(sessionDir, SESSION_ARCHIVE_DIRECTORY_NAME));
    expect(markers.filter((name) => name.endsWith(".json"))).toHaveLength(2);
    expect(await readArchivedSessionIds(sessionDir)).toEqual(new Set([sessionId, "__proto__"]));

    const reopened = new PiSessionStore("/workspace", { sessionDir });
    expect((await reopened.load(ctx, sessionId)).archived).toBe(true);
    expect(await reopened.list(ctx, { archived: "active" })).toEqual([]);
  });

  it("ignores a corrupt marker rather than hiding a session", async () => {
    const sessionId = await seedTranscript("Never lost");
    await store.setArchived(ctx, sessionId, true);
    const directory = join(sessionDir, SESSION_ARCHIVE_DIRECTORY_NAME);
    const marker = (await readdir(directory)).find((name) => name.endsWith(".json"))!;
    await writeFile(join(directory, marker), "{ not json", "utf-8");

    expect((await store.list(ctx, { archived: "active" })).map((session) => session.id)).toEqual([sessionId]);
  });

  it("drops the marker when a session is really deleted", async () => {
    const sessionId = await seedTranscript("Doomed");
    await store.setArchived(ctx, sessionId, true);
    await store.delete(ctx, sessionId);
    expect((await readArchivedSessionIds(sessionDir)).has(sessionId)).toBe(false);
  });

  it("does not leave an archive marker when archive races delete", async () => {
    const sessionId = await seedTranscript("Racing");
    await Promise.allSettled([
      store.setArchived(ctx, sessionId, true),
      new PiSessionStore("/workspace", { sessionDir }).delete(ctx, sessionId),
    ]);
    expect(await store.list(ctx, { archived: "all" })).toEqual([]);
    expect((await readArchivedSessionIds(sessionDir)).has(sessionId)).toBe(false);
  });

  it("cannot lose independent updates from separate processes", async () => {
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "..", "sessionArchiveIndex.ts")).href;
    const run = (sessionId: string) => execFileAsync(process.execPath, [
      "--import", "tsx",
      "--input-type=module",
      "--eval",
      `import { writeSessionArchived } from ${JSON.stringify(moduleUrl)}; await writeSessionArchived(${JSON.stringify(sessionDir)}, ${JSON.stringify(sessionId)}, true);`,
    ]);

    await Promise.all([run("process-a"), run("process-b")]);
    expect(await readArchivedSessionIds(sessionDir)).toEqual(new Set(["process-a", "process-b"]));
  });

  it("still resolves an archived session asked for by id", async () => {
    const sessionId = await seedTranscript("Included");
    await store.setArchived(ctx, sessionId, true);
    expect((await store.list(ctx, { archived: "active", includeId: sessionId })).map((session) => session.id)).toEqual([sessionId]);
  });
});
