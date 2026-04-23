import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const {
  mockCreateAgentSession,
  mockAbort,
  mockDispose,
} = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
  mockAbort: vi.fn().mockResolvedValue(undefined),
  mockDispose: vi.fn(),
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

import { loadPlugins, flattenPluginTools, type ImportFn } from "../pluginLoader.js";
import { createPiCodingAgentHarness } from "../createHarness.js";

describe("Plugin extension smoke test", () => {
  let tempDir: string;
  const importFromFileUrl: ImportFn = async (url: string) => {
    const source = await readFile(fileURLToPath(url), "utf-8");
    const encoded = Buffer.from(source, "utf-8").toString("base64");
    return import(`data:text/javascript;base64,${encoded}`) as Promise<Record<string, unknown>>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    tempDir = await mkdtemp(join(tmpdir(), "plugin-extension-smoke-"));
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
      importFn: importFromFileUrl,
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

    const chunkTypes = chunks
      .filter(
        (chunk): chunk is { type: string } =>
          typeof chunk === "object" && chunk !== null && "type" in chunk,
      )
      .map((chunk) => chunk.type);
    expect(chunkTypes).toContain("start");
    expect(chunkTypes).toContain("finish");

    expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateAgentSession.mock.calls[0]?.[0] as {
      customTools?: Array<{
        name: string;
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal?: AbortSignal,
          onUpdate?: ((partial: string) => void) | undefined,
          ctx?: unknown,
        ) => Promise<{ content: Array<{ type: string; text: string }> }>;
      }>;
    };
    expect(createArgs.customTools?.map((tool) => tool.name)).toContain(
      "hello_world",
    );
    const helloTool = createArgs.customTools?.find(
      (tool) => tool.name === "hello_world",
    );
    expect(helloTool).toBeDefined();
    const toolResult = await helloTool!.execute(
      "tool-call-1",
      { name: "Ada" },
      new AbortController().signal,
      undefined,
      {},
    );
    expect(toolResult.content[0]?.text).toBe(
      "Hello, Ada! (from synthetic extension)",
    );
  });
});
