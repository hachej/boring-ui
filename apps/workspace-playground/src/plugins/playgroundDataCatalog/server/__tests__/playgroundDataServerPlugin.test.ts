import { describe, expect, it, vi } from "vitest"
import {
  createPlaygroundDataPiExtension,
  createPlaygroundDataServerPlugin,
} from "../index"

describe("playground data server plugin", () => {
  it("contributes a pi-native extension factory instead of legacy agentTools/systemPrompt", () => {
    const plugin = createPlaygroundDataServerPlugin({ workspaceRoot: "/tmp/workspace" })

    expect(plugin.id).toBe("playground-data-catalog")
    expect(plugin.agentTools).toBeUndefined()
    expect(plugin.systemPrompt).toBeUndefined()
    expect(plugin.extensionFactories).toHaveLength(1)
  })

  it("registers execute_sql and appends playground catalog guidance", async () => {
    const tools: Array<{ name: string; parameters: unknown }> = []
    const handlers = new Map<string, (event: { systemPrompt: string }) => unknown>()
    const api = {
      registerTool: vi.fn((tool: { name: string; parameters: unknown }) => tools.push(tool)),
      on: vi.fn((event: string, handler: (event: { systemPrompt: string }) => unknown) => {
        handlers.set(event, handler)
      }),
    }

    await createPlaygroundDataPiExtension("/tmp/workspace")(api)

    expect(api.registerTool).toHaveBeenCalledTimes(1)
    expect(tools[0]).toMatchObject({ name: "execute_sql" })
    expect(tools[0]?.parameters).toMatchObject({
      type: "object",
      required: ["query"],
    })
    expect(api.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function))
    expect(handlers.get("before_agent_start")?.({ systemPrompt: "Base" })).toMatchObject({
      systemPrompt: expect.stringContaining("## Playground Data Catalog"),
    })
  })
})
