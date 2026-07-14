import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile, utimes } from "node:fs/promises";
import { DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  createResourceSettingsManager,
  createPiCodingAgentHarness,
  mergePiPackageSources,
} from "../createHarness.js";
import { adaptToolsForPi } from "../tool-adapter.js";
import { PiSessionStore } from "../sessions.js";
import { HarnessPiChatService } from "../../../pi-chat/harnessPiChatService.js";
import { ErrorCode } from "../../../../shared/error-codes.js";
import type { AgentTool } from "../../../../shared/tool.js";

const ENOENT_CODE = "ENOENT";

const noopTool: AgentTool = {
  name: "noop",
  description: "Does nothing, returns ok",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { content: [{ type: "text", text: "ok" }] };
  },
};

describe("createPiCodingAgentHarness", () => {
  it("returns an AgentHarness with correct shape", () => {
    const harness = createPiCodingAgentHarness({
      tools: [noopTool],
      cwd: "/tmp/test-harness",
    });
    expect(harness.id).toBe("pi-coding-agent");
    expect(harness.placement).toBe("server");
    expect(harness.sessions).toBeInstanceOf(PiSessionStore);
    expect(typeof harness.getPiSessionAdapter).toBe("function");
    expect(typeof harness.reloadSession).toBe("function");
  });

  it("writes one native title when a live pending session materializes after route rename", async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), "pi-live-title-materialize-"));
    const sessionCtx = { workspaceId: "default" };
    let liveManager: SessionManager | undefined;
    const originalAppend = SessionManager.prototype.appendSessionInfo;
    const captureAppend = vi.spyOn(SessionManager.prototype, "appendSessionInfo").mockImplementation(function (this: SessionManager, name: string) {
      liveManager = this;
      return originalAppend.call(this, name);
    });
    try {
      const harness = createPiCodingAgentHarness({ tools: [noopTool], cwd: "/tmp/live-title", sessionDir });
      const session = await harness.sessions.create(sessionCtx);
      const service = new HarnessPiChatService({ harness, sessionStore: harness.sessions, workdir: "/tmp/live-title" });
      await harness.getPiSessionAdapter({ sessionId: session.id, content: "", ctx: sessionCtx }, {
        abortSignal: new AbortController().signal,
        workdir: "/tmp/live-title",
        workspaceId: "default",
      });
      await expect(service.renameSession({ workspaceId: "default", requestId: "rename-invalid" }, session.id, " \r\n "))
        .rejects.toThrow("session title is required");
      await expect(service.renameSession({ workspaceId: "default", requestId: "rename-long" }, session.id, "x".repeat(201)))
        .rejects.toThrow("session title must be at most 200 characters");
      expect(captureAppend).not.toHaveBeenCalled();

      await service.renameSession({ workspaceId: "default", requestId: "rename" }, session.id, "  New\r\nsessionsss  ");
      expect(liveManager).toBeDefined();
      expect(captureAppend.mock.calls.map(([title]) => title)).toEqual(["New sessionsss"]);
      const nativePath = liveManager?.getSessionFile();
      expect(nativePath).toBeTruthy();
      await expect(readFile(nativePath!, "utf-8")).rejects.toMatchObject({ code: ENOENT_CODE });

      liveManager!.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }] } as any);
      liveManager!.appendMessage({ role: "assistant", content: [{ type: "text", text: "hi" }] } as any);
      const nativeEntries = (await readFile(nativePath!, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(nativeEntries.filter((entry) => entry.type === "session_info").map((entry) => entry.name)).toEqual(["New sessionsss"]);
      expect(nativeEntries.filter((entry) => entry.type === "session_info" && entry.name === "New sessionsss")).toHaveLength(1);
      await expect(harness.sessions.load(sessionCtx, session.id)).resolves.toEqual(expect.objectContaining({ title: "New sessionsss" }));
    } finally {
      captureAppend.mockRestore();
      await rm(sessionDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects unavailable requested models when strict model resolution is enabled", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-strict-model-"));
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        pi: { strictModelResolution: true },
      });

      await expect(harness.getPiSessionAdapter({
        sessionId: "strict-session",
        message: "hello",
        model: { provider: "missing-provider", id: "missing-model" },
      }, { abortSignal: new AbortController().signal, workdir: cwd })).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.enum.TOOL_INVALID_INPUT,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns false when reloading a session that has not been created yet", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [noopTool],
      cwd: "/tmp/test-harness",
    });

    await expect(harness.reloadSession?.("missing-session")).resolves.toBe(false);
  });

  it("merges host-declared Pi packages without mutating package filters", () => {
    const filtered = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./index.ts"],
    };

    expect(
      mergePiPackageSources(
        ["npm:pi-markdown-preview@0.9.7", filtered],
        ["npm:pi-markdown-preview@0.9.7", filtered, "git:github.com/user/pi-tools@v1"],
      ),
    ).toEqual([
      "npm:pi-markdown-preview@0.9.7",
      filtered,
      "git:github.com/user/pi-tools@v1",
    ]);
  });

  it("dedupes Pi package filters independent of declaration order", () => {
    const first = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./preview.ts", "./index.ts"],
    };
    const second = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./index.ts", "./preview.ts"],
    };

    expect(mergePiPackageSources([first], [second])).toEqual([first]);
  });

  it("dedupes string sources and unfiltered object sources", () => {
    expect(
      mergePiPackageSources(
        ["npm:pi-markdown-preview@0.9.7"],
        [{ source: "npm:pi-markdown-preview@0.9.7" }],
      ),
    ).toEqual(["npm:pi-markdown-preview@0.9.7"]);
  });

  it("injects Pi packages when project settings do not exist yet", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-settings-missing-project-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-settings-missing-agent-"));
    try {
      const manager = createResourceSettingsManager(cwd, agentDir, [
        "npm:plugin-pi",
      ]);

      expect(manager.getProjectSettings().packages).toEqual([
        "npm:plugin-pi",
      ]);

      await manager.flush();
      await expect(readFile(join(cwd, ".pi", "settings.json"), "utf8"))
        .rejects.toMatchObject({ ["code"]: "ENOENT" });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("injects Pi packages into in-memory project settings only", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-settings-project-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-settings-agent-"));
    try {
      const settingsPath = join(cwd, ".pi", "settings.json");
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(
        settingsPath,
        JSON.stringify({
          theme: "test-theme",
          packages: ["npm:base-pi"],
        }),
        "utf8",
      );

      const manager = createResourceSettingsManager(cwd, agentDir, [
        "npm:plugin-pi",
      ]);

      expect(manager.getProjectSettings().packages).toEqual([
        "npm:base-pi",
        "npm:plugin-pi",
      ]);

      manager.setDefaultProvider("anthropic");
      await manager.flush();

      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
        theme: "test-theme",
        packages: ["npm:base-pi"],
      });
      expect(manager.getGlobalSettings().defaultProvider).toBe("anthropic");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("ignores malformed package fields when injecting Pi packages", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-settings-project-bad-packages-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-settings-agent-bad-packages-"));
    try {
      const settingsPath = join(cwd, ".pi", "settings.json");
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(
        settingsPath,
        JSON.stringify({ packages: "npm:not-an-array" }),
        "utf8",
      );

      const manager = createResourceSettingsManager(cwd, agentDir, [
        "npm:plugin-pi",
      ]);

      expect(manager.getProjectSettings().packages).toEqual(["npm:plugin-pi"]);
      expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
        packages: "npm:not-an-array",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("keeps injected Pi packages while seeing later project settings edits on reload", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-settings-project-reload-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-settings-agent-reload-"));
    try {
      const settingsPath = join(cwd, ".pi", "settings.json");
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(
        settingsPath,
        JSON.stringify({ packages: ["npm:base-pi"] }),
        "utf8",
      );

      const manager = createResourceSettingsManager(cwd, agentDir, [
        "npm:plugin-pi",
      ]);
      expect(manager.getProjectSettings().packages).toEqual([
        "npm:base-pi",
        "npm:plugin-pi",
      ]);

      await writeFile(
        settingsPath,
        JSON.stringify({ packages: ["npm:edited-pi"] }),
        "utf8",
      );
      await manager.reload();

      expect(manager.getProjectSettings().packages).toEqual([
        "npm:edited-pi",
        "npm:plugin-pi",
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

describe("pi extension path hot reload", () => {
  it("reloads changed extension source from Pi extension paths instead of using inline factories", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-extension-cwd-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-extension-agent-"));
    const extensionPath = join(cwd, "plugin-agent.ts");

    const writeExtension = (version: string) => writeFile(
      extensionPath,
      `export default function(pi) {\n` +
        `  pi.registerTool({\n` +
        `    name: "hot_reload_probe",\n` +
        `    label: "Probe",\n` +
        `    description: "${version}",\n` +
        `    parameters: { type: "object", properties: {} },\n` +
        `    async execute() { return { content: [{ type: "text", text: "${version}" }], details: undefined } }\n` +
        `  })\n` +
        `}\n`,
      "utf8",
    );

    try {
      await writeExtension("version-one");
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        additionalExtensionPaths: [extensionPath],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });

      await loader.reload();
      const first = loader.getExtensions().extensions[0];
      expect(first).toBeDefined();
      expect(first!.path).toBe(extensionPath);
      expect(first!.tools.get("hot_reload_probe")?.definition.description).toBe("version-one");

      await writeExtension("version-two");
      await loader.reload();
      const second = loader.getExtensions().extensions[0];
      expect(second).toBeDefined();
      expect(second!.path).toBe(extensionPath);
      expect(second!.tools.get("hot_reload_probe")?.definition.description).toBe("version-two");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

describe("adaptToolsForPi", () => {
  it("adapts AgentTool[] to ToolDefinition[] without pi built-ins", () => {
    const adapted = adaptToolsForPi([noopTool]);
    expect(adapted).toHaveLength(1);
    expect(adapted[0].name).toBe("noop");
    expect(adapted[0].label).toBe("noop");
    expect(adapted[0].description).toBe("Does nothing, returns ok");
    expect(adapted[0].promptSnippet).toBe("Does nothing, returns ok");
    expect(adapted[0].promptGuidelines).toBeUndefined();

    const piBuiltIns = ["bash", "read", "write", "edit", "find", "grep", "ls"];
    for (const name of piBuiltIns) {
      expect(adapted.find((t) => t.name === name)).toBeUndefined();
    }
  });

  it("preserves explicit prompt snippets without decorating them", () => {
    const [adapted] = adaptToolsForPi([
      {
        ...noopTool,
        promptSnippet: "No-op custom tool",
      },
    ]);

    expect(adapted.promptSnippet).toBe("No-op custom tool");
    expect(adapted.promptSnippet).not.toMatch(/^- `noop`/);
    expect(adapted.promptGuidelines).toBeUndefined();
  });

  it("execute adapter bridges correctly", async () => {
    const calls: unknown[] = [];
    const tool: AgentTool = {
      name: "spy",
      description: "Records calls",
      parameters: { type: "object", properties: { x: { type: "number" } } },
      async execute(params, ctx) {
        calls.push({ params, toolCallId: ctx.toolCallId });
        return { content: [{ type: "text", text: "done" }] };
      },
    };

    const [adapted] = adaptToolsForPi([tool]);
    const result = await adapted.execute(
      "call-1",
      { x: 42 },
      undefined,
      undefined,
      {} as any,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ params: { x: 42 }, toolCallId: "call-1" });
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("returns marked details on isError results for Pi tool_result extension", async () => {
    const tool: AgentTool = {
      name: "fail",
      description: "Always fails",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          content: [{ type: "text", text: "something broke" }],
          isError: true,
        };
      },
    };

    const [adapted] = adaptToolsForPi([tool]);
    const result = await adapted.execute("call-1", {}, undefined, undefined, {} as any);

    expect(result.content).toEqual([{ type: "text", text: "something broke" }]);
    expect(result.details).toEqual({ __boringToolError: true, details: undefined });
  });
});

describe("PiSessionStore", () => {
  const ctx = { workspaceId: "test-ws" };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-session-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses a collision-proof explicit session namespace when provided", async () => {
    const namespace = `test-namespace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const namespacedDir = join(homedir(), ".pi", "agent", "sessions", namespace);
    try {
      const first = new PiSessionStore("/tmp/a-b", { sessionNamespace: namespace });
      const second = new PiSessionStore("/tmp/a/b", { sessionNamespace: `${namespace}-other` });
      const firstSession = await first.create(ctx, { title: "First" });
      const secondSession = await second.create(ctx, { title: "Second" });

      expect(await first.list(ctx)).toEqual([expect.objectContaining({ id: firstSession.id })]);
      expect(await second.list(ctx)).toEqual([expect.objectContaining({ id: secondSession.id })]);
      await expect(first.load(ctx, secondSession.id)).rejects.toThrow("Session not found");
    } finally {
      await rm(namespacedDir, { recursive: true, force: true });
      await rm(`${namespacedDir}-other`, { recursive: true, force: true });
    }
  });

  it("rejects unsafe session namespaces", () => {
    expect(() => new PiSessionStore("/tmp", { sessionNamespace: "../bad" })).toThrow("session namespace");
  });

  it("honors BORING_AGENT_SESSION_ROOT for namespaced session stores", async () => {
    const previous = process.env.BORING_AGENT_SESSION_ROOT;
    process.env.BORING_AGENT_SESSION_ROOT = tmpDir;
    try {
      const store = new PiSessionStore("/workspace", { sessionNamespace: "workspace-a" });
      expect(store.getSessionDir()).toBe(join(tmpDir, "workspace-a"));

      const session = await store.create(ctx, { title: "Persistent" });
      await expect(readFile(join(tmpDir, "workspace-a", `${session.id}.jsonl`), "utf-8"))
        .resolves.toContain("Persistent");
    } finally {
      if (previous === undefined) {
        delete process.env.BORING_AGENT_SESSION_ROOT;
      } else {
        process.env.BORING_AGENT_SESSION_ROOT = previous;
      }
    }
  });

  it("lets hosts pass an explicit session root without mutating process env", async () => {
    const previous = process.env.BORING_AGENT_SESSION_ROOT;
    process.env.BORING_AGENT_SESSION_ROOT = join(tmpDir, "env-root");
    try {
      const store = new PiSessionStore("/workspace", {
        sessionNamespace: "workspace-a",
        sessionRoot: join(tmpDir, "explicit-root"),
      });
      expect(store.getSessionDir()).toBe(join(tmpDir, "explicit-root", "workspace-a"));

      const session = await store.create(ctx, { title: "Explicit" });
      await expect(readFile(join(tmpDir, "explicit-root", "workspace-a", `${session.id}.jsonl`), "utf-8"))
        .resolves.toContain("Explicit");
    } finally {
      if (previous === undefined) delete process.env.BORING_AGENT_SESSION_ROOT;
      else process.env.BORING_AGENT_SESSION_ROOT = previous;
    }
  });


  it("can store session files under host cwd while writing runtime cwd in session header", async () => {
    const store = new PiSessionStore("/workspace", { storageCwd: "/tmp/host-storage-root", sessionDir: tmpDir });
    const session = await store.create(ctx, { title: "Runtime cwd" });

    expect(store.getSessionDir()).toBe(tmpDir);
    const firstLine = (await readFile(join(tmpDir, `${session.id}.jsonl`), "utf-8")).split("\n")[0];
    expect(JSON.parse(firstLine)).toEqual(expect.objectContaining({ cwd: "/workspace" }));
  });

  it("creates and lists sessions", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Test" });
    expect(session.id).toBeTruthy();
    expect(session.title).toBe("Test");

    const list = await store.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(session.id);
  });

  it("renames sessions by appending native session_info entries", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Original" });

    const renamed = await store.rename(ctx, session.id, "Renamed");

    expect(renamed).toEqual(expect.objectContaining({ id: session.id, title: "Renamed" }));
    await expect(store.load(ctx, session.id)).resolves.toEqual(expect.objectContaining({ title: "Renamed" }));
    await expect(store.list(ctx)).resolves.toEqual([expect.objectContaining({ id: session.id, title: "Renamed" })]);
    const lines = (await readFile(join(tmpDir, `${session.id}.jsonl`), "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.type === "session_info").map((line) => line.name)).toEqual(["Original", "Renamed"]);
  });

  it("lists an EOF rename after a transcript exceeds the summary prefix", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Original" });
    const filepath = join(tmpDir, `${session.id}.jsonl`);
    await appendFile(filepath, `${JSON.stringify({ type: "message", message: { role: "user", content: "x".repeat(70 * 1024) } })}\n`);
    await store.rename(ctx, session.id, "Renamed after long transcript");
    // Native Pi may append more transcript after /name, moving the title out
    // of both the prefix and the final 64KiB summary windows.
    await appendFile(filepath, `${JSON.stringify({ type: "message", message: { role: "assistant", content: "y".repeat(70 * 1024) } })}\n`);
    await appendFile(filepath, "{malformed-tail}\n");

    await expect(store.list(ctx)).resolves.toEqual([
      expect.objectContaining({ id: session.id, title: "Renamed after long transcript" }),
    ]);
  });

  it("keeps concurrent rename appends valid JSONL", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Original" });
    const titles = Array.from({ length: 20 }, (_, index) => `Rename ${index}`);

    await Promise.all(titles.map((title) => store.rename(ctx, session.id, title)));

    const lines = (await readFile(join(tmpDir, `${session.id}.jsonl`), "utf-8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.filter((line) => line.type === "session_info").map((line) => line.name)).toHaveLength(21);
    await expect(store.list(ctx)).resolves.toEqual([
      expect.objectContaining({ id: session.id, title: expect.stringMatching(/^Rename \d+$/) }),
    ]);
  });

  it("lists a standalone Pi session when Pi appends session_info beyond the prefix", async () => {
    const sessionId = "standalone-appended-title";
    const filepath = join(tmpDir, `2026-06-04T15-23-19-668Z_${sessionId}.jsonl`);
    await writeFile(filepath, [
      { type: "session", version: 1, id: sessionId, timestamp: "2026-06-04T15:23:19.668Z", cwd: "/tmp" },
      { type: "message", message: { role: "user", content: "x".repeat(70 * 1024) } },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");
    await appendFile(filepath, `${JSON.stringify({ type: "session_info", id: "external-title", parentId: null, timestamp: "2026-06-04T15:24:00.000Z", name: "Pi renamed this" })}\n`);

    const store = new PiSessionStore("/tmp", tmpDir);
    await expect(store.list({ workspaceId: "default" })).resolves.toEqual([
      expect.objectContaining({ id: sessionId, title: "Pi renamed this" }),
    ]);
  });

  it("authorizes rename with the session context", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Scoped" });

    await expect(store.rename({ workspaceId: "other-ws" }, session.id, "Attack")).rejects.toThrow("Session not found");
    await expect(store.load(ctx, session.id)).resolves.toEqual(expect.objectContaining({ title: "Scoped" }));
  });

  it("hydrates a pending wrapper rename into the first native Pi transcript after restart", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "New chat" });
    const nativePath = join(tmpDir, "2026-07-11T13-18-16-715Z_pending-native.jsonl");
    await store.savePiSessionFile(ctx, session.id, nativePath);
    await store.rename(ctx, session.id, "new chatssss");

    await expect(readFile(nativePath, "utf-8")).rejects.toMatchObject({ code: ENOENT_CODE });

    const restartedStore = new PiSessionStore("/tmp", tmpDir);
    const pendingTitle = restartedStore.loadPendingPiSessionTitleSync(ctx, session.id);
    expect(pendingTitle).toBe("new chatssss");

    const sessionManager = SessionManager.open(nativePath, undefined, "/tmp");
    sessionManager.appendSessionInfo(pendingTitle!);
    await expect(readFile(nativePath, "utf-8")).rejects.toMatchObject({ code: ENOENT_CODE });

    sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }] } as any);
    await expect(readFile(nativePath, "utf-8")).rejects.toMatchObject({ code: ENOENT_CODE });

    sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "hi" }] } as any);
    const nativeLines = (await readFile(nativePath, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(nativeLines.filter((line) => line.type === "session_info").map((line) => line.name)).toEqual(["new chatssss"]);
    await expect(restartedStore.load(ctx, session.id)).resolves.toEqual(expect.objectContaining({ title: "new chatssss", turnCount: 1 }));
    expect(restartedStore.loadPendingPiSessionTitleSync(ctx, session.id)).toBeNull();
  });

  it("renames linked native Pi transcripts instead of the Boring wrapper", async () => {
    const nativeSessionId = "native-rename";
    const boringSessionId = "boring-rename";
    const nativePath = join(tmpDir, `2026-06-04T15-23-19-668Z_${nativeSessionId}.jsonl`);
    const boringPath = join(tmpDir, `${boringSessionId}.jsonl`);
    await writeFile(
      nativePath,
      [
        { type: "session", version: 1, id: nativeSessionId, timestamp: "2026-06-04T15:23:19.668Z", cwd: "/tmp" },
        { type: "message", message: { role: "user", content: "x".repeat(70 * 1024) } },
        { type: "session_info", id: "native-info", parentId: null, timestamp: "2026-06-04T15:23:20.000Z", name: "Native title" },
        { type: "message", message: { role: "assistant", content: "y".repeat(70 * 1024) } },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n",
      "utf-8",
    );
    await writeFile(
      boringPath,
      [
        { type: "session", version: 1, id: boringSessionId, timestamp: "2026-06-04T15:23:19.668Z", cwd: "/tmp" },
        { type: "session_info", id: "wrapper-info", parentId: null, timestamp: "2026-06-04T15:23:20.000Z", name: "Wrapper title" },
        { type: "pi_session_file", timestamp: "2026-06-04T15:23:21.000Z", path: nativePath },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n",
      "utf-8",
    );

    const store = new PiSessionStore("/tmp", tmpDir);
    await expect(store.load({ workspaceId: "default" }, boringSessionId)).resolves.toEqual(expect.objectContaining({ title: "Native title" }));
    await expect(store.list({ workspaceId: "default" })).resolves.toEqual([expect.objectContaining({ id: boringSessionId, title: "Native title" })]);
    await store.rename({ workspaceId: "default" }, boringSessionId, "Linked rename");
    const nativeLines = (await readFile(nativePath, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    const wrapperLines = (await readFile(boringPath, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(nativeLines.filter((line) => line.type === "session_info").map((line) => line.name)).toEqual(["Native title", "Linked rename"]);
    expect(wrapperLines.filter((line) => line.type === "session_info").map((line) => line.name)).toEqual(["Wrapper title"]);
    await expect(store.list({ workspaceId: "default" })).resolves.toEqual([expect.objectContaining({ id: boringSessionId, title: "Linked rename" })]);
  });

  it("persists and enforces session context inside one store root", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const otherCtx = { workspaceId: "other-ws" };
    const session = await store.create(ctx, { title: "Scoped" });
    await store.create(otherCtx, { title: "Other" });

    const firstLine = (await readFile(join(tmpDir, `${session.id}.jsonl`), "utf-8")).split("\n")[0];
    expect(JSON.parse(firstLine)).toEqual(expect.objectContaining({
      boringSessionCtx: { workspaceId: "test-ws" },
    }));

    await expect(store.list(ctx)).resolves.toEqual([expect.objectContaining({ id: session.id })]);
    await expect(store.list(otherCtx)).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: session.id })]));
    await expect(store.list({})).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: session.id })]));
    await expect(store.load(otherCtx, session.id)).rejects.toThrow("Session not found");
  });

  it("keeps legacy unscoped sessions visible in default-derived stores", async () => {
    const store = new PiSessionStore("/tmp/runtime", {
      sessionRoot: tmpDir,
      storageCwd: "/tmp/host-workspace",
    });
    await mkdir(store.getSessionDir(), { recursive: true });
    const sessionId = "legacy-default";
    await writeFile(
      join(store.getSessionDir(), `${sessionId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 1, id: sessionId, timestamp: "2026-05-24T00:00:00.000Z", cwd: "/tmp/runtime" }),
        JSON.stringify({
          type: "message",
          id: "legacy-user",
          parentId: null,
          timestamp: "2026-05-24T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "legacy prompt" }] },
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const defaultCtx = { workspaceId: "default" };
    await expect(store.list(defaultCtx)).resolves.toEqual([expect.objectContaining({ id: sessionId })]);
    await expect(store.load(defaultCtx, sessionId)).resolves.toEqual(expect.objectContaining({ id: sessionId, turnCount: 1 }));
    await expect(store.list(ctx)).resolves.toEqual([]);
    await expect(store.load(ctx, sessionId)).rejects.toThrow("Session not found");
  });

  it("loads a freshly created session with no message entries", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx);
    const detail = await store.load(ctx, session.id);
    expect(detail.turnCount).toBe(0);
    const entries = await store.loadEntries(ctx, session.id);
    expect(entries.messages).toEqual([]);
  });

  it("loads raw timestamp-named Pi session files for existing native sessions", async () => {
    const sessionId = "native-session";
    const nativePath = join(tmpDir, `2026-06-04T15-23-19-668Z_${sessionId}.jsonl`);
    const wrapperPath = join(tmpDir, `${sessionId}.jsonl`);
    await writeFile(
      nativePath,
      `${JSON.stringify({
        type: "session",
        version: 1,
        id: sessionId,
        timestamp: "2026-06-04T15:23:19.668Z",
        cwd: "/tmp",
      })}\n`,
      "utf-8",
    );

    const store = new PiSessionStore("/tmp", tmpDir);
    const defaultCtx = { workspaceId: "default" };

    expect(store.loadPiSessionFileSync(defaultCtx, sessionId)).toBe(nativePath);
    await expect(store.loadPiSessionFile(defaultCtx, sessionId)).resolves.toBe(nativePath);

    const wrapperContent = await readFile(wrapperPath, "utf-8");
    expect(wrapperContent).toContain("\"pi_session_file\"");
    expect(wrapperContent).toContain("\"boringSessionCtx\":{\"workspaceId\":\"default\"}");
    expect(wrapperContent).toContain(nativePath);
  });

  it("keeps browser draft native transcripts wrapper-free after first materialization", async () => {
    const sessionId = "brdraft_abcdefghijklmnop";
    const store = new PiSessionStore("/tmp", tmpDir);
    const manager = SessionManager.create("/tmp", tmpDir, { id: sessionId });
    manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }] } as any);
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "hi" }] } as any);

    const files = await readdir(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`_${sessionId}\\.jsonl$`));
    expect(files).not.toContain(`${sessionId}.jsonl`);
    await expect(store.list(ctx)).resolves.toEqual([expect.objectContaining({ id: sessionId, turnCount: 1 })]);
    await expect(store.load(ctx, sessionId)).resolves.toEqual(expect.objectContaining({ id: sessionId, turnCount: 1 }));
    await store.rename(ctx, sessionId, "Renamed native draft");
    const afterRenameFiles = await readdir(tmpDir);
    expect(afterRenameFiles).toHaveLength(1);
    const content = await readFile(join(tmpDir, afterRenameFiles[0]!), "utf-8");
    expect(content).toContain("Renamed native draft");
    expect(content).not.toContain("pi_session_file");
  });

  it("does not create duplicate wrappers for already linked native transcripts", async () => {
    const nativeSessionId = "native-linked";
    const boringSessionId = "boring-wrapper";
    const nativePath = join(tmpDir, `2026-06-04T15-23-19-668Z_${nativeSessionId}.jsonl`);
    const boringPath = join(tmpDir, `${boringSessionId}.jsonl`);
    await writeFile(
      nativePath,
      [
        {
          type: "session",
          version: 1,
          id: nativeSessionId,
          timestamp: "2026-06-04T15:23:19.668Z",
          cwd: "/tmp",
        },
        {
          type: "message",
          id: "native-user-1",
          parentId: null,
          timestamp: "2026-06-04T15:23:20.000Z",
          message: { role: "user", content: [{ type: "text", text: "linked prompt" }] },
        },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n",
      "utf-8",
    );
    await writeFile(
      boringPath,
      [
        {
          type: "session",
          version: 1,
          id: boringSessionId,
          timestamp: "2026-06-04T15:23:19.668Z",
          cwd: "/tmp",
        },
        {
          type: "pi_session_file",
          timestamp: "2026-06-04T15:23:19.668Z",
          path: nativePath,
        },
      ].map((line) => JSON.stringify(line)).join("\n") + "\n",
      "utf-8",
    );

    const store = new PiSessionStore("/tmp", tmpDir);
    const defaultCtx = { workspaceId: "default" };

    expect(store.loadPiSessionFileSync(defaultCtx, nativeSessionId)).toBeNull();
    await expect(store.loadPiSessionFile(defaultCtx, nativeSessionId)).resolves.toBeNull();
    await expect(readFile(join(tmpDir, `${nativeSessionId}.jsonl`), "utf-8"))
      .rejects.toMatchObject({ code: ENOENT_CODE });

    await expect(store.load(defaultCtx, nativeSessionId)).rejects.toThrow("Session not found");
    const detail = await store.load(defaultCtx, boringSessionId);
    expect(detail.id).toBe(boringSessionId);
    const entries = await store.loadEntries(defaultCtx, boringSessionId);
    expect((entries.messages[0] as { content: unknown }).content).toEqual([
      { type: "text", text: "linked prompt" },
    ]);

    const summaries = await store.list(defaultCtx);
    expect(summaries.map((summary) => summary.id)).toEqual([boringSessionId]);

    await store.delete(defaultCtx, nativeSessionId);
    await expect(readFile(boringPath, "utf-8")).resolves.toContain("\"pi_session_file\"");
    await expect(readFile(nativePath, "utf-8")).resolves.toContain("\"native-linked\"");
  });


  it("loads pi session file mappings from legacy timestamp-prefixed Boring session files", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const sessionId = "visible-session";
    const piFile = join(tmpDir, "native-pi-session.jsonl");
    const boringFile = join(tmpDir, `20260524_${sessionId}.jsonl`);
    await writeFile(piFile, "", "utf-8");
    await writeFile(boringFile, [
      JSON.stringify({ type: "session", version: 1, id: sessionId, timestamp: "2026-05-24T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "pi_session_file", timestamp: "2026-05-24T00:00:01.000Z", path: piFile }),
      "",
    ].join("\n"), "utf-8");

    const defaultCtx = { workspaceId: "default" };
    expect(store.loadPiSessionFileSync(defaultCtx, sessionId)).toBe(piFile);
    await expect(store.loadPiSessionFile(defaultCtx, sessionId)).resolves.toBe(piFile);
  });

  it("deletes a session", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx);
    await store.delete(ctx, session.id);
    const list = await store.list(ctx);
    expect(list).toHaveLength(0);
  });

  it("throws on load of nonexistent session", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    await expect(store.load(ctx, "nope")).rejects.toThrow("Session not found");
  });

  it("list returns empty for missing directory", async () => {
    const store = new PiSessionStore("/tmp", join(tmpDir, "nonexistent"));
    const list = await store.list(ctx);
    expect(list).toHaveLength(0);
  });

  it("list orders by updatedAt descending", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const s1 = await store.create(ctx, { title: "First" });
    await new Promise((r) => setTimeout(r, 50));
    const s2 = await store.create(ctx, { title: "Second" });

    const list = await store.list(ctx);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(s2.id);
    expect(list[1].id).toBe(s1.id);
  });

  it("paginates session lists by valid summaries", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const first = await store.create(ctx, { title: "First" });
    const second = await store.create(ctx, { title: "Second" });
    const third = await store.create(ctx, { title: "Third" });
    const now = Date.now();
    await utimes(join(tmpDir, `${first.id}.jsonl`), new Date(now - 3000), new Date(now - 3000));
    await utimes(join(tmpDir, `${second.id}.jsonl`), new Date(now - 2000), new Date(now - 2000));
    await utimes(join(tmpDir, `${third.id}.jsonl`), new Date(now - 1000), new Date(now - 1000));

    const list = await store.list(ctx, { limit: 1, offset: 1 });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(expect.objectContaining({ id: second.id, title: "Second" }));
  });

  it("fills paginated lists after skipping malformed session files", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const first = await store.create(ctx, { title: "First" });
    const second = await store.create(ctx, { title: "Second" });
    const third = await store.create(ctx, { title: "Third" });
    const badPath = join(tmpDir, "newest-bad.jsonl");
    await writeFile(badPath, "NOT A SESSION\n", "utf-8");
    const now = Date.now();
    await utimes(join(tmpDir, `${first.id}.jsonl`), new Date(now - 4000), new Date(now - 4000));
    await utimes(join(tmpDir, `${second.id}.jsonl`), new Date(now - 3000), new Date(now - 3000));
    await utimes(join(tmpDir, `${third.id}.jsonl`), new Date(now - 2000), new Date(now - 2000));
    await utimes(badPath, new Date(now - 1000), new Date(now - 1000));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const firstPage = await store.list(ctx, { limit: 2 });
      expect(firstPage.map((session) => session.id)).toEqual([third.id, second.id]);

      const secondPage = await store.list(ctx, { limit: 1, offset: 2 });
      expect(secondPage.map((session) => session.id)).toEqual([first.id]);
    } finally {
      warn.mockRestore();
    }
  });

  it("can include a requested active session outside the first page", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const first = await store.create(ctx, { title: "First" });
    const second = await store.create(ctx, { title: "Second" });
    const third = await store.create(ctx, { title: "Third" });
    const now = Date.now();
    await utimes(join(tmpDir, `${first.id}.jsonl`), new Date(now - 3000), new Date(now - 3000));
    await utimes(join(tmpDir, `${second.id}.jsonl`), new Date(now - 2000), new Date(now - 2000));
    await utimes(join(tmpDir, `${third.id}.jsonl`), new Date(now - 1000), new Date(now - 1000));

    const list = await store.list(ctx, { limit: 1, includeId: first.id });

    expect(list.map((session) => session.id)).toEqual([third.id, first.id]);
  });

  it("refreshes cached summaries when linked Pi transcripts change", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const nativePath = join(tmpDir, "2026-06-04_native-linked.jsonl");
    const boringPath = join(tmpDir, "boring-linked.jsonl");
    const nativeLines = [
      {
        type: "session",
        version: 1,
        id: "native-linked",
        timestamp: "2026-06-04T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "native-user-1",
        parentId: null,
        timestamp: "2026-06-04T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "first linked prompt" }] },
      },
    ];
    const boringLines = [
      {
        type: "session",
        version: 1,
        id: "boring-linked",
        timestamp: "2026-06-04T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "pi_session_file",
        timestamp: "2026-06-04T00:00:01.000Z",
        path: nativePath,
      },
    ];
    await writeFile(nativePath, `${nativeLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    await writeFile(boringPath, `${boringLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const defaultCtx = { workspaceId: "default" };
    const firstList = await store.list(defaultCtx, { limit: 1 });
    expect(firstList[0]).toEqual(expect.objectContaining({ id: "boring-linked", turnCount: 1 }));

    const { appendFile } = await import("node:fs/promises");
    await appendFile(nativePath, `${JSON.stringify({
      type: "message",
      id: "native-user-2",
      parentId: "native-user-1",
      timestamp: "2026-06-04T00:00:02.000Z",
      message: { role: "user", content: [{ type: "text", text: "second linked prompt" }] },
    })}\n`, "utf-8");
    const touched = new Date(Date.now() + 1000);
    await utimes(nativePath, touched, touched);

    const secondList = await store.list(defaultCtx, { limit: 1 });
    expect(secondList[0]).toEqual(expect.objectContaining({ id: "boring-linked", turnCount: 2 }));
  });

  it("orders linked Pi transcript sessions by linked transcript mtime before pagination", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const nativePath = join(tmpDir, "2026-06-04_native-active.jsonl");
    const boringPath = join(tmpDir, "boring-active.jsonl");
    const olderDirectPath = join(tmpDir, "direct-older.jsonl");
    const nativeLines = [
      {
        type: "session",
        version: 1,
        id: "native-active",
        timestamp: "2026-06-04T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "message",
        id: "native-user-1",
        parentId: null,
        timestamp: "2026-06-04T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "active linked prompt" }] },
      },
    ];
    const boringLines = [
      {
        type: "session",
        version: 1,
        id: "boring-active",
        timestamp: "2026-06-04T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "pi_session_file",
        timestamp: "2026-06-04T00:00:01.000Z",
        path: nativePath,
      },
    ];
    const directLines = [
      {
        type: "session",
        version: 1,
        id: "direct-older",
        timestamp: "2026-06-04T00:00:00.000Z",
        cwd: "/tmp",
      },
      {
        type: "session_info",
        id: "direct-title",
        parentId: null,
        timestamp: "2026-06-04T00:00:01.000Z",
        name: "Direct older",
      },
    ];
    await writeFile(nativePath, `${nativeLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    await writeFile(boringPath, `${boringLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    await writeFile(olderDirectPath, `${directLines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const now = Date.now();
    await utimes(boringPath, new Date(now - 10_000), new Date(now - 10_000));
    await utimes(olderDirectPath, new Date(now - 1_000), new Date(now - 1_000));
    await utimes(nativePath, new Date(now), new Date(now));

    const defaultCtx = { workspaceId: "default" };
    const firstPage = await store.list(defaultCtx, { limit: 1 });

    expect(firstPage.map((session) => session.id)).toEqual(["boring-active"]);
  });

  it("summarizes giant UI snapshots from file prefixes", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Huge snapshot" });
    const filepath = join(tmpDir, `${session.id}.jsonl`);
    const giantSnapshot = JSON.stringify({
      type: "ui_snapshot",
      id: "snapshot",
      timestamp: new Date().toISOString(),
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "x".repeat(2_000_000) }] }],
    });
    await writeFile(filepath, `${await readFile(filepath, "utf-8")}${giantSnapshot}\n`, "utf-8");

    const list = await store.list(ctx, { limit: 1 });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(expect.objectContaining({ id: session.id, title: "Huge snapshot" }));
  });

  it("skips malformed JSONL lines without crashing", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Malformed test" });

    const filepath = join(tmpDir, `${session.id}.jsonl`);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(filepath, "NOT VALID JSON\n");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const detail = await store.load(ctx, session.id);
    expect(detail.title).toBe("Malformed test");
    warn.mockRestore();
  });

  it("create+load roundtrip preserves title", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Roundtrip" });
    const detail = await store.load(ctx, session.id);
    expect(detail.title).toBe("Roundtrip");
    expect(detail.id).toBe(session.id);
    expect(detail.turnCount).toBe(0);
  });
});
