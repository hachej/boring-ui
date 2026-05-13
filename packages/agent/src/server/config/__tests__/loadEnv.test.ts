import { describe, it, expect } from "vitest"
import { loadEnv, loadEnvSafe } from "../loadEnv.js"

describe("loadEnv", () => {
  it("parses valid env vars", () => {
    const result = loadEnv({
      BORING_AGENT_MODE: "direct",
      BORING_AGENT_PORT: "4000",
    })
    expect(result.BORING_AGENT_MODE).toBe("direct")
    expect(result.BORING_AGENT_PORT).toBe(4000)
  })

  it("allows empty env because provider credentials are owned by Pi", () => {
    expect(loadEnv({})).toEqual({})
  })

  it("ignores unknown env vars", () => {
    const result = loadEnv({
      ANTHROPIC_API_KEY: "sk-test",
      RANDOM_VAR: "should-be-ignored",
      PATH: "/usr/bin",
    })
    expect((result as any).ANTHROPIC_API_KEY).toBeUndefined()
    expect((result as any).RANDOM_VAR).toBeUndefined()
    expect((result as any).PATH).toBeUndefined()
  })
})

describe("loadEnvSafe", () => {
  it("returns success for empty env", () => {
    const result = loadEnvSafe({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({})
    }
  })

  it("returns error for invalid env", () => {
    const result = loadEnvSafe({ BORING_AGENT_PORT: "not-a-number" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0)
    }
  })

  it("returns error for invalid mode", () => {
    const result = loadEnvSafe({
      BORING_AGENT_MODE: "invalid",
    })
    expect(result.success).toBe(false)
  })
})
