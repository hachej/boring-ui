import { describe, expect, it } from "vitest"
import { createPlaygroundDataServerPlugin } from "../index"

describe("playground data server plugin", () => {
  it("contributes the current WorkspaceServerPlugin tool and prompt shape", () => {
    const plugin = createPlaygroundDataServerPlugin({ workspaceRoot: "/tmp/workspace" })

    expect(plugin.id).toBe("playground-data-catalog")
    expect(plugin.systemPrompt).toContain("## Playground Data Catalog")
    expect(plugin.systemPrompt).toContain("execute_sql")
    expect(plugin.agentTools).toHaveLength(1)
    expect(plugin.agentTools?.[0]).toMatchObject({
      name: "execute_sql",
      description: expect.stringContaining("DuckDB"),
      parameters: {
        type: "object",
        required: ["query"],
      },
    })
    expect(plugin.agentTools?.[0]?.execute).toEqual(expect.any(Function))
  })
})
