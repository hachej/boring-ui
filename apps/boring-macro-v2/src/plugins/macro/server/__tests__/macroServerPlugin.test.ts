import { existsSync } from "node:fs"
import { describe, it, expect, vi } from "vitest"
import { makeMacroServerPlugin, createMacroServerPlugin } from "../index"
import type { MacroConfig } from "../config"

// Mock the workspace server entrypoint to avoid pulling in @boring/agent/server
vi.mock("@boring/workspace/app/server", () => ({
  defineServerPlugin: vi.fn((plugin: unknown) => ({ ...plugin as object })),
}))


vi.mock("../config", () => ({
  loadMacroConfig: vi.fn().mockResolvedValue({
    clickhouse: null,
    authRedirectOnRoot: false,
    devAutoSession: true,
    deckRoot: "/tmp",
  }),
}))

vi.mock("../routes/macro", () => ({
  registerMacroRoutes: vi.fn(),
}))

describe("makeMacroServerPlugin", () => {
  const macroConfig: MacroConfig = {
    clickhouse: null,
    authRedirectOnRoot: false,
    devAutoSession: true,
    deckRoot: "/tmp",
  }
  const plugin = makeMacroServerPlugin(macroConfig)

  it("has id 'boring-macro'", () => {
    expect(plugin.id).toBe("boring-macro")
  })

  it("has label 'Macro'", () => {
    expect(plugin.label).toBe("Macro")
  })

  it("has extensionPaths with the native pi entrypoint — no agentTools", () => {
    expect(plugin.extensionPaths).toHaveLength(1)
    expect(plugin.extensionPaths?.[0]).toMatch(/macro\/agent\/index\.ts$/)
    expect(existsSync(plugin.extensionPaths![0])).toBe(true)
  })

  it("has no agentTools (pi tools replace legacy adapter)", () => {
    expect(plugin.agentTools).toBeUndefined()
  })

  it("has no systemPrompt (pi skills/prompts replace system prompt)", () => {
    expect(plugin.systemPrompt).toBeUndefined()
  })

  it("provisioning uses root sdk and server/template, not legacy agent/sdk or skill template", () => {
    const template = plugin.provisioning?.templateDirs?.[0]
    const python = plugin.provisioning?.python?.[0]
    expect(template?.id).toBe("macro-template")
    expect(String(template?.path)).toMatch(/macro\/server\/template\/?$/)
    expect(String(template?.path)).not.toContain(".agents/skills")
    expect(python?.id).toBe("macro-sdk")
    expect(String(python?.projectFile)).toMatch(/macro\/sdk\/pyproject\.toml$/)
    expect(String(python?.projectFile)).not.toContain("agent/sdk")
  })

  it("routes is a function", () => {
    expect(typeof plugin.routes).toBe("function")
  })
})


describe("createMacroServerPlugin", () => {
  it("resolves with the same plugin shape (id, extensionPaths present)", async () => {
    const plugin = await createMacroServerPlugin()
    expect(plugin.id).toBe("boring-macro")
    expect(plugin.extensionPaths).toHaveLength(1)
  })
})
