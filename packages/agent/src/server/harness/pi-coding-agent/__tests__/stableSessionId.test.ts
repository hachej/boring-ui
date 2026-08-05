import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { createPiCodingAgentHarness } from "../createHarness.js";
import { PiSessionStore } from "../sessions.js";
import { pinSessionCtxOnHeaderForTest } from "./fixtures/sessionFiles.js";
import { seedNativeSession } from "./fixtures/sessionFiles.js";
import { ErrorCode } from "../../../../shared/error-codes.js";
import type { AgentTool } from "../../../../shared/tool.js";
import type { RunContext } from "../../../../shared/harness.js";

const noopTool: AgentTool = {
  name: "noop",
  description: "Does nothing, returns ok",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: [{ type: "text", text: "ok" }] };
  },
};

const WORKSPACE_CTX = { workspaceId: "workspace-a" };
const STABLE_ID = "11111111-2222-4333-8444-555555555555";

function makeHarness(cwd: string) {
  // Default host: no unscoped native access. The tenancy pin is what has to
  // carry visibility here.
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stable session id — create with the id the server minted", () => {
  it("opens the transcript the server already minted instead of creating a second one", async () => {
    await withTempCwd("pi-stable-create-", async (cwd) => {
      const harness = makeHarness(cwd);
      const sessionDir = (harness.sessions as PiSessionStore).getSessionDir();
      const transcript = await seedNativeSession(sessionDir, cwd, STABLE_ID, WORKSPACE_CTX);
      const create = vi.spyOn(SessionManager, "create");
      const open = vi.spyOn(SessionManager, "open");

      await harness.getPiSessionAdapter!({ sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX }, runContext(cwd));

      expect(create).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(transcript, undefined, cwd);
      expect(harness.hasPiSession!(STABLE_ID, WORKSPACE_CTX)).toBe(true);
      await expect(readdir(sessionDir)).resolves.toHaveLength(1);
    });
  }, 20_000);

  it("fails with a coded not-found instead of minting a transcript for an unknown id", async () => {
    await withTempCwd("pi-stable-unknown-", async (cwd) => {
      const harness = makeHarness(cwd);
      const create = vi.spyOn(SessionManager, "create");

      await expect(harness.getPiSessionAdapter!(
        { sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX },
        runContext(cwd),
      )).rejects.toMatchObject({ code: ErrorCode.enum.SESSION_NOT_FOUND, statusCode: 404 });
      expect(create).not.toHaveBeenCalled();
      await expect(readdir((harness.sessions as PiSessionStore).getSessionDir()).catch(() => []))
        .resolves.toEqual([]);
    });
  }, 20_000);

  it("yields exactly one pi session for concurrent duplicate first prompts", async () => {
    await withTempCwd("pi-stable-concurrent-", async (cwd) => {
      const harness = makeHarness(cwd);
      await seedNativeSession((harness.sessions as PiSessionStore).getSessionDir(), cwd, STABLE_ID, WORKSPACE_CTX);
      const open = vi.spyOn(SessionManager, "open");
      const ctx = runContext(cwd);

      const [first, second] = await Promise.all([
        harness.getPiSessionAdapter!({ sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX }, ctx),
        harness.getPiSessionAdapter!({ sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX }, ctx),
      ]);

      expect(open).toHaveBeenCalledTimes(1);
      expect(first.readSnapshot().sessionId).toBe(STABLE_ID);
      expect(second.readSnapshot().sessionId).toBe(STABLE_ID);
    });
  }, 20_000);

  it("reopens the same id after a hub restart instead of minting a new one", async () => {
    await withTempCwd("pi-stable-restart-", async (cwd) => {
      const harness = makeHarness(cwd);
      const sessionDir = (harness.sessions as PiSessionStore).getSessionDir();
      // Pi flushes on the first assistant message; replicate that here.
      flushTranscript(cwd, sessionDir, STABLE_ID);
      await harness.getPiSessionAdapter!({ sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX }, runContext(cwd));

      const restarted = makeHarness(cwd);
      const create = vi.spyOn(SessionManager, "create");
      const adapter = await restarted.getPiSessionAdapter!(
        { sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX },
        runContext(cwd),
      );

      expect(create).not.toHaveBeenCalled();
      expect(adapter.readSnapshot().sessionId).toBe(STABLE_ID);
    });
  }, 20_000);

  it("raises a coded error instead of silently minting a new id when the transcript cannot be opened", async () => {
    await withTempCwd("pi-stable-open-failure-", async (cwd) => {
      const harness = makeHarness(cwd);
      const sessionDir = (harness.sessions as PiSessionStore).getSessionDir();
      flushTranscript(cwd, sessionDir, STABLE_ID);
      const restarted = makeHarness(cwd);
      vi.spyOn(SessionManager, "open").mockImplementation(() => { throw new Error("injected open failure"); });
      const create = vi.spyOn(SessionManager, "create");

      await expect(restarted.getPiSessionAdapter!(
        { sessionId: STABLE_ID, content: "", ctx: WORKSPACE_CTX },
        runContext(cwd),
      )).rejects.toMatchObject({ code: ErrorCode.enum.SESSION_TRANSCRIPT_UNREADABLE, statusCode: 500 });
      expect(create).not.toHaveBeenCalled();
    });
  }, 20_000);
});

describe("stable session id — tenancy pin", () => {
  it("keeps a pi-created transcript listable and loadable under its scoped ctx", async () => {
    await withTempCwd("pi-stable-pin-", async (cwd) => {
      const sessionDir = join(cwd, "sessions");
      flushTranscript(cwd, sessionDir, STABLE_ID);
      const store = new PiSessionStore(cwd, { sessionDir });

      await expect(store.load(WORKSPACE_CTX, STABLE_ID)).resolves.toMatchObject({ id: STABLE_ID });
      await expect(store.list(WORKSPACE_CTX)).resolves.toMatchObject([{ id: STABLE_ID }]);
      // Another tenant must not see it, and the pin must not have been laundered
      // into a wrapper by the scoped read above.
      await expect(store.list({ workspaceId: "workspace-b" })).resolves.toEqual([]);
      await expect(store.load({ workspaceId: "workspace-b" }, STABLE_ID)).rejects.toThrow();
    });
  });

  it("fails loudly if pi's getHeader() stops returning the live header object", async () => {
    await withTempCwd("pi-stable-live-header-", async (cwd) => {
      const sessionDir = join(cwd, "sessions");
      const manager = SessionManager.create(cwd, sessionDir, { id: STABLE_ID });
      pinSessionCtxOnHeaderForTest(manager.getHeader(), WORKSPACE_CTX);
      manager.appendMessage({ role: "user", content: "hello" } as never);
      manager.appendMessage({ role: "assistant", content: "hi" } as never);

      const files = await readdir(sessionDir);
      const header = JSON.parse((await readFile(join(sessionDir, files[0]!), "utf8")).split("\n")[0]!);
      expect(header.id).toBe(STABLE_ID);
      // If a pi upgrade makes getHeader() return a copy, the pin never reaches
      // the flushed file and every scoped host silently loses its sessions.
      expect(header.boringSessionCtx).toEqual(WORKSPACE_CTX);
    });
  });
});

/** What pi itself does on the first assistant message: flush the transcript. */
function flushTranscript(cwd: string, sessionDir: string, id: string): void {
  const manager = SessionManager.create(cwd, sessionDir, { id });
  pinSessionCtxOnHeaderForTest(manager.getHeader(), WORKSPACE_CTX);
  manager.appendMessage({ role: "user", content: "hello" } as never);
  manager.appendMessage({ role: "assistant", content: "hi" } as never);
}
