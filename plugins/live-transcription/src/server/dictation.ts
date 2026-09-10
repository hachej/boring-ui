import type { ChannelBatchTranscriber, ChannelMediaRegion } from "@hachej/boring-agent/server"
import { SHORT_DICTATION_MAX_BYTES } from "../shared"
import { LiveTranscriptError } from "./errors"
import { isLoopbackHost } from "./authority"
const ALLOWED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
])

export interface BatchFileTranscriberOptions {
  readonly upstreamWebSocketUrl: string
  readonly processorRegion: ChannelMediaRegion
  readonly bearerToken?: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
}

/** Supported server seam for retained files; uses the same self-hosted Whisper HTTP endpoint as dictation. */
export function createSelfHostedBatchFileTranscriber(options: BatchFileTranscriberOptions): ChannelBatchTranscriber {
  assertSelfHostedBatchUrl(options.upstreamWebSocketUrl)
  return {
    processorRegion: options.processorRegion,
    transcribeFile: ({ bytes, mimeType }) => transcribeBatchFile({
      upstreamWebSocketUrl: options.upstreamWebSocketUrl,
      bearerToken: options.bearerToken,
      mimeType,
      bytes,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
    }),
  }
}

export async function transcribeBatchFile(input: {
  upstreamWebSocketUrl: string
  bearerToken?: string
  mimeType: string
  bytes: Uint8Array
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}): Promise<{ text: string }> {
  assertSelfHostedBatchUrl(input.upstreamWebSocketUrl)
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new LiveTranscriptError("live_transcript_invalid_audio", "Batch audio type is unsupported.", 400)
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > SHORT_DICTATION_MAX_BYTES) {
    throw new LiveTranscriptError("live_transcript_limit_exceeded", "Batch audio exceeded the in-memory V0 limit.", 413)
  }
  return await transcribeBytes(input)
}

export async function transcribeShortDictation(input: {
  upstreamWebSocketUrl: string
  bearerToken?: string
  mimeType: string
  audioBase64: string
  fetch?: typeof fetch
}): Promise<{ text: string }> {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    throw new LiveTranscriptError("live_transcript_invalid_audio", "Short dictation audio type is unsupported.", 400)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.audioBase64) || input.audioBase64.length % 4 !== 0) {
    throw new LiveTranscriptError("live_transcript_invalid_audio", "Short dictation audio encoding is invalid.", 400)
  }
  const bytes = Buffer.from(input.audioBase64, "base64")
  if (bytes.byteLength === 0 || bytes.byteLength > SHORT_DICTATION_MAX_BYTES) {
    throw new LiveTranscriptError("live_transcript_limit_exceeded", "Short dictation exceeded the in-memory V0 limit.", 413)
  }
  return await transcribeBytes({ ...input, bytes })
}

async function transcribeBytes(input: {
  upstreamWebSocketUrl: string
  bearerToken?: string
  mimeType: string
  bytes: Uint8Array
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}): Promise<{ text: string }> {
  const upstream = new URL(input.upstreamWebSocketUrl)
  upstream.protocol = upstream.protocol === "wss:" ? "https:" : "http:"
  upstream.pathname = "/v1/audio/transcriptions"
  upstream.search = ""
  const form = new FormData()
  form.set("file", new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }), `dictation.${extensionFor(input.mimeType)}`)
  form.set("model", "tiny")
  form.set("language", "fr")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000)
  let payload: { text?: unknown } | null
  try {
    const response = await (input.fetch ?? fetch)(upstream, {
      method: "POST",
      headers: input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : undefined,
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service rejected the audio.", 502)
    }
    payload = await readBoundedJson(response, input.maxResponseBytes ?? 1_000_000)
  } catch (error) {
    if (error instanceof LiveTranscriptError) throw error
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service was unavailable.", 502)
  } finally {
    clearTimeout(timer)
  }
  if (!payload || typeof payload.text !== "string") {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service returned an invalid response.", 502)
  }
  return { text: payload.text }
}

async function readBoundedJson(response: Response, limit: number): Promise<{ text?: unknown } | null> {
  if (!response.body || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service returned an invalid response.", 502)
  }
  const announced = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(announced) && announced > limit) throw new LiveTranscriptError("live_transcript_limit_exceeded", "Transcription response exceeded the size limit.", 502)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new LiveTranscriptError("live_transcript_limit_exceeded", "Transcription response exceeded the size limit.", 502)
      }
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as { text?: unknown } } catch { return null }
}

function assertSelfHostedBatchUrl(value: string): void {
  let url: URL
  try { url = new URL(value) } catch {
    throw new LiveTranscriptError("live_transcript_local_only", "Batch transcription URL is invalid.", 500)
  }
  if (!isLoopbackHost(url.hostname) || (url.protocol !== "ws:" && url.protocol !== "wss:") || url.username || url.password) {
    throw new LiveTranscriptError("live_transcript_local_only", "Batch transcription requires a self-hosted loopback Whisper processor.", 500)
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) return "ogg"
  if (mimeType === "audio/mp4") return "m4a"
  if (mimeType === "audio/mpeg") return "mp3"
  if (mimeType === "audio/wav") return "wav"
  return "webm"
}
