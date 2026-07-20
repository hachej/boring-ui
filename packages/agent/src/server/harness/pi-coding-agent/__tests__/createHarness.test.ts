import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile, utimes } from "node:fs/promises";
import { CURRENT_SESSION_VERSION, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  createResourceSettingsManager,
  createPiCodingAgentHarness,
  mergePiPackageSources,
} from "../createHarness.js";
import { adaptToolsForPi } from "../tool-adapter.js";
import {
  NATIVE_TAIL_MAX_RECORD_BYTES,
  PiSessionStore,
  nativeMessageTimestampFromBoundedPrefix,
} from "../sessions.js";
import { ErrorCode } from "../../../../shared/error-codes.js";
import type { AgentTool } from "../../../../shared/tool.js";

const fsHooks = vi.hoisted(() => ({
  onRename: undefined as (() => Promise<void>) | undefined,
  onUnlink: undefined as (() => Promise<void>) | undefined,
  onUtimes: undefined as (() => void) | undefined,
  onWriteFile: undefined as ((data: unknown) => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fsHooks.onRename) return fsHooks.onRename();
      return actual.rename(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      fsHooks.onWriteFile?.(args[1]);
      return actual.writeFile(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (fsHooks.onUnlink) return fsHooks.onUnlink();
      return actual.unlink(...args);
    },
    utimes: async (...args: Parameters<typeof actual.utimes>) => {
      fsHooks.onUtimes?.();
      return actual.utimes(...args);
    },
  };
});

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

  it("rejects strict native creation before persisting a transcript", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-strict-native-model-"));
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
        pi: { strictModelResolution: true },
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string; model: { provider: string; id: string } }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };

      await expect(harness.createNativePiSessionAdapter({
        message: "hello",
        model: { provider: "missing-provider", id: "missing-model" },
      }, { abortSignal: new AbortController().signal, workdir: cwd })).rejects.toMatchObject({
        statusCode: 400,
        code: ErrorCode.enum.TOOL_INVALID_INPUT,
      });
      await expect(readdir((harness.sessions as PiSessionStore).getSessionDir()).catch(() => [])).resolves.toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("restores the initial native ID when filename reconciliation fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-rename-failure-"));
    const reload = vi.spyOn(DefaultResourceLoader.prototype, "reload").mockRejectedValueOnce(new Error("injected resource failure"));
    fsHooks.onRename = async () => { throw new Error("injected rename failure"); };
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };
      const failure = await harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      ).catch((error: unknown) => error) as { nativeSessionId?: string };
      const sessionDir = (harness.sessions as PiSessionStore).getSessionDir();
      const files = await readdir(sessionDir);

      expect(files).toHaveLength(1);
      expect(failure.nativeSessionId).toEqual(expect.any(String));
      const header = JSON.parse((await readFile(join(sessionDir, files[0]!), "utf8")).split("\n")[0]!);
      expect(header.id).toBe(failure.nativeSessionId);
      expect(files[0]).toMatch(new RegExp(`_${failure.nativeSessionId}\\.jsonl$`));
      await expect((harness.sessions as PiSessionStore).load({}, failure.nativeSessionId!)).resolves.toMatchObject({ id: failure.nativeSessionId });
    } finally {
      fsHooks.onRename = undefined;
      reload.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("attributes a post-persistence failure to its own native ID despite a concurrent native transcript", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-concurrent-persistence-"));
    let sessionDir = "";
    const concurrentId = "concurrent-native";
    const reload = vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementation(async () => {
      await writeFile(join(sessionDir, `2026-06-04T00-00-00-000Z_${concurrentId}.jsonl`), `${JSON.stringify({
        type: "session", version: CURRENT_SESSION_VERSION, id: concurrentId, timestamp: "2026-06-04T00:00:00.000Z",
      })}\n`);
      throw new Error("injected resource failure");
    });
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };
      sessionDir = (harness.sessions as PiSessionStore).getSessionDir();
      const failure = await harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      ).catch((error: unknown) => error) as { nativeSessionId?: string };
      const files = await readdir(sessionDir);
      const headers = await Promise.all(files.map(async (file) => JSON.parse((await readFile(join(sessionDir, file), "utf8")).split("\n")[0]!)));

      expect(failure.nativeSessionId).toEqual(expect.any(String));
      expect(failure.nativeSessionId).not.toBe(concurrentId);
      expect(headers.some((header) => header.id === failure.nativeSessionId)).toBe(true);
    } finally {
      reload.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not expose an unresolvable native ID when rename recovery cannot restore its header", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-rename-recovery-failure-"));
    fsHooks.onRename = async () => { throw new Error("injected rename failure"); };
    fsHooks.onWriteFile = (data) => {
      if (typeof data === "string" && data.length > 0) throw new Error("injected header restore failure");
    };
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };
      const failure = await harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      ).catch((error: unknown) => error) as { nativeSessionId?: string; code?: string; statusCode?: number };
      const sessionDir = (harness.sessions as PiSessionStore).getSessionDir();

      expect(failure).toMatchObject({
        code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
        statusCode: 500,
      });
      expect(failure.nativeSessionId).toBeUndefined();
      await expect(readdir(sessionDir)).resolves.toEqual([]);
    } finally {
      fsHooks.onRename = undefined;
      fsHooks.onWriteFile = undefined;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports cleanup failure safely without exposing the unusable native ID", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-rename-cleanup-failure-"));
    fsHooks.onRename = async () => { throw new Error("injected rename failure"); };
    fsHooks.onWriteFile = (data) => {
      if (typeof data === "string" && data.length > 0) throw new Error("injected header restore failure");
    };
    fsHooks.onUnlink = async () => { throw new Error("injected unlink failure"); };
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };
      const failure = await harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      ).catch((error: unknown) => error) as { nativeSessionId?: string; cleanupError?: string };

      expect(failure.nativeSessionId).toBeUndefined();
      expect(failure.cleanupError).toBe("Could not remove the unusable native session file.");
    } finally {
      fsHooks.onRename = undefined;
      fsHooks.onUnlink = undefined;
      fsHooks.onWriteFile = undefined;
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("removes only a newly created placeholder when opening it fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-open-failure-"));
    const open = vi.spyOn(SessionManager, "open").mockImplementation(() => { throw new Error("injected open failure"); });
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };

      await expect(harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      )).rejects.toThrow("injected open failure");
      await expect(readdir((harness.sessions as PiSessionStore).getSessionDir())).resolves.toEqual([]);
    } finally {
      open.mockRestore();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not remove a pre-existing placeholder when opening it fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-native-existing-open-failure-"));
    let existingFile: string | undefined;
    const create = SessionManager.create.bind(SessionManager);
    const createSpy = vi.spyOn(SessionManager, "create").mockImplementation((...args) => {
      const manager = create(...args);
      existingFile = manager.getSessionFile();
      if (existingFile) writeFileSync(existingFile, "");
      return manager;
    });
    const open = vi.spyOn(SessionManager, "open").mockImplementation(() => { throw new Error("injected open failure"); });
    try {
      const harness = createPiCodingAgentHarness({
        tools: [noopTool],
        cwd,
        sessionRoot: cwd,
        nativeSessionStartEnabled: true,
      }) as ReturnType<typeof createPiCodingAgentHarness> & {
        createNativePiSessionAdapter: (input: { message: string }, ctx: { abortSignal: AbortSignal; workdir: string }) => Promise<unknown>;
      };

      await expect(harness.createNativePiSessionAdapter(
        { message: "hello" },
        { abortSignal: new AbortController().signal, workdir: cwd },
      )).rejects.toThrow("injected open failure");
      expect(existingFile).toBeDefined();
      await expect(readdir((harness.sessions as PiSessionStore).getSessionDir())).resolves.toEqual([basename(existingFile!)]);
    } finally {
      open.mockRestore();
      createSpy.mockRestore();
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

  it("lists bare native transcripts only with the explicit capability and preserves order across rename", async () => {
    const olderId = "native-older";
    const newerId = "native-newer";
    const olderPath = join(tmpDir, `2026-06-04_${olderId}.jsonl`);
    const newerPath = join(tmpDir, `2026-06-04_${newerId}.jsonl`);
    const transcript = (id: string, text: string, latestMessageTimestamp: string) => [
      { type: "session", version: CURRENT_SESSION_VERSION, id, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" },
      { type: "message", id: `${id}-user`, parentId: null, timestamp: "2026-06-04T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text }] } },
      { type: "message", id: `${id}-assistant`, parentId: `${id}-user`, timestamp: latestMessageTimestamp, message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    await writeFile(olderPath, transcript(olderId, "older", "2026-06-04T00:00:02.000Z"));
    await writeFile(newerPath, transcript(newerId, "newer", "2026-06-04T00:00:03.000Z"));
    const now = Date.now();
    await utimes(olderPath, new Date(now - 2_000), new Date(now - 2_000));
    await utimes(newerPath, new Date(now - 1_000), new Date(now - 1_000));

    const denied = new PiSessionStore("/tmp", { sessionDir: tmpDir });
    await expect(denied.list({ workspaceId: "default" })).resolves.toEqual([]);

    const directCtx = { workspaceId: "direct-local" };
    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    const before = await store.list(directCtx);
    expect(before.map((session) => session.id)).toEqual([newerId, olderId]);
    expect(before[1]).toMatchObject({ nativeSessionId: olderId, hasAssistantReply: true, updatedAt: "2026-06-04T00:00:02.000Z" });
    await expect(store.load(directCtx, olderId)).resolves.toMatchObject({ updatedAt: "2026-06-04T00:00:02.000Z" });

    const mtimeBeforeRename = (await stat(olderPath)).mtimeMs;
    await expect(store.rename(directCtx, olderId, "\r\n Renamed older \n")).resolves.toMatchObject({
      title: "Renamed older",
      updatedAt: "2026-06-04T00:00:02.000Z",
    });
    expect(Math.abs(((await stat(olderPath)).mtimeMs - mtimeBeforeRename) / 1000)).toBeLessThanOrEqual(0.01);
    const afterRename = await store.list(directCtx);
    expect(afterRename.map((session) => session.id)).toEqual([newerId, olderId]);
    expect(afterRename[1]).toMatchObject({ title: "Renamed older", updatedAt: "2026-06-04T00:00:02.000Z" });
    await expect(readFile(join(tmpDir, `${olderId}.jsonl`), "utf8")).rejects.toMatchObject({ code: ENOENT_CODE });
    expect(await readFile(olderPath, "utf8")).not.toContain("pi_session_file");

    await appendFile(olderPath, `${JSON.stringify({ type: "message", id: `${olderId}-later`, parentId: `${olderId}-assistant`, timestamp: "2026-06-04T00:00:04.000Z", message: { role: "user", content: [{ type: "text", text: "later" }] } })}\n`);
    expect((await store.list(directCtx))[0]).toEqual(expect.objectContaining({ id: olderId, updatedAt: "2026-06-04T00:00:04.000Z" }));
    await expect(store.load(directCtx, olderId)).resolves.toMatchObject({ updatedAt: "2026-06-04T00:00:04.000Z" });
  });

  it("keeps native mtime fresh when a concurrent large append precedes rename validation", async () => {
    const id = "native-concurrent-before";
    const filepath = join(tmpDir, `2026-06-04_${id}.jsonl`);
    await writeFile(filepath, [
      JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "assistant", parentId: null, message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      "",
    ].join("\n"), "utf-8");
    await utimes(filepath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    const mtimeBeforeRename = (await stat(filepath)).mtimeMs;
    const open = SessionManager.open.bind(SessionManager);
    const openSpy = vi.spyOn(SessionManager, "open").mockImplementation((...args) => {
      const manager = open(...args);
      const appendSessionInfo = manager.appendSessionInfo.bind(manager);
      vi.spyOn(manager, "appendSessionInfo").mockImplementation((name) => {
        const result = appendSessionInfo(name);
        appendFileSync(filepath, `${JSON.stringify({ type: "custom", payload: "x".repeat(128 * 1024) })}\n`);
        return result;
      });
      return manager;
    });

    try {
      const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
      await store.rename({ workspaceId: "direct-local" }, id, "Renamed concurrently");
      expect(((await stat(filepath)).mtimeMs - mtimeBeforeRename) / 1000).toBeGreaterThan(1);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("keeps native mtime fresh when a concurrent append follows rename validation", async () => {
    const id = "native-concurrent-after";
    const filepath = join(tmpDir, `2026-06-04_${id}.jsonl`);
    await writeFile(filepath, [
      JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "assistant", parentId: null, message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }),
      "",
    ].join("\n"), "utf-8");
    await utimes(filepath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    const mtimeBeforeRename = (await stat(filepath)).mtimeMs;
    let appended = false;
    fsHooks.onUtimes = () => {
      if (appended) return;
      appended = true;
      appendFileSync(filepath, `${JSON.stringify({ type: "message", id: "concurrent", message: { role: "user", content: [{ type: "text", text: "later" }] } })}\n`);
    };

    try {
      const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
      await store.rename({ workspaceId: "direct-local" }, id, "Renamed concurrently");
      expect(appended).toBe(true);
      expect(((await stat(filepath)).mtimeMs - mtimeBeforeRename) / 1000).toBeGreaterThan(1);
    } finally {
      fsHooks.onUtimes = undefined;
    }
  });

  it("streams large native transcript summaries and skips malformed records", async () => {
    const nativeId = "native-large";
    const nativePath = join(tmpDir, `2026-06-04_${nativeId}.jsonl`);
    const lines = [
      { type: "session", version: 1, id: nativeId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" },
      { type: "ui_snapshot", id: "large", payload: "x".repeat(128_000) },
      { type: "message", id: "user-1", message: { role: "user", content: [{ type: "text", text: "first native prompt" }] } },
      "not valid JSON",
      { type: "message", id: "assistant-1", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
      { type: "message", id: "user-2", message: { role: "user", content: [{ type: "text", text: "second native prompt" }] } },
      { type: "session_info", id: "late-title", name: "Latest native title" },
    ];
    await writeFile(nativePath, `${lines.map((line) => typeof line === "string" ? line : JSON.stringify(line)).join("\n")}\n`, "utf-8");

    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    await expect(store.list({ workspaceId: "direct-local" })).resolves.toEqual([
      expect.objectContaining({
        id: nativeId,
        title: "Latest native title",
        turnCount: 2,
        nativeSessionId: nativeId,
        hasAssistantReply: true,
      }),
    ]);
  });

  it("paginates over many large native transcripts", async () => {
    const directCtx = { workspaceId: "direct-local" };
    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    for (let index = 0; index < 12; index += 1) {
      const id = `native-page-${index}`;
      const path = join(tmpDir, `2026-06-04_${id}.jsonl`);
      const lines = [
        { type: "session", version: 1, id, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" },
        { type: "message", id: `${id}-message`, timestamp: new Date(Date.UTC(2026, 5, 4, 0, 0, index)).toISOString(), message: { role: "user", content: [{ type: "text", text: id }] } },
        ...(index < 11 ? [{ type: "ui_snapshot", payload: "x".repeat(128_000) }] : []),
      ];
      await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf-8");
    }

    await expect(store.list(directCtx, { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: "native-page-11" }),
    ]);
  });

  it("uses a bounded reverse tail scan for giant native message records", async () => {
    const giantId = "native-giant-tail";
    const olderId = "native-tail-older";
    const giantPath = join(tmpDir, `2026-06-04_${giantId}.jsonl`);
    const olderPath = join(tmpDir, `2026-06-04_${olderId}.jsonl`);
    const giantMessage = JSON.stringify({ type: "message", id: "giant", timestamp: "2026-06-04T00:00:10.000Z", message: { role: "user", content: [{ type: "text", text: "x".repeat(NATIVE_TAIL_MAX_RECORD_BYTES * 4) }] } });
    const boundedPrefix = Buffer.from(giantMessage).subarray(0, NATIVE_TAIL_MAX_RECORD_BYTES);
    expect(boundedPrefix).toHaveLength(NATIVE_TAIL_MAX_RECORD_BYTES);
    expect(nativeMessageTimestampFromBoundedPrefix(boundedPrefix)).toBe(Date.parse("2026-06-04T00:00:10.000Z"));

    await writeFile(giantPath, [
      JSON.stringify({ type: "session", version: 1, id: giantId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      giantMessage,
      "not valid JSON",
      JSON.stringify({ type: "session_info", id: "tail-title", name: "Giant tail" }),
      "",
    ].join("\n"), "utf-8");
    await writeFile(olderPath, [
      JSON.stringify({ type: "session", version: 1, id: olderId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "older", timestamp: "2026-06-04T00:00:09.000Z", message: { role: "user", content: [{ type: "text", text: "older" }] } }),
      "",
    ].join("\n"), "utf-8");
    const now = new Date();
    await utimes(giantPath, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    await utimes(olderPath, now, now);

    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    await expect(store.list({ workspaceId: "direct-local" }, { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: giantId, title: "Giant tail", updatedAt: "2026-06-04T00:00:10.000Z" }),
    ]);
  });

  it.each<[string, number, number]>([
    ["type", 4, 0],
    ["timestamp", Buffer.byteLength('{"type":"message","time'), 0],
    ["timestamp with a huge suffix", Buffer.byteLength('{"type":"message","time'), NATIVE_TAIL_MAX_RECORD_BYTES * 2],
  ])("finds a native message whose %s crosses a reverse-tail chunk boundary", async (_metadata, splitAt, minimumPayloadBytes) => {
    const targetId = `native-tail-boundary-${splitAt}-${minimumPayloadBytes}`;
    const olderId = `native-tail-boundary-older-${splitAt}-${minimumPayloadBytes}`;
    const targetPath = join(tmpDir, `2026-06-04_${targetId}.jsonl`);
    const olderPath = join(tmpDir, `2026-06-04_${olderId}.jsonl`);
    const chunkBytes = 64 * 1024;
    const nativeMessage = (payloadLength: number) => JSON.stringify({
      type: "message",
      id: `${targetId}-message`,
      timestamp: "2026-06-04T00:00:10.000Z",
      message: { role: "user", content: [{ type: "text", text: "newest" }] },
      payload: "x".repeat(payloadLength),
    });
    const baseLength = Buffer.byteLength(nativeMessage(0));
    const payloadLength = minimumPayloadBytes
      + (chunkBytes - ((baseLength + minimumPayloadBytes + 1 - splitAt) % chunkBytes)) % chunkBytes;
    const message = nativeMessage(payloadLength);
    expect((Buffer.byteLength(message) + 1 - splitAt) % chunkBytes).toBe(0);
    if (minimumPayloadBytes > 0) expect(Buffer.byteLength(message)).toBeGreaterThan(NATIVE_TAIL_MAX_RECORD_BYTES);

    await writeFile(targetPath, [
      JSON.stringify({ type: "session", version: 1, id: targetId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      message,
      "",
    ].join("\n"), "utf-8");
    await writeFile(olderPath, [
      JSON.stringify({ type: "session", version: 1, id: olderId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: `${olderId}-message`, timestamp: "2026-06-04T00:00:09.000Z", message: { role: "user", content: [{ type: "text", text: "older" }] } }),
      "",
    ].join("\n"), "utf-8");
    await utimes(targetPath, new Date("2026-06-04T00:00:08.000Z"), new Date("2026-06-04T00:00:08.000Z"));
    await utimes(olderPath, new Date("2026-06-04T00:00:09.000Z"), new Date("2026-06-04T00:00:09.000Z"));

    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    await expect(store.list({ workspaceId: "direct-local" }, { limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: targetId, updatedAt: "2026-06-04T00:00:10.000Z" }),
    ]);
  });

  it("skips a giant trailing native ui_snapshot during tail timestamp lookup", async () => {
    const nativeId = "native-giant-snapshot-tail";
    const nativePath = join(tmpDir, `2026-06-04_${nativeId}.jsonl`);
    await writeFile(nativePath, [
      JSON.stringify({ type: "session", version: 1, id: nativeId, timestamp: "2026-06-04T00:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "message", id: "message", timestamp: "2026-06-04T00:00:10.000Z", message: { role: "user", content: [{ type: "text", text: "kept" }] } }),
      JSON.stringify({ type: "ui_snapshot", payload: "x".repeat(NATIVE_TAIL_MAX_RECORD_BYTES * 4) }),
      "",
    ].join("\n"), "utf-8");

    const store = new PiSessionStore("/tmp", { sessionDir: tmpDir, allowNativeUnscopedAccess: true });
    await expect(store.list({ workspaceId: "direct-local" })).resolves.toEqual([
      expect.objectContaining({ id: nativeId, updatedAt: "2026-06-04T00:00:10.000Z" }),
    ]);
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
