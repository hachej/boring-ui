import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createLogger } from "../logging.js"

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("emits structured JSON with prefix and timestamp", () => {
    const log = createLogger("[chat]")
    log.info("request received")

    expect(logSpy).toHaveBeenCalledOnce()
    const entry = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
    expect(entry.prefix).toBe("[chat]")
    expect(entry.msg).toBe("request received")
    expect(entry.t).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("includes extra fields", () => {
    const log = createLogger("[sandbox:direct]")
    log.info("exec started", { cmd: "ls", timeout: 5000 })

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(entry.cmd).toBe("ls")
    expect(entry.timeout).toBe(5000)
  })

  it("redacts sensitive fields", () => {
    const log = createLogger("[session]")
    log.info("auth check", { apiKey: "sk-12345", token: "abc", user: "bob" })

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(entry.apiKey).toBe("***")
    expect(entry.token).toBe("***")
    expect(entry.user).toBe("bob")
  })

  it("routes warn to console.warn", () => {
    const log = createLogger("[path-attack]")
    log.warn("traversal rejected", { path: "../etc/passwd" })

    expect(warnSpy).toHaveBeenCalledOnce()
    expect(logSpy).not.toHaveBeenCalled()
    const entry = JSON.parse(warnSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("warn")
  })

  it("routes error to console.error", () => {
    const log = createLogger("[bridge]")
    log.error("stream failed", { reason: "EPIPE" })

    expect(errorSpy).toHaveBeenCalledOnce()
    expect(logSpy).not.toHaveBeenCalled()
    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("error")
  })

  it("debug is silent without BORING_AGENT_VERBOSE=1", () => {
    const log = createLogger("[test:unit]")
    log.debug("verbose info")

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("works with no fields argument", () => {
    const log = createLogger("[ready-status]")
    log.info("server ready")

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(entry.level).toBe("info")
    expect(entry.msg).toBe("server ready")
  })

  it("redacts all known sensitive key names", () => {
    const log = createLogger("[oidc]")
    log.info("token exchange", {
      api_key: "x",
      secret: "x",
      password: "x",
      authorization: "x",
      cookie: "x",
      oidcToken: "x",
      accessToken: "x",
      refreshToken: "x",
      ANTHROPIC_API_KEY: "x",
      OPENAI_API_KEY: "x",
      normalField: "visible",
    })

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string)
    for (const key of [
      "api_key", "secret", "password", "authorization", "cookie",
      "oidcToken", "accessToken", "refreshToken",
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
    ]) {
      expect(entry[key]).toBe("***")
    }
    expect(entry.normalField).toBe("visible")
  })
})
