import { describe, expect, it } from "vitest"
import {
  decodeLiveTranscriptReviewPresentation,
  encodeLiveTranscriptReviewPresentation,
} from "../reviewPresentation"

describe("live transcript review presentation", () => {
  it("round-trips a readable display message", () => {
    const value = { kind: "manual" as const, transcriptPath: "live-transcripts/a.md" }
    const encoded = encodeLiveTranscriptReviewPresentation(value)
    expect(encoded).toBe("Transcript review requested (manual): live-transcripts/a.md")
    expect(decodeLiveTranscriptReviewPresentation(encoded)).toEqual(value)
  })

  it.each([
    "unrelated text",
    "Transcript review requested (unknown): live-transcripts/a.md",
    "Transcript review requested (manual): README.md",
    "Transcript review requested (manual): live-transcripts/../secret.md",
    `Transcript review requested (manual): live-transcripts/${"x".repeat(1_025)}.md`,
  ])("rejects invalid presentation %s", (value) => {
    expect(decodeLiveTranscriptReviewPresentation(value)).toBeUndefined()
  })
})
