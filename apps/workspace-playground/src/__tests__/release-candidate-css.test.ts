import { describe, expect, it } from "vitest"
import { assertReleaseCandidateAgentCss } from "../release-candidate-css"

const distUrl = "http://127.0.0.1:5380/@fs/repo/packages/agent/dist/front/styles.css"

describe("release-candidate Agent stylesheet assertion", () => {
  it("accepts dist CSS with a CSS MIME and more than 100,000 bytes", () => {
    expect(() => assertReleaseCandidateAgentCss(distUrl, "text/css; charset=utf-8", 100_001)).not.toThrow()
  })

  it("rejects CSS at the 100,000-byte boundary", () => {
    expect(() => assertReleaseCandidateAgentCss(distUrl, "text/css", 100_000)).toThrow(/too small/)
  })

  it("rejects a wrong MIME", () => {
    expect(() => assertReleaseCandidateAgentCss(distUrl, "application/javascript", 100_001)).toThrow(/wrong MIME/)
  })

  it("rejects a source stylesheet path", () => {
    const sourceUrl = "http://127.0.0.1:5380/@fs/repo/packages/agent/src/front/styles.css"
    expect(() => assertReleaseCandidateAgentCss(sourceUrl, "text/css", 100_001)).toThrow(/did not load from dist/)
  })
})
