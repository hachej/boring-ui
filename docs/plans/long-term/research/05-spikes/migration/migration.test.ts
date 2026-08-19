import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "/home/ubuntu/projects/spike-l0-schema/node_modules/vitest/dist/index.js";
import { Session } from "/home/ubuntu/projects/spike-pi-storage/node_modules/@earendil-works/pi-agent-core/dist/index.js";
import {
  CanonicalPiSessionStorage,
  importNativeTranscript,
  openTargetStore,
  parseNativeTranscript,
  readNativeTranscript,
} from "../src/canonical-session-storage.ts";
import { createLegacyEventFixture, decodeEventPath, planEventPromotion, promoteEventPath } from "../src/event-store-migration.ts";

const REAL_COMPACTED_TRANSCRIPT = "/home/ubuntu/.pi/agent/sessions/--home-ubuntu-projects-boring-macro--/2026-06-17T10-51-55-890Z_019ed535-8872-79cf-aa06-7b30cf97ce56.jsonl";
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "pi-migration-"));
  tempDirs.push(dir);
  return dir;
}

describe("pi native JSONL -> canonical target schema", () => {
  test("imports a copied real transcript without mutating or flattening its graph", async () => {
    const dir = await tempDir();
    const copy = join(dir, basename(REAL_COMPACTED_TRANSCRIPT));
    const originalBytes = await readFile(REAL_COMPACTED_TRANSCRIPT);
    await copyFile(REAL_COMPACTED_TRANSCRIPT, copy);
    const transcript = await readNativeTranscript(copy);
    const store = openTargetStore(join(dir, "canonical.sqlite"), { tenantId: "tenant-a", workspaceId: "workspace-a" });
    try {
      const result = importNativeTranscript(store, transcript);
      const records = store.listRecords(transcript.header.id);
      const imported = records.filter((record) => record.kind === "pi_session_header" || record.kind === "pi_session_entry");
      const roundTrippedLines = imported.map((record) => (record.payload as { rawLine: string }).rawLine);
      const children = new Map<string, number>();
      for (const entry of transcript.entries) {
        if (entry.parentId) children.set(entry.parentId, (children.get(entry.parentId) ?? 0) + 1);
      }

      expect(result.importedLineCount).toBe(transcript.rawLines.length);
      expect(roundTrippedLines).toEqual(transcript.rawLines);
      expect(transcript.entries.some((entry) => entry.type === "compaction")).toBe(true);
      expect([...children.values()].some((count) => count > 1)).toBe(true);
      expect((await readFile(copy)).equals(originalBytes)).toBe(true);

      const storage = CanonicalPiSessionStorage.open(store, transcript.header.id);
      expect(await storage.getLeafId()).toBe(transcript.leafId);
      expect(await storage.getEntries()).toEqual(transcript.entries);
      if (transcript.leafId) {
        const path = await storage.getPathToRoot(transcript.leafId);
        expect(path.at(-1)?.id).toBe(transcript.leafId);
      }
    } finally {
      store.close();
    }
  });

  test("pi core can continue from imported canonical entries offline", async () => {
    const dir = await tempDir();
    const transcript = parseNativeTranscript([
      JSON.stringify({ type: "session", version: 3, id: "real-shape", timestamp: "2026-08-11T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp: "2026-08-11T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "remember ORCHID-7319" }], timestamp: 1 } }),
      JSON.stringify({ type: "message", id: "a1", parentId: "u1", timestamp: "2026-08-11T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "remembered" }], api: "google-generative-ai", provider: "google", model: "gemini-2.5-flash", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 } }),
    ].join("\n") + "\n");
    const store = openTargetStore(join(dir, "continue.sqlite"), { tenantId: "tenant-a", workspaceId: "workspace-a" });
    try {
      importNativeTranscript(store, transcript);
      const storage = CanonicalPiSessionStorage.open(store, transcript.header.id);
      const session = new Session(storage as never);
      const before = await session.buildContext();
      expect(before.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      await session.appendMessage({ role: "user", content: [{ type: "text", text: "what was it?" }], timestamp: 3 });

      const reopened = new Session(CanonicalPiSessionStorage.open(store, transcript.header.id) as never);
      const after = await reopened.buildContext();
      expect(after.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
      expect(JSON.stringify(after.messages)).toContain("ORCHID-7319");
    } finally {
      store.close();
    }
  });
});

describe("legacy durable event rows", () => {
  test("decodes workspace/user but cannot infer target tenant", async () => {
    const dir = await tempDir();
    const db = new DatabaseSync(":memory:");
    createLegacyEventFixture(db);
    const scopedPath = 'sessions/["scoped-session","workspace-a","user-a"]';
    expect(decodeEventPath(scopedPath)).toEqual({ sessionId: "scoped-session", workspaceId: "workspace-a", userId: "user-a" });
    expect(() => planEventPromotion(db, scopedPath)).toThrow(/tenant_id is absent/);
    expect(() => planEventPromotion(db, "sessions/legacy-session", () => "tenant-a")).toThrow(/workspace_id is absent/);
    expect(planEventPromotion(db, scopedPath, () => "tenant-a")).toMatchObject({ tenantId: "tenant-a", workspaceId: "workspace-a", rows: [{ seq: 0 }] });
    const target = openTargetStore(join(dir, "event-target.sqlite"), { tenantId: "tenant-a", workspaceId: "workspace-a" });
    expect(promoteEventPath(target, db, scopedPath, () => "tenant-a")).toEqual({ sessionId: "scoped-session", promotedRecordCount: 1 });
    expect(target.listRecords("scoped-session").filter((record) => record.kind === "legacy_pi_chat_event")).toHaveLength(1);
    target.close();
    db.close();
  });
});
