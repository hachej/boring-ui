import { mkdir, rename, rm } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { LiveTranscriptError } from "./errors"

const FINALIZE_TIMEOUT_MS = 15_000

export interface LocalAudioRecorderOptions {
  directory: string
  filename: string
  sampleRate: number
  ffmpegPath?: string
}

/** Streams private PCM directly into a local AAC/M4A file without retaining audio in memory. */
export class LocalAudioRecorder {
  readonly outputPath: string
  private readonly partialPath: string
  private child: ChildProcessWithoutNullStreams | undefined
  private failed: Error | undefined

  constructor(private readonly options: LocalAudioRecorderOptions) {
    if (!isAbsolute(options.directory)) throw new Error("Audio recording directory must be absolute")
    if (!/^[a-zA-Z0-9._-]+\.m4a$/.test(options.filename)) throw new Error("Audio recording filename is invalid")
    this.outputPath = `${options.directory}/${options.filename}`
    this.partialPath = `${this.outputPath}.partial.m4a`
  }

  async start(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true })
    const child = spawn(this.options.ffmpegPath ?? "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", String(this.options.sampleRate), "-ac", "1", "-i", "pipe:0",
      "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
      "-f", "ipod", "-y", this.partialPath,
    ], { stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    child.stdout.resume()
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_096) })
    child.once("error", (error) => { this.failed = error })
    child.once("close", (code) => {
      if (code !== 0 && !this.failed) this.failed = new Error(stderr.trim() || `FFmpeg exited with code ${code}`)
    })
    await Promise.race([
      once(child, "spawn"),
      once(child, "error").then(([error]) => { throw error }),
    ])
  }

  async write(data: Uint8Array): Promise<void> {
    const child = this.child
    if (!child || child.stdin.destroyed || this.failed) throw this.recordingError()
    if (!child.stdin.write(data)) await once(child.stdin, "drain")
    if (this.failed) throw this.recordingError()
  }

  async finalize(): Promise<void> {
    const child = this.child
    if (!child) return
    if (!child.stdin.destroyed) child.stdin.end()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (child.exitCode === null) {
        await Promise.race([
          once(child, "close"),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL")
              reject(new Error("Audio recording finalization timed out"))
            }, FINALIZE_TIMEOUT_MS)
          }),
        ])
      }
      if (this.failed) throw this.recordingError()
      await rename(this.partialPath, this.outputPath)
    } catch (error) {
      await rm(this.partialPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      this.child = undefined
    }
  }

  async abort(): Promise<void> {
    const child = this.child
    if (child && child.exitCode === null) child.kill("SIGKILL")
    await rm(this.partialPath, { force: true }).catch(() => undefined)
    this.child = undefined
  }

  private recordingError(): LiveTranscriptError {
    return new LiveTranscriptError("live_transcript_upstream_failed", `Local audio recording failed: ${this.failed?.message ?? "unknown error"}`)
  }
}
