import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createResourceSettingsManager,
  createPiCodingAgentHarness,
  mergePiPackageSources,
} from "../createHarness.js";
import { adaptToolsForPi } from "../tool-adapter.js";
import { PiSessionStore } from "../sessions.js";
import type { AgentTool } from "../../../../shared/tool.js";

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
    expect(typeof harness.sendMessage).toBe("function");
    expect(typeof harness.reloadSession).toBe("function");
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
        .rejects.toMatchObject({ code: "ENOENT" });
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
});

describe("pi extension path hot reload", () => {
  it("reloads changed extension source from additionalExtensionPaths instead of using inline factories", async () => {
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

  it("throws on isError results", async () => {
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
    await expect(
      adapted.execute("call-1", {}, undefined, undefined, {} as any),
    ).rejects.toThrow("something broke");
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

  it("creates and lists sessions", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx, { title: "Test" });
    expect(session.id).toBeTruthy();
    expect(session.title).toBe("Test");

    const list = await store.list(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(session.id);
  });

  it("loads a session with empty messages", async () => {
    const store = new PiSessionStore("/tmp", tmpDir);
    const session = await store.create(ctx);
    const detail = await store.load(ctx, session.id);
    expect(detail.messages).toEqual([]);
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
