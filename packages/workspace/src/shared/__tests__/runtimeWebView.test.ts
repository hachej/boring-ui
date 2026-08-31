import { describe, expect, it } from "vitest"
import {
  resolveRuntimeWebViewProjection,
  runtimeWebViewRefreshDelay,
  runtimeWebViewTargetSchema,
} from "../runtimeWebView"

describe("runtimeWebViewTargetSchema", () => {
  it("accepts only a bounded port and absolute path", () => {
    expect(runtimeWebViewTargetSchema.safeParse({ port: 8_000, path: "/vnc.html" }).success).toBe(true)
    for (const target of [
      { port: 80 },
      { port: 8_000, path: "relative" },
      { port: 8_000, path: "/ok", upstream: "https://attacker.test" },
      { port: 8_000, provider: "hosted" },
    ]) {
      expect(runtimeWebViewTargetSchema.safeParse(target).success).toBe(false)
    }
  })
})

describe("resolveRuntimeWebViewProjection", () => {
  it("accepts credential-free hosted HTTPS and bounded local loopback", () => {
    expect(resolveRuntimeWebViewProjection("https://preview.example/vnc.html?token=short-lived")).toMatchObject({ ok: true })
    expect(resolveRuntimeWebViewProjection("http://localhost:6080/vnc.html")).toMatchObject({ ok: true })
    expect(resolveRuntimeWebViewProjection("http://127.0.0.1:6080/vnc.html")).toMatchObject({ ok: true })
    expect(resolveRuntimeWebViewProjection("http://[::1]:6080/vnc.html")).toMatchObject({ ok: true })
  })

  it("rejects credentials, non-loopback HTTP, implicit or privileged local ports, and active schemes", () => {
    for (const url of [
      "https://user:pass@preview.example/vnc.html",
      "http://preview.example:6080/vnc.html",
      "http://localhost/vnc.html",
      "http://localhost:80/vnc.html",
      "https://localhost/vnc.html",
      "http://2130706433:6080/vnc.html",
      "http://0177.0.0.1:6080/vnc.html",
      "ws://localhost:6080/websockify",
      "javascript:alert(1)",
    ]) {
      expect(resolveRuntimeWebViewProjection(url).ok).toBe(false)
    }
  })
})

describe("runtimeWebViewRefreshDelay", () => {
  it("refreshes thirty seconds before expiry without creating a tight loop", () => {
    expect(runtimeWebViewRefreshDelay("2027-01-01T00:02:00.000Z", Date.parse("2027-01-01T00:00:00.000Z"))).toBe(90_000)
    expect(runtimeWebViewRefreshDelay("2027-01-01T00:00:01.000Z", Date.parse("2027-01-01T00:00:00.000Z"))).toBe(1_000)
    expect(runtimeWebViewRefreshDelay("not-a-date", 0)).toBeNull()
  })
})
