import { describe, expect, it } from "vitest"
import { appendTranscriptToDraft, shouldShowRecordingAccessory, type ComposerRecordingSnapshot } from "../composerRecording"

function snapshot(phase: ComposerRecordingSnapshot["phase"], kind: ComposerRecordingSnapshot["kind"] = "live") {
  return { phase, kind }
}

describe("shouldShowRecordingAccessory", () => {
  it.each(["starting", "recording", "transcribing"] as const)("owns the active live %s phase", (phase) => {
    expect(shouldShowRecordingAccessory(snapshot(phase), true)).toBe(true)
  })

  it.each(["idle", "error"] as const)("returns composer control ownership for live %s", (phase) => {
    expect(shouldShowRecordingAccessory(snapshot(phase), true)).toBe(false)
  })

  it("never replaces short-recording controls or renders without an accessory", () => {
    expect(shouldShowRecordingAccessory(snapshot("recording", "short"), true)).toBe(false)
    expect(shouldShowRecordingAccessory(snapshot("recording"), false)).toBe(false)
  })
})

describe("appendTranscriptToDraft", () => {
  it("adds one separator only when the draft needs one", () => {
    expect(appendTranscriptToDraft("", "hello")).toBe("hello")
    expect(appendTranscriptToDraft("draft", "hello")).toBe("draft hello")
    expect(appendTranscriptToDraft("draft ", "hello")).toBe("draft hello")
    expect(appendTranscriptToDraft("draft\n", "hello")).toBe("draft\nhello")
  })
})
