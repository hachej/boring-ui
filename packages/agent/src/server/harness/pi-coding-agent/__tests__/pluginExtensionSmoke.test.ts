import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  mockCreateAgentSession,
  mockAbort,
  mockDispose,
  capturedToolOutputs,
} = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
  mockAbort: vi.fn().mockResolvedValue(undefined),
  mockDispose: vi.fn(),
  capturedToolOutputs: [] as string[],
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
  const actual = await vi.importActual("@mariozechner/pi-coding-agent");
  return {
    ...actual,
    createAgentSession: mockCreateAgentSession,
    SessionManager: { inMemory: () => ({}) },
    AuthStorage: {
      inMemory: () => ({}),
      create: () => ({}),
    },
    ModelRegistry: {
      inMemory: () => ({ find: () => undefined }),
      create: () => ({ find: () => undefined }),
    },
  };
});

import { loadPlugins, flattenPluginTools } from "../pluginLoader.js";
import { createPiCodingAgentHarness } from "../createHarness.js";

describe("Plugin extension smoke test", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedToolOutputs.length = 0;

    tempDir = await mkdtemp(
      join(process.cwd(), ".vitest-plugin-extension-smoke-"),
    );
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });

    const fixturePath = fileURLToPath(
      new URL("./fixtures/extensions/hello-world.mjs", import.meta.url),
    );
    await copyFile(fixturePath, join(extDir, "hello-world.mjs"));

    mockCreateAgentSession.mockImplementation(async (opts: any) => {
      const subscribers: Array<(event: any) => void> = [];

      return {
        session: {
          subscribe(listener: (event: any) => void) {
            subscribers.push(listener);
            return () => {
              const idx = subscribers.indexOf(listener);
              if (idx >= 0) subscribers.splice(idx, 1);
            };
          },
          prompt: async () => {
            const helloTool = opts.customTools.find(
              (tool: { name: string }) => tool.name === "hello_world",
            );
            if (helloTool) {
              const toolResult = await helloTool.execute(
                "tool-call-1",
                { name: "Ada" },
                new AbortController().signal,
                undefined,
                {},
              );
              const text = toolResult?.content?.[0]?.text;
              capturedToolOutputs.push(typeof text === "string" ? text : "");
            }

            for (const emit of subscribers) {
              emit({ type: "message_start" });
              emit({
                type: "message_update",
                assistantMessageEvent: {
                  type: "text_delta",
                  contentIndex: 0,
                  delta: "plugin smoke pass",
                },
              });
              emit({
                type: "message_update",
                assistantMessageEvent: {
                  type: "done",
                  message: { usage: { input: 1, output: 1, cost: { total: 0 } } },
                },
              });
              emit({ type: "message_end" });
              emit({ type: "agent_end", messages: [] });
            }
          },
          abort: mockAbort,
          dispose: mockDispose,
        },
      };
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads synthetic extension and makes its tool callable in harness customTools", async () => {
    const pluginResult = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
    });

    expect(pluginResult.errors).toEqual([]);
    expect(pluginResult.plugins).toHaveLength(1);
    expect(pluginResult.plugins[0].source).toBe("local");

    const tools = flattenPluginTools(pluginResult);
    expect(tools.map((tool) => tool.name)).toEqual(["hello_world"]);

    const harness = createPiCodingAgentHarness({
      tools,
      cwd: tempDir,
    });

    const chunks: unknown[] = [];
    for await (const chunk of harness.sendMessage(
      { sessionId: "session-smoke", message: "run hello tool" },
      { workdir: tempDir, abortSignal: new AbortController().signal },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateAgentSession.mock.calls[0]?.[0] as {
      customTools?: Array<{ name: string }>;
    };
    expect(createArgs.customTools?.map((tool) => tool.name)).toContain("hello_world");
    expect(capturedToolOutputs).toContain("Hello, Ada! (from synthetic extension)");
  });
});
