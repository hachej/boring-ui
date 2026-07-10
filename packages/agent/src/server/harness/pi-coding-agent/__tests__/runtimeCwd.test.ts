import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  mockSubscribers,
  promptHandle,
  mockLastSystemPrompt,
  mockCurrentModel,
  mockSetModel,
  mockSetThinkingLevel,
  mockFindModel,
  mockCreateAgentSessionConfigs,
  mockSessionManagerCreate,
  mockSessionManagerOpen,
  mockResourceLoaderOptions,
  mockInMemorySettingsManager,
  mockSettingsManagerCreate,
  mockGetAgentDir,
} = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  mockLastSystemPrompt: { value: undefined as undefined | string },
  mockCreateAgentSessionConfigs: [] as any[],
  mockSessionManagerCreate: vi.fn(() => ({ getSessionFile: () => null })),
  mockSessionManagerOpen: vi.fn(() => ({ getSessionFile: () => null })),
  mockResourceLoaderOptions: [] as any[],
  mockInMemorySettingsManager: { kind: "in-memory" },
  mockSettingsManagerCreate: vi.fn(() => ({
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getResolvedSettings: () => ({}),
    loadAllSettings: vi.fn(),
  })),
  mockGetAgentDir: vi.fn(() => "/tmp/test-agent-dir"),
  mockCurrentModel: {
    value: undefined as undefined | { provider: string; id: string },
  },
  mockSetModel: vi.fn(async (model: { provider: string; id: string }) => {
    mockCurrentModel.value = model;
  }),
  mockSetThinkingLevel: vi.fn(),
  mockFindModel: vi.fn((provider: string, id: string) => ({ provider, id })),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn().mockImplementation(async (config: any) => {
    mockCreateAgentSessionConfigs.push(config);
    mockCurrentModel.value = config.model;
    const beforeAgentStartHandlers: Array<(event: any, ctx: any) => any> = [];
    for (const factory of config.resourceLoader?.getExtensionFactories?.() ?? []) {
      factory({
        on(event: string, handler: (event: any, ctx: any) => any) {
          if (event === "before_agent_start") beforeAgentStartHandlers.push(handler);
        },
      });
    }
    for (const extension of config.resourceLoader?.getExtensions?.().extensions ?? []) {
      beforeAgentStartHandlers.push(...(extension.handlers.get("before_agent_start") ?? []));
    }
    const buildSystemPrompt = () => {
      const systemPrompt = config.resourceLoader?.getSystemPrompt?.()
        ?? "You are a fake test coding agent. You may read/edit/write files.";
      const append = config.resourceLoader?.getAppendSystemPrompt?.().join("\n\n");
      return [
        systemPrompt,
        append,
        "Current date: 2026-05-20",
        `Current working directory: ${config.cwd}`,
      ].filter(Boolean).join("\n");
    };
    return {
      session: {
        subscribe(listener: (event: any) => void) {
          mockSubscribers.push(listener);
          return () => {
            const idx = mockSubscribers.indexOf(listener);
            if (idx >= 0) mockSubscribers.splice(idx, 1);
          };
        },
        // prompt() resolves only when the test calls promptHandle.resolve().
        // This mirrors pi-coding-agent's real behaviour where prompt() waits
        // for agent_end before returning.
        prompt: vi.fn().mockImplementation(async () => {
          let systemPrompt = buildSystemPrompt();
          for (const handler of beforeAgentStartHandlers) {
            const result = await handler({
              prompt: "test prompt",
              systemPrompt,
              systemPromptOptions: {
                cwd: config.cwd,
                contextFiles: [],
                selectedTools: [],
                skills: [],
              },
            }, {});
            if (typeof result?.systemPrompt === "string") {
              systemPrompt = result.systemPrompt;
            }
          }
          mockLastSystemPrompt.value = systemPrompt;
          return new Promise<void>((resolve) => {
              promptHandle.resolve = resolve;
            });
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
        setModel: mockSetModel,
        setThinkingLevel: mockSetThinkingLevel,
        get model() {
          return mockCurrentModel.value;
        },
        // Mirrors pi's `get systemPrompt(): string` accessor — used by the
        // harness to satisfy AgentHarness.getSystemPrompt without a route
        // round-trip through the LLM.
        get systemPrompt() {
          return mockLastSystemPrompt.value ?? buildSystemPrompt();
        },
      },
    };
  }),
  SessionManager: { inMemory: () => ({}), create: mockSessionManagerCreate, open: mockSessionManagerOpen },
  AuthStorage: { inMemory: () => ({}), create: () => ({}) },
  // Both workspace and headless paths use Pi's DefaultResourceLoader. Stub
  // its resolved inputs so the tests can inspect discovery and prompt policy.
  getAgentDir: mockGetAgentDir,
  DefaultResourceLoader: class {
    private opts: any;
    constructor(opts: unknown) {
      this.opts = opts;
      mockResourceLoaderOptions.push(opts);
    }
    async reload() { /* no-op */ }
    getSystemPrompt() {
      const ambientSystemPrompt = "Ambient SYSTEM.md says AGENTS.md can read/edit/write files.";
      const source = this.opts.systemPrompt ?? ambientSystemPrompt;
      return this.opts.systemPromptOverride?.(source) ?? source;
    }
    getAppendSystemPrompt() {
      const ambientAppend = ["Ambient APPEND_SYSTEM.md from AGENTS.md"];
      const source = this.opts.appendSystemPrompt ?? ambientAppend;
      return this.opts.appendSystemPromptOverride?.(source) ?? source;
    }
    getSkills() {
      return this.opts.noSkills ? { skills: [], diagnostics: [] } : { skills: ["ambient"], diagnostics: [] };
    }
    getPrompts() {
      return this.opts.noPromptTemplates ? { prompts: [], diagnostics: [] } : { prompts: ["ambient"], diagnostics: [] };
    }
    getThemes() {
      return this.opts.noThemes ? { themes: [], diagnostics: [] } : { themes: ["ambient"], diagnostics: [] };
    }
    getAgentsFiles() {
      return this.opts.noContextFiles ? { agentsFiles: [] } : { agentsFiles: ["ambient"] };
    }
    getExtensions() {
      return { extensions: [], errors: [], runtime: {} };
    }
    getExtensionFactories() {
      return this.opts.extensionFactories ?? [];
    }
  },
  SettingsManager: {
    inMemory: () => mockInMemorySettingsManager,
    create: mockSettingsManagerCreate,
  },
  ModelRegistry: {
    inMemory: () => ({
      find: mockFindModel,
      // Return every model find() has been called with — keeps the mock
      // consistent: anything the registry "knows about" is also available.
      getAvailable: () => mockFindModel.mock.calls.map(([provider, id]: [string, string]) => ({ provider, id })),
    }),
    create: () => ({
      find: mockFindModel,
      getAvailable: () => mockFindModel.mock.calls.map(([provider, id]: [string, string]) => ({ provider, id })),
    }),
  },
}));

