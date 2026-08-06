// @vitest-environment node
import { describe, expect, it } from "vitest"
import { groupKyutaiTranscriptSnapshot } from "../kyutaiTranscript"

const snapshot = (lines: Array<{ text: string; startSeconds: number; endSeconds?: number; speaker?: number }>) => ({
  lines: lines.map((line) => ({ speaker: 0, ...line })),
  remainingDiarizationSeconds: 0,
})

describe("Kyutai durable transcript grouping", () => {
  it("joins word events into sentences instead of one transcript row per event", () => {
    expect(groupKyutaiTranscriptSnapshot(snapshot([
      { text: "Pourquoi", startSeconds: 0, endSeconds: 0.4 },
      { text: "est-ce que", startSeconds: 0.45, endSeconds: 0.9 },
      { text: "ça ?", startSeconds: 0.95, endSeconds: 1.2 },
      { text: "Qu'est-ce qui se", startSeconds: 1.25, endSeconds: 1.8 },
      { text: "passe ?", startSeconds: 1.85, endSeconds: 2.2 },
    ]))).toEqual({
      lines: [
        { text: "Pourquoi est-ce que ça ?", startSeconds: 0, endSeconds: 1.2, speaker: 0 },
        { text: "Qu'est-ce qui se passe ?", startSeconds: 1.25, endSeconds: 2.2, speaker: 0 },
      ],
      remainingDiarizationSeconds: 0,
    })
  })

  it("starts a new utterance after a timed pause without punctuation", () => {
    expect(groupKyutaiTranscriptSnapshot(snapshot([
      { text: "première idée", startSeconds: 0, endSeconds: 0.5 },
      { text: "suite", startSeconds: 0.6, endSeconds: 0.9 },
      { text: "nouvelle idée", startSeconds: 1.7, endSeconds: 2.1 },
    ])).lines.map((line) => line.text)).toEqual(["première idée suite", "nouvelle idée"])
  })

  it("starts a new row before separate events exceed the readable word target", () => {
    const first = Array.from({ length: 23 }, (_, index) => `mot${index}`).join(" ")
    const result = groupKyutaiTranscriptSnapshot(snapshot([
      { text: first, startSeconds: 0, endSeconds: 1 },
      { text: "deux mots", startSeconds: 1.1, endSeconds: 1.3 },
    ]))
    expect(result.lines.map((line) => line.text)).toEqual([first, "deux mots"])
  })

  it("does not alter Whisper-style speaker boundaries", () => {
    expect(groupKyutaiTranscriptSnapshot({
      lines: [
        { text: "bonjour", startSeconds: 0, endSeconds: 0.4, speaker: 0 },
        { text: "salut", startSeconds: 0.5, endSeconds: 0.8, speaker: 1 },
      ],
      remainingDiarizationSeconds: 0,
    }).lines).toHaveLength(2)
  })
})
