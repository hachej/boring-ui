import { describe, it, expect } from "vitest"
import { loadEnv, loadEnvSafe } from "../loadEnv.js"

describe("loadEnv", () => {
  it("parses valid env vars", () => {
    const result = loadEnv({
      ANTHROPIC_API_KEY: "sk-test-key",
      BORING_AGENT_MODE: "direct",
      BORING_AGENT_PORT: "4000",
    })
    expect(result.ANTHROPIC_API_KEY).toBe("sk-test-key")
    expect(result.BORING_AGENT_MODE).toBe("direct")
    expect(result.BORING_AGENT_PORT).toBe(4000)
  })

  it("throws on missing ANTHROPIC_API_KEY", () => {
    expect(() => loadEnv({})).toThrow()
  })

  it("ignores unknown env vars", () => {
    const result = loadEnv({
      ANTHROPIC_API_KEY: "sk-test",
      RANDOM_VAR: "should-be-ignored",
      PATH: "/usr/bin",
    })
    expect(result.ANTHROPIC_API_KEY).toBe("sk-test")
    expect((result as any).RANDOM_VAR).toBeUndefined()
    expect((result as any).PATH).toBeUndefined()
  })
})

describe("loadEnvSafe", () => {
  it("returns success for valid env", () => {
    const result = loadEnvSafe({ ANTHROPIC_API_KEY: "sk-test" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ANTHROPIC_API_KEY).toBe("sk-test")
    }
  })

  it("returns error for invalid env", () => {
    const result = loadEnvSafe({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })

  it("returns error for invalid mode", () => {
    const result = loadEnvSafe({
      ANTHROPIC_API_KEY: "sk-test",
      BORING_AGENT_MODE: "invalid",
    })
    expect(result.success).toBe(false)
  })
})
