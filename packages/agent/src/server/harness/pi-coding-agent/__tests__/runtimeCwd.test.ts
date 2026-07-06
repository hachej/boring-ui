import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSubscribers,
  promptHandle,
  mockCurrentModel,
  mockSetModel,
  mockSetThinkingLevel,
  mockFindModel,
  mockCreateAgentSessionConfigs,
  mockSessionManagerCreate,
  mockSessionManagerOpen,
  mockResourceLoaderOptions,
} = vi.hoisted(() => ({
  mockSubscribers: [] as Array<(event: any) => void>,
  promptHandle: { resolve: undefined as undefined | (() => void) },
  mockCreateAgentSessionConfigs: [] as any[],
  mockSessionManagerCreate: vi.fn(() => ({ getSessionFile: () => null })),
  mockSessionManagerOpen: vi.fn(() => ({ getSessionFile: () => null })),
  mockResourceLoaderOptions: [] as any[],
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
        prompt: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              promptHandle.resolve = resolve;
            }),
        ),
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
          const append = config.resourceLoader?.getAppendSystemPrompt?.().join("\n\n");
          return [
            "You are a fake test agent.",
            append,
            "Current date: 2026-05-20",
            `Current working directory: ${config.cwd}`,
          ].filter(Boolean).join("\n");
        },
      },
    };
  }),
  SessionManager: { inMemory: () => ({}), create: mockSessionManagerCreate, open: mockSessionManagerOpen },
  AuthStorage: { inMemory: () => ({}), create: () => ({}) },
  // createHarness always builds a DefaultResourceLoader now so it can inject
  // the workspace-paths system-prompt guideline. Stub the lookups it needs.
  getAgentDir: () => "/tmp/test-agent-dir",
  DefaultResourceLoader: class {
    private opts: any;
    constructor(opts: unknown) {
      this.opts = opts;
      mockResourceLoaderOptions.push(opts);
    }
    async reload() { /* no-op */ }
    getAppendSystemPrompt() {
      return this.opts.appendSystemPromptOverride?.([]) ?? [];
    }
  },
  SettingsManager: {
    create: () => ({
      getResolvedSettings: () => ({}),
      loadAllSettings: vi.fn(),
    }),
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

import { createPiCodingAgentHarness } from "../createHarness.js";
import type { RunContext } from "../../../../shared/harness.js";

function emitPiEvent(event: any): void {
  for (const sub of mockSubscribers) sub(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubscribers.length = 0;
  mockCreateAgentSessionConfigs.length = 0;
  mockResourceLoaderOptions.length = 0;
  promptHandle.resolve = undefined;
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
});
