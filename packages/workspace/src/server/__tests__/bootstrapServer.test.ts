import { describe, it, expect, vi } from "vitest"
import {
  ServerPluginError,
  bootstrapServer,
  defineServerPlugin,
} from "../plugins/bootstrapServer"

function makeAgentTool(name = "tool") {
  return {
    name,
    description: "Tool",
    parameters: { type: "object" as const, properties: {} },
    execute: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] })),
  }
}

describe("bootstrapServer", () => {
  it("returns empty results when no plugins or defaults", () => {
    const result = bootstrapServer({})
    expect(result).toEqual({
      registered: [],
      systemPromptAppend: "",
      piPackages: [],
      extensionPaths: [],
      agentTools: [],
      provisioningContributions: [],
      routeContributions: [],
      preservedUiStateKeys: [],
    })
  })

  it("collects agentTools from plugins", () => {
    const tool = makeAgentTool("execute_sql")
    const result = bootstrapServer({
      plugins: [{ id: "macro", agentTools: [tool] }],
    })

    expect(result.registered).toEqual(["macro"])
    expect(result.agentTools).toHaveLength(1)
    expect(result.agentTools[0].name).toBe("execute_sql")
  })

  it("collects agentTools from defaults AND plugins in order", () => {
    const defaultTool = makeAgentTool("default_tool")
    const pluginTool = makeAgentTool("plugin_tool")
    const result = bootstrapServer({
      defaults: [{ id: "default", agentTools: [defaultTool] }],
      plugins: [{ id: "plugin", agentTools: [pluginTool] }],
    })

    expect(result.registered).toEqual(["default", "plugin"])
    expect(result.agentTools.map((t) => t.name)).toEqual(["default_tool", "plugin_tool"])
  })

  it("excludeDefaults removes default plugins", () => {
    const tool = makeAgentTool("default_tool")
    const result = bootstrapServer({
      defaults: [{ id: "filesystem", agentTools: [tool] }],
      excludeDefaults: ["filesystem"],
    })

    expect(result.registered).toEqual([])
    expect(result.agentTools).toHaveLength(0)
  })

  it("excludeDefaults does not affect user plugins", () => {
    const tool = makeAgentTool("plugin_tool")
    const result = bootstrapServer({
      plugins: [{ id: "macro", agentTools: [tool] }],
      excludeDefaults: ["filesystem"],
    })

    expect(result.registered).toEqual(["macro"])
    expect(result.agentTools).toHaveLength(1)
  })

  it("throws on duplicate plugin ids", () => {
    expect(() =>
      bootstrapServer({
        plugins: [{ id: "dupe" }, { id: "dupe" }],
      }),
    ).toThrow('plugin "dupe" registered twice')
  })

  it("concatenates systemPrompt from all plugins", () => {
    const result = bootstrapServer({
      plugins: [
        { id: "a", systemPrompt: "  Plugin A context  " },
        { id: "b", systemPrompt: "Plugin B context" },
      ],
    })

    expect(result.systemPromptAppend).toBe("Plugin A context\n\nPlugin B context")
  })

  it("keeps skill-style plugin instructions alongside plugin tools", () => {
    const tool = makeAgentTool("macro_search")
    const result = bootstrapServer({
      plugins: [
        {
          id: "macro",
          systemPrompt: "## Macro skill\nUse macro_search before answering data questions.",
          agentTools: [tool],
        },
      ],
    })

    expect(result.agentTools.map((t) => t.name)).toEqual(["macro_search"])
    expect(result.systemPromptAppend).toContain("## Macro skill")
    expect(result.systemPromptAppend).toContain("macro_search")
  })

  it("skips empty/whitespace systemPrompt", () => {
    const result = bootstrapServer({
      plugins: [
        { id: "a", systemPrompt: "Context" },
        { id: "b", systemPrompt: "   " },
        { id: "c" },
      ],
    })

    expect(result.systemPromptAppend).toBe("Context")
  })

  it("plugins without agentTools contribute no tools", () => {
    const result = bootstrapServer({
      plugins: [{ id: "ui-only" }],
    })

    expect(result.agentTools).toHaveLength(0)
    expect(result.registered).toEqual(["ui-only"])
  })

  it("collects route contributions from plugins", () => {
    const routes = vi.fn()
    const result = bootstrapServer({
      plugins: [{ id: "routes", routes }],
    })

    expect(result.routeContributions).toEqual([{ id: "routes", routes }])
  })

  it("collects plugin-owned preserved UI state keys", () => {
    const result = bootstrapServer({
      defaults: [{ id: "questions", preservedUiStateKeys: ["questions.pending"] }],
      plugins: [{ id: "other", preservedUiStateKeys: ["questions.pending", "other.state"] }],
    })

    expect(result.preservedUiStateKeys).toEqual(["questions.pending", "other.state"])
  })

  it("collects native Pi package declarations from plugins", () => {
    const result = bootstrapServer({
      defaults: [{ id: "preview", piPackages: ["npm:pi-markdown-preview@0.9.7"] }],
      plugins: [
        {
          id: "custom-preview",
          piPackages: [
            {
              source: "npm:pi-markdown-preview@0.9.7",
              extensions: ["./index.ts"],
            },
          ],
        },
      ],
    })

    expect(result.piPackages).toEqual([
      "npm:pi-markdown-preview@0.9.7",
      {
        source: "npm:pi-markdown-preview@0.9.7",
        extensions: ["./index.ts"],
      },
    ])
  })

  it("dedupes exact Pi package declarations while preserving filtered variants", () => {
    const filtered = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./index.ts"],
    }
    const result = bootstrapServer({
      plugins: [
        { id: "a", piPackages: ["npm:pi-markdown-preview@0.9.7", filtered] },
        { id: "b", piPackages: ["npm:pi-markdown-preview@0.9.7", filtered] },
      ],
    })

    expect(result.piPackages).toEqual([
      "npm:pi-markdown-preview@0.9.7",
      filtered,
    ])
  })

  it("dedupes Pi package filters independent of declaration order", () => {
    const first = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./preview.ts", "./index.ts"],
    }
    const second = {
      source: "npm:pi-markdown-preview@0.9.7",
      extensions: ["./index.ts", "./preview.ts"],
    }
    const result = bootstrapServer({
      plugins: [
        { id: "a", piPackages: [first] },
        { id: "b", piPackages: [second] },
      ],
    })

    expect(result.piPackages).toEqual([first])
  })

  it("defineServerPlugin preserves the standard server plugin shape", () => {
    const spec = {
      id: "standard",
      label: "Standard",
      systemPrompt: "Prompt",
    }
    const plugin = defineServerPlugin(spec)

    expect(plugin).toEqual(spec)
    expect(plugin).not.toBe(spec)
  })

  it("defineServerPlugin rejects invalid ids", () => {
    expect(() =>
      defineServerPlugin({ id: "" }),
    ).toThrow(ServerPluginError)
    expect(() =>
      defineServerPlugin({ id: "" }),
    ).toThrow("id must be a non-empty string")
  })

  it("defineServerPlugin rejects malformed tools", () => {
    expect(() =>
      defineServerPlugin({
        id: "bad-tools",
        agentTools: [{ name: "missing-execute", description: "bad", parameters: {} } as any],
      }),
    ).toThrow("agentTools[0].execute must be a function")
  })

  it("defineServerPlugin rejects malformed routes", () => {
    expect(() =>
      defineServerPlugin({
        id: "bad-routes",
        routes: "not-a-function" as any,
      }),
    ).toThrow("routes must be a Fastify plugin function")
  })

  it("defineServerPlugin rejects malformed preserved UI state keys", () => {
    expect(() =>
      defineServerPlugin({
        id: "bad-state-keys",
        preservedUiStateKeys: [""] as any,
      }),
    ).toThrow("preservedUiStateKeys must be a non-empty string array")
  })

  it("defineServerPlugin rejects malformed Pi package declarations", () => {
    expect(() =>
      defineServerPlugin({
        id: "bad-pi-package",
        piPackages: [""],
      }),
    ).toThrow("piPackages[0] must be a non-empty string")

    expect(() =>
      defineServerPlugin({
        id: "bad-pi-package-object",
        piPackages: [{ source: "", extensions: ["./index.ts"] }],
      }),
    ).toThrow("piPackages[0].source must be a non-empty string")

    expect(() =>
      defineServerPlugin({
        id: "bad-pi-package-filter",
        piPackages: [{ source: "npm:example", extensions: [""] }],
      }),
    ).toThrow("piPackages[0].extensions must be a string array when provided")
  })

  it("defineServerPlugin rejects malformed provisioning", () => {
    expect(() =>
      defineServerPlugin({
        id: "bad-provisioning",
        provisioning: {
          templateDirs: [{ id: "missing-path" } as any],
        },
      }),
    ).toThrow("provisioning.templateDirs[0].path must be a string or URL")

    expect(() =>
      defineServerPlugin({
        id: "empty-template-path",
        provisioning: {
          templateDirs: [{ id: "template", path: "" }],
        },
      }),
    ).toThrow("provisioning.templateDirs[0].path must be a string or URL")

    expect(() =>
      defineServerPlugin({
        id: "empty-python-project",
        provisioning: {
          python: [{ id: "sdk", projectFile: "" }],
        },
      }),
    ).toThrow("provisioning.python[0].projectFile must be a string or URL")

    expect(() =>
      defineServerPlugin({
        id: "empty-node-package-root",
        provisioning: {
          nodePackages: [{ id: "workspace", packageName: "@boring/workspace", packageRoot: "" }],
        },
      }),
    ).toThrow("provisioning.nodePackages[0].packageRoot must be a string or URL")
  })

  it("defineServerPlugin accepts valid route and provisioning contributions", () => {
    const routes = vi.fn()
    const plugin = defineServerPlugin({
      id: "runtime",
      routes,
      provisioning: {
        templateDirs: [
          { id: "template", path: new URL("file:///tmp/template/"), target: "." },
        ],
        python: [
          {
            id: "sdk",
            projectFile: new URL("file:///tmp/sdk/pyproject.toml"),
            extraLibs: ["./libs/example"],
            env: { EXAMPLE_ROOT: new URL("file:///tmp/sdk") },
          },
        ],
        nodePackages: [
          {
            id: "workspace",
            packageName: "@boring/workspace",
            packageRoot: new URL("file:///tmp/workspace/"),
          },
        ],
      },
    })

    expect(plugin.routes).toBe(routes)
    expect(plugin.provisioning?.templateDirs).toHaveLength(1)
    expect(plugin.provisioning?.nodePackages).toHaveLength(1)
  })

  describe("extensionPaths", () => {
    it("defaults to empty array when no plugins", () => {
      const result = bootstrapServer({})
      expect(result.extensionPaths).toEqual([])
    })

    it("collects extensionPaths from plugins", () => {
      const result = bootstrapServer({
        plugins: [{ id: "ext-plugin", extensionPaths: ["/plugins/ext/agent/index.ts"] }],
      })
      expect(result.extensionPaths).toEqual(["/plugins/ext/agent/index.ts"])
    })

    it("collects extensionPaths from multiple plugins in order", () => {
      const result = bootstrapServer({
        plugins: [
          { id: "plugin-a", extensionPaths: ["/plugins/a/agent/index.ts"] },
          { id: "plugin-b", extensionPaths: ["/plugins/b/agent/index.ts"] },
        ],
      })
      expect(result.extensionPaths).toEqual([
        "/plugins/a/agent/index.ts",
        "/plugins/b/agent/index.ts",
      ])
    })
  })

})
