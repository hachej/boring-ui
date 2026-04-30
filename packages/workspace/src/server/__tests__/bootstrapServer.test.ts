import { describe, it, expect, vi } from "vitest"
import { bootstrapServer } from "../plugins/bootstrapServer"

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
      agentTools: [],
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
})
