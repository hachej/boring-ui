import type { Workspace } from "@hachej/boring-agent/shared"
import { LiveTranscriptError } from "./errors"

export interface ProjectedTranscriptLine {
  startSeconds: number
  speaker: number
  text: string
}

export interface TranscriptDocument {
  title: string
  startedAt: string
  state: "active" | "complete" | "interrupted"
  lines: readonly ProjectedTranscriptLine[]
}

const encoder = new TextEncoder()

export function renderTranscriptMarkdown(document: TranscriptDocument): string {
  const lines = [
    `# ${cleanTitle(document.title)}`,
    "",
    `- Started: ${document.startedAt}`,
    `- State: ${document.state}`,
  ]
  for (const line of document.lines) {
    const text = line.text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim()
    if (!text) continue
    lines.push("", `[${formatTimestamp(line.startSeconds)}] **Speaker ${line.speaker}:** ${text}`)
  }
  return `${lines.join("\n")}\n`
}

function cleanTitle(value: string): string {
  return (value.trim() || "Live transcript")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 120)
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remaining = safe % 60
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":")
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export class LiveTranscriptProjector {
  private expectedBytes: Uint8Array
  private expectedMtimeMs: number
  private lastWriteAt = 0
  private revision = 0
  private queue = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private pendingDocument: TranscriptDocument | undefined
  private throttleActive = false
  private terminal = false

  constructor(
    private readonly workspace: Workspace,
    readonly path: string,
    initial: { markdown: string; mtimeMs: number },
    private readonly options: {
      now?: () => number
      setTimeout?: typeof setTimeout
      clearTimeout?: typeof clearTimeout
      onError?: (error: LiveTranscriptError) => void
    } = {},
  ) {
    this.expectedBytes = encoder.encode(initial.markdown)
    this.expectedMtimeMs = initial.mtimeMs
    this.lastWriteAt = this.now()
  }

  get projectionRevision(): number {
    return this.revision
  }

  schedule(document: TranscriptDocument): void {
    if (this.terminal) return
    this.pendingDocument = document
    if (this.throttleActive) return
    this.throttleActive = true
    const wait = Math.max(0, 1_000 - (this.now() - this.lastWriteAt))
    if (wait === 0) {
      this.flushScheduled()
      return
    }
    this.timer = (this.options.setTimeout ?? setTimeout)(() => {
      this.timer = undefined
      this.flushScheduled()
    }, wait)
  }

  async finalize(document: TranscriptDocument): Promise<void> {
    if (this.terminal) return await this.queue
    this.terminal = true
    if (this.timer) {
      ;(this.options.clearTimeout ?? clearTimeout)(this.timer)
      this.timer = undefined
      this.throttleActive = false
    }
    this.pendingDocument = undefined
    this.enqueue(document, true)
    await this.queue
  }

  async idle(): Promise<void> {
    await this.queue
  }

  private flushScheduled(): void {
    const document = this.pendingDocument
    this.pendingDocument = undefined
    if (!document) {
      this.throttleActive = false
      return
    }
    this.enqueue(document)
    const flush = this.queue
    void flush.finally(() => {
      this.throttleActive = false
      if (this.pendingDocument && !this.terminal) this.schedule(this.pendingDocument)
    })
  }

  private enqueue(document: TranscriptDocument, terminal = false): void {
    this.queue = this.queue
      .then(() => this.project(document))
      .catch((error) => {
        const normalized = error instanceof LiveTranscriptError
          ? error
          : new LiveTranscriptError("live_transcript_upstream_failed", "Transcript projection failed.")
        this.options.onError?.(normalized)
        if (terminal) throw normalized
      })
    this.queue.catch(() => {})
  }

  private async project(document: TranscriptDocument): Promise<void> {
    if (!this.workspace.readBinaryFile || !this.workspace.writeFileWithStat) {
      throw new LiveTranscriptError("live_transcript_disabled", "Workspace does not support guarded transcript projection.", 503)
    }
    let observedBytes: Uint8Array
    let observedStat: Awaited<ReturnType<Workspace["stat"]>>
    try {
      ;[observedBytes, observedStat] = await Promise.all([
        this.workspace.readBinaryFile(this.path),
        this.workspace.stat(this.path),
      ])
    } catch {
      throw new LiveTranscriptError(
        "live_transcript_revision_conflict",
        "Transcript was removed or became unreadable outside the live process; capture was interrupted.",
        409,
      )
    }
    if (!bytesEqual(observedBytes, this.expectedBytes) || observedStat.mtimeMs !== this.expectedMtimeMs) {
      throw new LiveTranscriptError(
        "live_transcript_revision_conflict",
        "Transcript changed outside the live process; capture was interrupted.",
        409,
      )
    }

    const markdown = renderTranscriptMarkdown(document)
    const nextBytes = encoder.encode(markdown)
    this.lastWriteAt = this.now()
    if (bytesEqual(nextBytes, this.expectedBytes)) return
    const nextStat = await this.workspace.writeFileWithStat(this.path, markdown)
    this.expectedBytes = nextBytes
    this.expectedMtimeMs = nextStat.mtimeMs
    this.revision += 1
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
