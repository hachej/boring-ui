// @vitest-environment node
import { describe, expect, it } from "vitest"
import { assertExactOrigin, validateLocalAuthority } from "../authority"

const authority = {
  listenerHost: "127.0.0.1",
  canonicalHost: "localhost:5200",
  canonicalOrigin: "http://localhost:5200",
}

describe("live transcript local authority", () => {
  it("accepts exact loopback authorities", () => {
    expect(() => validateLocalAuthority(authority, "ws://127.0.0.1:18772/asr")).not.toThrow()
    expect(() => assertExactOrigin({ headers: { host: authority.canonicalHost, origin: authority.canonicalOrigin } } as never, authority)).not.toThrow()
  })

  it("rejects non-loopback and mismatched Host/Origin", () => {
    expect(() => validateLocalAuthority({ ...authority, listenerHost: "0.0.0.0" }, "ws://127.0.0.1:18772/asr")).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
    expect(() => validateLocalAuthority(authority, "ws://speech.example/asr")).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
    expect(() => validateLocalAuthority(authority, "ws://127.0.0.1:18772/other")).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
    expect(() => assertExactOrigin({ headers: { host: "127.0.0.1:5200", origin: authority.canonicalOrigin } } as never, authority)).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
    expect(() => assertExactOrigin({ headers: { host: authority.canonicalHost, origin: "http://evil.test" } } as never, authority)).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
  })
})
