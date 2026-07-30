import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiSessionStore } from "../sessions.js";

/**
 * `liveSessionScopeId` groups in-memory live channels so a legacy native first
 * send and an addressed read converge on one channel. It must be inert for
 * storage: it may never move a transcript, merge two partitions, or leak into
 * persisted bytes.
 *
 * The existing legacy-compatibility suite proves reads don't rewrite one
 * fixture under a single context. These assertions cover the axis it does not:
 * two contexts, with and without the field.
 */
describe("session storage ignores liveSessionScopeId", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "live-scope-isolation-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves the same partition with and without the field", async () => {
    const store = new PiSessionStore("/workspace", tmpDir);
    const created = await store.create({ workspaceId: "ws", userId: "alice" }, { title: "owned" });

    // Same storage identity, plus a live-scope grouping: must see its own session.
    // Storage partitioning, not a user listing: keep the turn-less session.
    const withScope = await store.list({
      workspaceId: "ws",
      userId: "alice",
      liveSessionScopeId: "ws_user_alice",
    }, { includeEmpty: true });
    expect(withScope.map((session) => session.id)).toContain(created.id);

    const loaded = await store.load(
      { workspaceId: "ws", userId: "alice", liveSessionScopeId: "ws_user_alice" },
      created.id,
    );
    expect(loaded.title).toBe("owned");
  });

  it("keeps users isolated even when they share one live scope id", async () => {
    const store = new PiSessionStore("/workspace", tmpDir);
    const shared = "same-live-scope";
    const alice = await store.create(
      { workspaceId: "ws", userId: "alice", liveSessionScopeId: shared },
      { title: "alice session" },
    );
    const bob = await store.create(
      { workspaceId: "ws", userId: "bob", liveSessionScopeId: shared },
      { title: "bob session" },
    );

    // A shared live-scope grouping must not collapse per-user storage.
    const aliceSessions = await store.list({ workspaceId: "ws", userId: "alice", liveSessionScopeId: shared }, { includeEmpty: true });
    const bobSessions = await store.list({ workspaceId: "ws", userId: "bob", liveSessionScopeId: shared }, { includeEmpty: true });

    expect(aliceSessions.map((s) => s.id)).toContain(alice.id);
    expect(aliceSessions.map((s) => s.id)).not.toContain(bob.id);
    expect(bobSessions.map((s) => s.id)).toContain(bob.id);
    expect(bobSessions.map((s) => s.id)).not.toContain(alice.id);
  });

  it("does not persist the field into transcript bytes", async () => {
    const store = new PiSessionStore("/workspace", tmpDir);
    const created = await store.create(
      { workspaceId: "ws", userId: "alice", liveSessionScopeId: "must-not-persist" },
      { title: "header check" },
    );

    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(join(tmpDir, `${created.id}.jsonl`), "utf-8");
    expect(bytes).not.toContain("liveSessionScopeId");
    expect(bytes).not.toContain("must-not-persist");
  });
});
