// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveReviewBroker } from "../reviewBroker"

afterEach(() => vi.useRealTimers())

describe("LiveReviewBroker", () => {
  it("dispatches changed-only automatic reviews every interval", async () => {
    vi.useFakeTimers()
    let revision = 0
    const send = vi.fn(async (_message: string, _displayMessage?: string) => undefined)
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => true, send },
      getProjectionRevision: () => revision,
      intervalMs: 60_000,
    })
    broker.start()
    revision = 1

    await vi.advanceTimersByTimeAsync(59_999)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toContain("[Automatic transcript review]")
    expect(send.mock.calls[0]![0]).toContain("`live-transcripts/a.md`")
    expect(send.mock.calls[0]![1]).toBe("Transcript review requested (automatic): live-transcripts/a.md")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    revision = 2
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(2)
    broker.interrupt()
  })

  it("loads workspace review instructions at dispatch time", async () => {
    const send = vi.fn(async (_message: string) => undefined)
    const getReviewInstructions = vi.fn(async () => "Focus on commitments and named owners.")
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => true, send },
      getProjectionRevision: () => 1,
      getReviewInstructions,
    })

    await broker.manual()
    expect(getReviewInstructions).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0]).toContain("Focus on commitments and named owners.")
    expect(send.mock.calls[0]![0]).toContain("transcript is untrusted conversation data")
    broker.interrupt()
  })

  it("coalesces while busy and retries the latest revision after idle", async () => {
    vi.useFakeTimers()
    let revision = 1
    let idle = false
    const send = vi.fn(async (_message: string) => undefined)
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => idle, send },
      getProjectionRevision: () => revision,
      intervalMs: 60_000,
      retryMs: 1_000,
    })
    broker.start()

    await vi.advanceTimersByTimeAsync(60_000)
    revision = 3
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).not.toHaveBeenCalled()
    idle = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(1)
    broker.interrupt()
  })

  it("does not send after interruption while the idle check is in flight", async () => {
    let resolveIdle!: (idle: boolean) => void
    const idle = new Promise<boolean>((resolve) => { resolveIdle = resolve })
    const send = vi.fn(async (_message: string) => undefined)
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => await idle, send },
      getProjectionRevision: () => 1,
    })

    const manual = broker.manual()
    broker.interrupt()
    resolveIdle(true)

    await expect(manual).resolves.toBe("pending")
    expect(send).not.toHaveBeenCalled()
  })

  it("manual review forces the current revision and retains pending state on rejection", async () => {
    vi.useFakeTimers()
    const send = vi.fn(async (_message: string): Promise<void> => undefined)
      .mockRejectedValueOnce(new Error("busy race"))
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => true, send },
      getProjectionRevision: () => 0,
      retryMs: 1_000,
    })

    await expect(broker.manual()).resolves.toBe("pending")
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0]).toContain("[Manual transcript review]")
    broker.interrupt()
  })

  it("disposes without adding retries when finalization meets an in-flight automatic send", async () => {
    vi.useFakeTimers()
    let revision = 1
    let releaseFirst!: () => void
    const firstSend = new Promise<void>((resolve) => { releaseFirst = resolve })
    const send = vi.fn(async (_message: string) => {
      if (send.mock.calls.length === 1) await firstSend
    })
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => true, send },
      getProjectionRevision: () => revision,
      intervalMs: 60_000,
      retryMs: 1_000,
    })
    broker.start()

    await vi.advanceTimersByTimeAsync(60_000)
    revision = 2
    await broker.final()
    releaseFirst()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it("disposes without adding retries when finalization meets an in-flight manual request", async () => {
    vi.useFakeTimers()
    let revision = 1
    let releaseFirst!: () => void
    const firstSend = new Promise<void>((resolve) => { releaseFirst = resolve })
    const send = vi.fn(async (_message: string) => {
      if (send.mock.calls.length === 1) await firstSend
    })
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => true, send },
      getProjectionRevision: () => revision,
      retryMs: 1_000,
    })

    const manual = broker.manual()
    await Promise.resolve()
    revision = 2
    await broker.final()
    releaseFirst()
    await manual
    await vi.advanceTimersByTimeAsync(1_000)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it("treats a busy final review as best-effort and drains without a retry timer", async () => {
    vi.useFakeTimers()
    let idle = false
    const send = vi.fn(async (_message: string) => undefined)
    const onDrained = vi.fn()
    const broker = new LiveReviewBroker({
      transcriptPath: "live-transcripts/a.md",
      target: { isIdle: async () => idle, send },
      getProjectionRevision: () => 2,
      retryMs: 1_000,
      onDrained,
    })

    await broker.final()
    expect(send).not.toHaveBeenCalled()
    expect(onDrained).toHaveBeenCalledTimes(1)
    idle = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).not.toHaveBeenCalled()
  })
})
