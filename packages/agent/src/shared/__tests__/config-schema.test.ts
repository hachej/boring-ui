import { describe, it, expect } from "vitest"
import {
  ConfigSchema,
  EnvSchema,
  RuntimeModeSchema,
  validateConfig,
} from "../config-schema"

describe("RuntimeModeSchema", () => {
  it("accepts valid modes", () => {
    expect(RuntimeModeSchema.parse("direct")).toBe("direct")
    expect(RuntimeModeSchema.parse("local")).toBe("local")
    expect(RuntimeModeSchema.parse("vercel-sandbox")).toBe("vercel-sandbox")
  })

  it("rejects invalid modes", () => {
    expect(() => RuntimeModeSchema.parse("docker")).toThrow()
    expect(() => RuntimeModeSchema.parse("")).toThrow()
  })
})

describe("ConfigSchema", () => {
  const validConfig = {
    workspaceRoot: "/home/user/project",
    workspaceId: "abc123",
    port: 3000,
    mode: "direct" as const,
    noOpen: false,
    noGitignore: false,
    dev: false,
    verbose: false,
  }

  it("accepts valid config", () => {
    const result = ConfigSchema.parse(validConfig)
    expect(result.workspaceRoot).toBe("/home/user/project")
    expect(result.port).toBe(3000)
    expect(result.mode).toBe("direct")
  })

  it("accepts optional model field", () => {
    const result = ConfigSchema.parse({ ...validConfig, model: "sonnet" })
    expect(result.model).toBe("sonnet")
  })

  it("rejects negative port", () => {
    expect(() => ConfigSchema.parse({ ...validConfig, port: -1 })).toThrow()
  })

  it("rejects missing required fields", () => {
    expect(() => ConfigSchema.parse({})).toThrow()
    expect(() => ConfigSchema.parse({ workspaceRoot: "/tmp" })).toThrow()
  })

  it("rejects invalid mode", () => {
    expect(() =>
      ConfigSchema.parse({ ...validConfig, mode: "invalid" }),
    ).toThrow()
  })
})

describe("EnvSchema", () => {
  it("requires ANTHROPIC_API_KEY", () => {
    expect(() => EnvSchema.parse({})).toThrow(/ANTHROPIC_API_KEY/)
  })

  it("accepts minimal valid env", () => {
    const result = EnvSchema.parse({ ANTHROPIC_API_KEY: "sk-test" })
    expect(result.ANTHROPIC_API_KEY).toBe("sk-test")
  })

  it("coerces BORING_AGENT_PORT to number", () => {
    const result = EnvSchema.parse({
      ANTHROPIC_API_KEY: "sk-test",
      BORING_AGENT_PORT: "8080",
    })
    expect(result.BORING_AGENT_PORT).toBe(8080)
  })

  it("rejects invalid port string", () => {
    expect(() =>
      EnvSchema.parse({
        ANTHROPIC_API_KEY: "sk-test",
        BORING_AGENT_PORT: "not-a-number",
      }),
    ).toThrow()
  })

  it("validates BORING_AGENT_MODE", () => {
    const result = EnvSchema.parse({
      ANTHROPIC_API_KEY: "sk-test",
      BORING_AGENT_MODE: "local",
    })
    expect(result.BORING_AGENT_MODE).toBe("local")
  })

  it("rejects invalid BORING_AGENT_MODE", () => {
    expect(() =>
      EnvSchema.parse({
        ANTHROPIC_API_KEY: "sk-test",
        BORING_AGENT_MODE: "kubernetes",
      }),
    ).toThrow()
  })

  it("accepts all optional Vercel fields", () => {
    const result = EnvSchema.parse({
      ANTHROPIC_API_KEY: "sk-test",
      VERCEL_OIDC_TOKEN: "token-123",
      VERCEL_TEAM_ID: "team_abc",
    })
    expect(result.VERCEL_OIDC_TOKEN).toBe("token-123")
    expect(result.VERCEL_TEAM_ID).toBe("team_abc")
  })

  it("coerces BORING_AGENT_SNAPSHOT_KEEP to number", () => {
    const result = EnvSchema.parse({
      ANTHROPIC_API_KEY: "sk-test",
      BORING_AGENT_SNAPSHOT_KEEP: "5",
    })
    expect(result.BORING_AGENT_SNAPSHOT_KEEP).toBe(5)
  })

  it("rejects empty ANTHROPIC_API_KEY", () => {
    expect(() => EnvSchema.parse({ ANTHROPIC_API_KEY: "" })).toThrow()
  })
})

describe("validateConfig", () => {
  it("returns typed config for valid input", () => {
    const config = validateConfig({
      workspaceRoot: "/tmp",
      workspaceId: "w1",
      port: 3000,
      mode: "direct",
      noOpen: false,
      noGitignore: false,
      dev: false,
      verbose: false,
    })
    expect(config.mode).toBe("direct")
  })

  it("throws on invalid input", () => {
    expect(() => validateConfig({})).toThrow()
  })
})
