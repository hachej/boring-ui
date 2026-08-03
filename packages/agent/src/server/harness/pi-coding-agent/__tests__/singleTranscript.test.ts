import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import { createPiCodingAgentHarness } from "../createHarness.js";
import { PiSessionStore } from "../sessions.js";
import { SEEDED_SESSION_VERSION } from "./fixtures/sessionFiles.js";
import type { AgentTool } from "../../../../shared/tool.js";
import type { RunContext } from "../../../../shared/harness.js";

/**
 * The production flow is create-then-prompt: the server mints the session id
 * AND its transcript in `SessionStore.create`, and only then does a first
 * prompt reach the harness. Every regression these tests fence came from that
 * eager transcript being a `${id}.jsonl` wrapper that pi could not append to,
 * so the first prompt wrote a SECOND, native file and the wrapper shadowed it
 * forever. The invariant asserted throughout: one session, exactly one file,
 * and it is the file every durable read resolves.
 */

const noopTool: AgentTool = {
  name: "noop",
  description: "Does nothing, returns ok",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: [{ type: "text", text: "ok" }] };
  },
};

const WORKSPACE_CTX = { workspaceId: "workspace-a", userId: "user-a" };

function makeHarness(cwd: string) {
  return createPiCodingAgentHarness({ tools: [noopTool], cwd, sessionRoot: cwd });
}

function runContext(cwd: string): RunContext {
  return { abortSignal: new AbortController().signal, workdir: cwd, workspaceId: WORKSPACE_CTX.workspaceId };
}

async function withTempCwd<T>(prefix: string, run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

type Harness = ReturnType<typeof makeHarness>;

/**
 * Drives the real first-prompt path and hands back the SessionManager the
 * harness actually opened, so a simulated turn lands in exactly the file
 * production would have written to. `SessionManager.create` must never fire:
 * the transcript already exists.
 */
async function firstPromptManager(harness: Harness, cwd: string, sessionId: string): Promise<SessionManager> {
  const open = vi.spyOn(SessionManager, "open");
  const create = vi.spyOn(SessionManager, "create");
  await harness.getPiSessionAdapter!({ sessionId, content: "", ctx: WORKSPACE_CTX }, runContext(cwd));
  expect(create).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalled();
  return open.mock.results.at(-1)!.value as SessionManager;
}

function appendTurn(manager: SessionManager, prompt: string, reply: string): void {
  manager.appendMessage({ role: "user", content: prompt } as never);
  manager.appendMessage({ role: "assistant", content: reply } as never);
}

function coldStore(harness: Harness, cwd: string): PiSessionStore {
  // A fresh store with no live handle and no warm cache — a hub restart.
  return new PiSessionStore(cwd, { sessionDir: (harness.sessions as PiSessionStore).getSessionDir() });
}

async function sessionFiles(harness: Harness, sessionId: string): Promise<string[]> {
  const files = await readdir((harness.sessions as PiSessionStore).getSessionDir()).catch(() => []);
  return files.filter((file) => file.includes(sessionId));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("stable session id — one session, one transcript", () => {
  it("pins the seeded fixture version to pi's own session version", () => {
    expect(SEEDED_SESSION_VERSION).toBe(CURRENT_SESSION_VERSION);
  });

  it("keeps a single transcript across create → first prompt → assistant turn", async () => {
    await withTempCwd("pi-one-file-", async (cwd) => {
      const harness = makeHarness(cwd);
      const store = harness.sessions as PiSessionStore;
      const { id } = await store.create(WORKSPACE_CTX);

      const manager = await firstPromptManager(harness, cwd, id);
      appendTurn(manager, "hello", "hi");

      // Before the fix this was two files: the empty `${id}.jsonl` wrapper and
      // the native transcript pi minted behind it.
      expect(await sessionFiles(harness, id)).toHaveLength(1);
      expect(await readdir(store.getSessionDir())).toHaveLength(1);
    });
  }, 20_000);

  it("cold-reads the real conversation after a restart", async () => {
    await withTempCwd("pi-cold-read-", async (cwd) => {
      const harness = makeHarness(cwd);
      const store = harness.sessions as PiSessionStore;
      const { id } = await store.create(WORKSPACE_CTX);
      appendTurn(await firstPromptManager(harness, cwd, id), "hello", "hi");

      const { messages } = await coldStore(harness, cwd).loadEntries(WORKSPACE_CTX, id);
      expect(messages).toHaveLength(2);
      expect(messages.map((message) => (message as { role: string }).role)).toEqual(["user", "assistant"]);
    });
  }, 20_000);

  it("does not fork history when a restarted hub prompts the same session again", async () => {
    await withTempCwd("pi-no-fork-", async (cwd) => {
      const harness = makeHarness(cwd);
      const store = harness.sessions as PiSessionStore;
      const { id } = await store.create(WORKSPACE_CTX);
      const first = await firstPromptManager(harness, cwd, id);
      appendTurn(first, "hello", "hi");
      const firstFile = first.getSessionFile();
      vi.restoreAllMocks();

      const restarted = makeHarness(cwd);
      const second = await firstPromptManager(restarted, cwd, id);

      expect(second.getSessionFile()).toBe(firstFile);
      expect(second.getEntries().filter((entry) => entry.type === "message")).toHaveLength(2);
      appendTurn(second, "again", "sure");
      expect(await sessionFiles(harness, id)).toHaveLength(1);
      const { messages } = await coldStore(harness, cwd).loadEntries(WORKSPACE_CTX, id);
      expect(messages).toHaveLength(4);
    });
  }, 20_000);

  it("renames a stable-id session that has an assistant reply", async () => {
    await withTempCwd("pi-rename-", async (cwd) => {
      const harness = makeHarness(cwd);
      const store = harness.sessions as PiSessionStore;
      const { id } = await store.create(WORKSPACE_CTX);
      appendTurn(await firstPromptManager(harness, cwd, id), "hello", "hi");

      // The service gates rename on both of these; the wrapper supplied neither.
      const detail = await store.load(WORKSPACE_CTX, id);
      expect(detail).toMatchObject({ nativeSessionId: id, hasAssistantReply: true });

      await expect(store.rename!(WORKSPACE_CTX, id, "Renamed by the user"))
        .resolves.toMatchObject({ title: "Renamed by the user" });
      await expect(coldStore(harness, cwd).load(WORKSPACE_CTX, id))
        .resolves.toMatchObject({ title: "Renamed by the user" });
    });
  }, 20_000);

  it("deletes a session for real so it cannot reappear in a listing", async () => {
    await withTempCwd("pi-delete-", async (cwd) => {
      const harness = makeHarness(cwd);
      const store = harness.sessions as PiSessionStore;
      const { id } = await store.create(WORKSPACE_CTX);
      appendTurn(await firstPromptManager(harness, cwd, id), "hello", "hi");
      await expect(store.list(WORKSPACE_CTX)).resolves.toMatchObject([{ id }]);

      await store.delete(WORKSPACE_CTX, id);

      expect(await sessionFiles(harness, id)).toEqual([]);
      await expect(coldStore(harness, cwd).list(WORKSPACE_CTX)).resolves.toEqual([]);
    });
  }, 20_000);

});