import { createPiCodingAgentHarness, withPurePiHarnessDefaults } from "../createHarness.js";
import { createAgentRuntimeBridge } from "../../../createAgent.js";
import type { AgentCoreHarness, RunContext } from "../../../../shared/harness.js";

function emitPiEvent(event: any): void {
  for (const sub of mockSubscribers) sub(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  mockCreateAgentSessionConfigs.length = 0;
  mockResourceLoaderOptions.length = 0;
  promptHandle.resolve = undefined;
  mockLastSystemPrompt.value = undefined;
  mockCurrentModel.value = undefined;
});

describe("runtime cwd separation", () => {
  it("uses runtime cwd for Pi prompt/session metadata while preserving harness storage cwd", async () => {
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/tmp/host-storage-root",
      runtimeCwd: "/workspace",
      sessionDir: "/tmp/pi-session-storage",
    });

    const ctx: RunContext = {
      abortSignal: new AbortController().signal,
      workdir: "/workspace",
    };
    await harness.getPiSessionAdapter({ sessionId: "sess-runtime-cwd", content: "" }, ctx);

    expect(mockResourceLoaderOptions[0]?.cwd).toBe("/tmp/host-storage-root");
    expect(mockSessionManagerCreate).toHaveBeenCalledWith("/workspace", "/tmp/pi-session-storage");
    expect(mockCreateAgentSessionConfigs[0]?.cwd).toBe("/workspace");

    const systemPrompt = harness.getSystemPrompt?.("sess-runtime-cwd") ?? "";
    expect(systemPrompt).toContain('The "Current working directory" line in this prompt is the workspace root.');
    expect(systemPrompt.split("\n").filter((line) => line.startsWith("Current working directory: "))).toEqual([
      "Current working directory: /workspace",
    ]);
    expect(systemPrompt).not.toContain("/tmp/host-storage-root");
  });

  it("constructs the default pure Pi harness without host cwd or ambient resources", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "boring-pure-pi-seal-"));
    const sealedCwd = join(sessionRoot, ".runtime-none");
    const bridge = createAgentRuntimeBridge({
      runtime: "none",
      sessionStorageRoot: sessionRoot,
      systemPromptAppend: "relative/path/to/host-prompt.md",
    });
    try {
      const runtime = await bridge.getRuntime();
      const harness = runtime.harness as AgentCoreHarness;
      await harness.getPiSessionAdapter({
        sessionId: "pure-spy",
        content: "",
        model: { provider: "test-provider", id: "test-model" },
      }, {
        abortSignal: new AbortController().signal,
        workdir: process.cwd(),
      });

      expect(mockSessionManagerCreate).toHaveBeenCalledWith(sealedCwd, sessionRoot);
      expect(mockCreateAgentSessionConfigs[0]?.cwd).toBe(sealedCwd);
      expect(mockCreateAgentSessionConfigs[0]?.agentDir).toBe(sealedCwd);
      expect(mockCreateAgentSessionConfigs[0]?.settingsManager).toBe(mockInMemorySettingsManager);
      expect(mockCreateAgentSessionConfigs[0]?.model).toEqual({ provider: "test-provider", id: "test-model" });
      expect(mockSettingsManagerCreate).not.toHaveBeenCalled();
      expect(mockGetAgentDir).not.toHaveBeenCalled();
      expect(mockResourceLoaderOptions).toHaveLength(1);
      expect(mockResourceLoaderOptions[0]).toMatchObject({
        cwd: sealedCwd,
        agentDir: sealedCwd,
        settingsManager: mockInMemorySettingsManager,
        noExtensions: true,
        noContextFiles: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
      });
      expect(mockResourceLoaderOptions[0]?.systemPrompt).toBe("");
      expect(mockResourceLoaderOptions[0]?.appendSystemPrompt).toEqual([]);
      expect(mockResourceLoaderOptions[0]?.systemPromptOverride("ambient path source")).toBe("You are a helpful assistant.");
      expect(mockResourceLoaderOptions[0]?.appendSystemPromptOverride(["ambient path source"])).toEqual([
        "relative/path/to/host-prompt.md",
      ]);
      expect(mockResourceLoaderOptions[0]).not.toHaveProperty("additionalExtensionPaths");
      expect(mockResourceLoaderOptions[0]).not.toHaveProperty("additionalSkillPaths");
      const resourceLoader = mockCreateAgentSessionConfigs[0]?.resourceLoader;
      expect(resourceLoader.getSystemPrompt()).toBe("You are a helpful assistant.");
      expect(resourceLoader.getAppendSystemPrompt()).toEqual(["relative/path/to/host-prompt.md"]);
      expect(resourceLoader.getSkills()).toEqual({ skills: [], diagnostics: [] });
      expect(resourceLoader.getPrompts()).toEqual({ prompts: [], diagnostics: [] });
      expect(resourceLoader.getThemes()).toEqual({ themes: [], diagnostics: [] });
      expect(resourceLoader.getAgentsFiles()).toEqual({ agentsFiles: [] });
      expect(resourceLoader.getExtensions().errors).toEqual([]);
      expect(mockResourceLoaderOptions[0]?.extensionFactories.length).toBeGreaterThan(0);
      expect(JSON.stringify({
        createAgentSession: mockCreateAgentSessionConfigs[0],
      })).not.toContain(process.cwd());
    } finally {
      await bridge.agent.dispose();
      await rm(sessionRoot, { recursive: true, force: true });
    }
  });

  it("does not evaluate path-based Pi resources in headless mode", async () => {
    const getHotReloadableResources = vi.fn(() => ({
      additionalSkillPaths: ["/host/hot-skill"],
      extensionPaths: ["/host/hot-extension.ts"],
      packages: ["host-hot-package"],
    }));
    const harness = createPiCodingAgentHarness({
      tools: [],
      cwd: "/sealed/headless",
      runtimeCwd: "/sealed/headless",
      sessionDir: "/sealed/sessions",
      pi: withPurePiHarnessDefaults({
        additionalSkillPaths: ["/host/static-skill"],
        extensionPaths: ["/host/static-extension.ts"],
        packages: ["host-static-package"],
        getHotReloadableResources,
      }),
    });

    await harness.getPiSessionAdapter({ sessionId: "pure-resource-seal", content: "" }, {
      abortSignal: new AbortController().signal,
      workdir: process.cwd(),
    });

    expect(getHotReloadableResources).not.toHaveBeenCalled();
    expect(mockCreateAgentSessionConfigs[0]?.settingsManager).toBe(mockInMemorySettingsManager);
    expect(mockSettingsManagerCreate).not.toHaveBeenCalled();
    expect(mockGetAgentDir).not.toHaveBeenCalled();
    expect(mockResourceLoaderOptions[0]).not.toHaveProperty("additionalExtensionPaths");
    expect(mockResourceLoaderOptions[0]).not.toHaveProperty("additionalSkillPaths");
    expect(JSON.stringify(mockResourceLoaderOptions[0])).not.toContain("/host/");
  });

  it("snapshots the pure-mode system prompt seal", async () => {
    const sessionRoot = await mkdtemp(join(tmpdir(), "boring-pure-prompt-seal-"));
    const sealedCwd = join(sessionRoot, ".runtime-none");
    const bridge = createAgentRuntimeBridge({
      runtime: "none",
      sessionStorageRoot: sessionRoot,
    });
    try {
      const runtime = await bridge.getRuntime();
      const harness = runtime.harness as AgentCoreHarness;
      const adapter = await harness.getPiSessionAdapter({ sessionId: "pure-prompt", content: "" }, {
        abortSignal: new AbortController().signal,
        workdir: process.cwd(),
      });

      const prompt = adapter.prompt("hello");
      await resolveMockPrompt(prompt);

      const systemPrompt = harness.getSystemPrompt?.("pure-prompt") ?? "";
      expect(systemPrompt).toMatchInlineSnapshot(`
        "You are a helpful assistant.
        Current date: 2026-05-20"
      `);
      expect(systemPrompt).not.toContain(process.cwd());
      expect(systemPrompt).not.toContain(sealedCwd);
      expect(systemPrompt).not.toContain("Current working directory:");
      expect(systemPrompt).not.toContain("Workspace paths");
      expect(systemPrompt).not.toContain("AGENTS.md");
      expect(systemPrompt).not.toContain("SYSTEM.md");
      expect(systemPrompt).not.toContain("APPEND_SYSTEM.md");
      expect(systemPrompt).not.toContain("read/edit/write");
      expect(systemPrompt).not.toContain("find/grep/ls");
      expect(systemPrompt).not.toContain("uv pip install");
    } finally {
      await bridge.agent.dispose();
      await rm(sessionRoot, { recursive: true, force: true });
    }
  });
});

async function resolveMockPrompt(prompt: Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 10 && !promptHandle.resolve; attempt += 1) {
    await Promise.resolve();
  }
  promptHandle.resolve?.();
  await prompt;
}
