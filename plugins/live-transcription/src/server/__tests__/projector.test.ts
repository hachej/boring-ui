// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveTranscriptProjector, renderTranscriptMarkdown, type TranscriptDocument } from "../projector"
import { MemoryWorkspace } from "./testWorkspace"

const initial: TranscriptDocument = {
  title: "Weekly sync",
  startedAt: "2026-07-24T12:00:00.000Z",
  state: "active",
  lines: [],
}

afterEach(() => vi.useRealTimers())

describe("LiveTranscriptProjector", () => {
  it("serializes throttled whole-document writes and terminal-flushes once", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const workspace = new MemoryWorkspace()
    const markdown = renderTranscriptMarkdown(initial)
    const stat = await workspace.writeFileWithStat("live-transcripts/a.md", markdown)
    const projector = new LiveTranscriptProjector(workspace, "live-transcripts/a.md", {
      markdown,
      mtimeMs: stat.mtimeMs,
    })

    projector.schedule({
      ...initial,
      lines: [{ startSeconds: 3.9, speaker: 1, text: "Bonjour" }],
    })
    expect(workspace.writeCount).toBe(1)

    await projector.finalize({
      ...initial,
      state: "complete",
      lines: [{ startSeconds: 3.9, speaker: 1, text: "Bonjour" }],
    })
    await vi.runAllTimersAsync()

    expect(workspace.writeCount).toBe(2)
    expect(projector.projectionRevision).toBe(1)
    expect(await workspace.readFile("live-transcripts/a.md")).toContain("- State: complete")
    expect(await workspace.readFile("live-transcripts/a.md")).toContain("[00:00:03] **Speaker 1:** Bonjour")
  })

  it("keeps rapid snapshots at least one second apart", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const workspace = new MemoryWorkspace()
    const markdown = renderTranscriptMarkdown(initial)
    const stat = await workspace.writeFileWithStat("live-transcripts/throttle.md", markdown)
    const projector = new LiveTranscriptProjector(workspace, "live-transcripts/throttle.md", {
      markdown,
      mtimeMs: stat.mtimeMs,
    })
    vi.setSystemTime(2_000)
    projector.schedule({ ...initial, lines: [{ startSeconds: 1, speaker: 1, text: "one" }] })
    projector.schedule({ ...initial, lines: [{ startSeconds: 2, speaker: 1, text: "two" }] })
    await projector.idle()
    expect(workspace.writeCount).toBe(2)

    await vi.advanceTimersByTimeAsync(999)
    expect(workspace.writeCount).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    await projector.idle()
    expect(workspace.writeCount).toBe(3)
    expect(await workspace.readFile("live-transcripts/throttle.md")).toContain("two")
  })

  it("classifies external deletion as a revision conflict", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const workspace = new MemoryWorkspace()
    const path = "live-transcripts/deleted.md"
    const markdown = renderTranscriptMarkdown(initial)
    const stat = await workspace.writeFileWithStat(path, markdown)
    const onError = vi.fn()
    const projector = new LiveTranscriptProjector(workspace, path, {
      markdown,
      mtimeMs: stat.mtimeMs,
    }, { onError })

    await workspace.unlink(path)
    vi.setSystemTime(6_000)
    projector.schedule({ ...initial, lines: [{ startSeconds: 1, speaker: 1, text: "ignored" }] })
    await projector.idle()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "live_transcript_revision_conflict" }))
    expect(projector.projectionRevision).toBe(0)
  })

  it("detects bytes or mtime drift and preserves external content", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000)
    const workspace = new MemoryWorkspace()
    const markdown = renderTranscriptMarkdown(initial)
    const stat = await workspace.writeFileWithStat("live-transcripts/conflict.md", markdown)
    const onError = vi.fn()
    const projector = new LiveTranscriptProjector(workspace, "live-transcripts/conflict.md", {
      markdown,
      mtimeMs: stat.mtimeMs,
    }, { onError })

    workspace.mutateExternally("live-transcripts/conflict.md", "external writer\n")
    vi.setSystemTime(6_000)
    projector.schedule({ ...initial, lines: [{ startSeconds: 1, speaker: 2, text: "ignored" }] })
    await projector.idle()

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "live_transcript_revision_conflict" }))
    expect(await workspace.readFile("live-transcripts/conflict.md")).toBe("external writer\n")
    expect(projector.projectionRevision).toBe(0)
  })
})
