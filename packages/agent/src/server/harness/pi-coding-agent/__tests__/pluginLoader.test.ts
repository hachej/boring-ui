import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadPlugins,
  flattenPluginTools,
  extractTools,
  validateTool,
  type ImportFn,
} from "../pluginLoader.js";
import type { AgentTool } from "../../../../shared/tool.js";

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: name }] }),
  };
}

function mockImportFn(
  modules: Record<string, Record<string, unknown>>,
): ImportFn {
  return async (url: string) => {
    for (const [pattern, mod] of Object.entries(modules)) {
      if (url.includes(pattern)) return mod;
    }
    throw new Error(`Module not found: ${url}`);
  };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "plugin-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("validateTool", () => {
  it("accepts valid tool", () => {
    const tool = validateTool(makeTool("test"));
    expect(tool).not.toBeNull();
    expect(tool!.name).toBe("test");
  });

  it("rejects null", () => {
    expect(validateTool(null)).toBeNull();
  });

  it("rejects missing name", () => {
    expect(
      validateTool({
        description: "x",
        parameters: {},
        execute: async () => ({}),
      }),
    ).toBeNull();
  });

  it("rejects missing execute", () => {
    expect(
      validateTool({ name: "x", description: "x", parameters: {} }),
    ).toBeNull();
  });

  it("rejects missing parameters", () => {
    expect(
      validateTool({ name: "x", description: "x", execute: async () => ({}) }),
    ).toBeNull();
  });
});

describe("extractTools", () => {
  it("extracts default export single tool", () => {
    const tools = extractTools({ default: makeTool("single") });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("single");
  });

  it("extracts default export array", () => {
    const tools = extractTools({
      default: [makeTool("a"), makeTool("b")],
    });
    expect(tools).toHaveLength(2);
  });

  it("extracts named tools export", () => {
    const tools = extractTools({
      tools: [makeTool("named")],
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("named");
  });

  it("skips invalid items in array", () => {
    const tools = extractTools({
      default: [makeTool("valid"), { bad: true }],
    });
    expect(tools).toHaveLength(1);
  });

  it("returns empty for module with no tools", () => {
    const tools = extractTools({ someHelper: () => {} });
    expect(tools).toHaveLength(0);
  });
});

describe("loadPlugins", () => {
  it("returns empty when no extension dirs exist", async () => {
    const result = await loadPlugins({ cwd: tempDir, skipGlobal: true });
    expect(result.plugins).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("discovers local extensions from .pi/extensions/", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "hello.mjs"), "");

    const importFn = mockImportFn({
      "hello.mjs": { default: makeTool("hello_world") },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].source).toBe("local");
    expect(result.plugins[0].tools[0].name).toBe("hello_world");
  });

  it("loads multiple tools from named export", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "multi.mjs"), "");

    const importFn = mockImportFn({
      "multi.mjs": { tools: [makeTool("tool_a"), makeTool("tool_b")] },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins[0].tools).toHaveLength(2);
    expect(result.plugins[0].tools[0].name).toBe("tool_a");
    expect(result.plugins[0].tools[1].name).toBe("tool_b");
  });

  it("skips files without valid extensions", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "readme.md"), "# Not a plugin");
    await writeFile(join(extDir, "data.json"), "{}");

    const result = await loadPlugins({ cwd: tempDir, skipGlobal: true });
    expect(result.plugins).toEqual([]);
  });

  it("records errors for failing imports", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "bad.mjs"), "");

    const importFn: ImportFn = async () => {
      throw new Error("broken module");
    };

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("broken module");
  });

  it("skips exports missing required fields", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "incomplete.mjs"), "");

    const importFn = mockImportFn({
      "incomplete.mjs": { default: { name: "no_exec", description: "x" } },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins).toEqual([]);
  });

  it("discovers npm pi-plugin-* packages", async () => {
    const pkgDir = join(tempDir, "node_modules", "pi-plugin-test");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "pi-plugin-test", main: "index.mjs" }),
    );

    const importFn = mockImportFn({
      "index.mjs": { default: makeTool("npm_tool") },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].source).toBe("npm");
    expect(result.plugins[0].tools[0].name).toBe("npm_tool");
  });

  it("reads extensions.json for additional npm packages", async () => {
    const piDir = join(tempDir, ".pi");
    await mkdir(piDir, { recursive: true });
    await writeFile(
      join(piDir, "extensions.json"),
      JSON.stringify({ npm: ["custom-agent-plugin"] }),
    );

    const pkgDir = join(tempDir, "node_modules", "custom-agent-plugin");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "custom-agent-plugin", main: "index.mjs" }),
    );

    const importFn = mockImportFn({
      "index.mjs": { default: makeTool("custom_tool") },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].tools[0].name).toBe("custom_tool");
  });

  it("reports git URLs as unsupported", async () => {
    const piDir = join(tempDir, ".pi");
    await mkdir(piDir, { recursive: true });
    await writeFile(
      join(piDir, "extensions.json"),
      JSON.stringify({ git: ["https://github.com/org/plugin.git"] }),
    );

    const result = await loadPlugins({ cwd: tempDir, skipGlobal: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("not yet supported");
  });

  it("flattenPluginTools merges all tools", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "a.mjs"), "");
    await writeFile(join(extDir, "b.mjs"), "");

    const importFn = mockImportFn({
      "a.mjs": { default: makeTool("tool_a") },
      "b.mjs": { default: makeTool("tool_b") },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    const tools = flattenPluginTools(result);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["tool_a", "tool_b"]);
  });

  it("loaded tools are executable", async () => {
    const extDir = join(tempDir, ".pi", "extensions");
    await mkdir(extDir, { recursive: true });
    await writeFile(join(extDir, "exec.mjs"), "");

    const importFn = mockImportFn({
      "exec.mjs": { default: makeTool("exec_test") },
    });

    const result = await loadPlugins({
      cwd: tempDir,
      skipGlobal: true,
      importFn,
    });
    const tools = flattenPluginTools(result);
    expect(tools).toHaveLength(1);

    const output = await tools[0].execute(
      {},
      { abortSignal: new AbortController().signal, toolCallId: "test-1" },
    );
    expect(output.content[0].text).toBe("exec_test");
  });
});
