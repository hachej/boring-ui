import { describe, expect, it } from "vitest"
import {
  defaultUrlPanePolicy,
  originMatchesPattern,
  parseUrlPaneOrigins,
  resolveUrlPaneTarget,
} from "../urlPane"

describe("parseUrlPaneOrigins", () => {
  it("returns an empty list for unset input so callers choose the closed/default meaning", () => {
    expect(parseUrlPaneOrigins(undefined)).toEqual([])
    expect(parseUrlPaneOrigins("")).toEqual([])
    expect(parseUrlPaneOrigins("   ")).toEqual([])
  })

  it("splits on commas and whitespace", () => {
    expect(parseUrlPaneOrigins("http://localhost:*, https://demo.example.com\nhttp://127.0.0.1:5210")).toEqual([
      "http://localhost:*",
      "https://demo.example.com",
      "http://127.0.0.1:5210",
    ])
  })
})

describe("originMatchesPattern", () => {
  it("matches exact origins case-insensitively and ignores a trailing slash", () => {
    expect(originMatchesPattern("http://localhost:5210", "http://localhost:5210")).toBe(true)
    expect(originMatchesPattern("http://LOCALHOST:5210", "http://localhost:5210/")).toBe(true)
  })

  it("treats :* as a port wildcard only", () => {
    expect(originMatchesPattern("http://localhost:4321", "http://localhost:*")).toBe(true)
    expect(originMatchesPattern("https://localhost:4321", "http://localhost:*")).toBe(false)
    expect(originMatchesPattern("http://localhost", "http://localhost:*")).toBe(false)
  })

  it("never wildcards the host", () => {
    expect(originMatchesPattern("http://evil.localhost:80", "http://localhost:*")).toBe(false)
    expect(originMatchesPattern("http://localhost.evil.com:80", "http://localhost:*")).toBe(false)
    expect(originMatchesPattern("https://a.example.com", "https://*.example.com")).toBe(false)
  })

  it("rejects empty patterns", () => {
    expect(originMatchesPattern("http://localhost:5210", "")).toBe(false)
    expect(originMatchesPattern("http://localhost:5210", "   ")).toBe(false)
  })
})

describe("resolveUrlPaneTarget", () => {
  const policy = defaultUrlPanePolicy()

  it("allows loopback demo URLs on any port and preserves path/query", () => {
    const result = resolveUrlPaneTarget("http://127.0.0.1:5210/workspace/factory?tab=1", policy)
    expect(result).toEqual({
      ok: true,
      url: "http://127.0.0.1:5210/workspace/factory?tab=1",
      origin: "http://127.0.0.1:5210",
    })
  })

  it("rejects empty and non-absolute input", () => {
    expect(resolveUrlPaneTarget("", policy)).toMatchObject({ ok: false, reason: "empty" })
    expect(resolveUrlPaneTarget("/relative/path", policy)).toMatchObject({ ok: false, reason: "unparseable" })
  })

  it("rejects non-http schemes, including the javascript: and data: shapes", () => {
    expect(resolveUrlPaneTarget("javascript:alert(1)", policy)).toMatchObject({
      ok: false,
      reason: "protocol-not-allowed",
    })
    expect(resolveUrlPaneTarget("data:text/html,<script>1</script>", policy)).toMatchObject({
      ok: false,
      reason: "protocol-not-allowed",
    })
    expect(resolveUrlPaneTarget("file:///etc/passwd", policy)).toMatchObject({
      ok: false,
      reason: "protocol-not-allowed",
    })
  })

  it("rejects embedded credentials", () => {
    expect(resolveUrlPaneTarget("http://user:pass@127.0.0.1:5210/", policy)).toMatchObject({
      ok: false,
      reason: "credentials-not-allowed",
    })
  })

  it("rejects any origin outside the allowlist", () => {
    expect(resolveUrlPaneTarget("https://example.com/", policy)).toMatchObject({
      ok: false,
      reason: "origin-not-allowed",
    })
    // The classic bypass: an attacker host that merely *contains* localhost.
    expect(resolveUrlPaneTarget("http://localhost.attacker.com/", policy)).toMatchObject({
      ok: false,
      reason: "origin-not-allowed",
    })
  })

  it("fails closed when the policy has no origins", () => {
    expect(resolveUrlPaneTarget("http://127.0.0.1:5210/", { origins: [] })).toMatchObject({
      ok: false,
      reason: "origin-not-allowed",
    })
  })

  it("honours an explicitly configured non-loopback origin", () => {
    const configured = { origins: ["https://demo.example.com"] }
    expect(resolveUrlPaneTarget("https://demo.example.com/x", configured)).toMatchObject({ ok: true })
    expect(resolveUrlPaneTarget("https://demo.example.com:8443/x", configured)).toMatchObject({
      ok: false,
      reason: "origin-not-allowed",
    })
  })
})
