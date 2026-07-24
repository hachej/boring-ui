import { LiveTranscriptError } from "./errors"

const MAX_SHORT_AUDIO_BYTES = 8 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/ogg",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/wav",
])

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
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SHORT_AUDIO_BYTES) {
    throw new LiveTranscriptError("live_transcript_limit_exceeded", "Short dictation exceeded the in-memory V0 limit.", 413)
  }
  const upstream = new URL(input.upstreamWebSocketUrl)
  upstream.protocol = upstream.protocol === "wss:" ? "https:" : "http:"
  upstream.pathname = "/v1/audio/transcriptions"
  upstream.search = ""
  const form = new FormData()
  form.set("file", new Blob([bytes], { type: input.mimeType }), `dictation.${extensionFor(input.mimeType)}`)
  form.set("model", "tiny")
  form.set("language", "fr")
  let response: Response
  try {
    response = await (input.fetch ?? fetch)(upstream, {
      method: "POST",
      headers: input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : undefined,
      body: form,
    })
  } catch {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service was unavailable.", 502)
  }
  if (!response.ok) {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service rejected the audio.", 502)
  }
  const payload = await response.json().catch(() => null) as { text?: unknown } | null
  if (!payload || typeof payload.text !== "string") {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "Short dictation service returned an invalid response.", 502)
  }
  return { text: payload.text }
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) return "ogg"
  if (mimeType === "audio/mp4") return "m4a"
  if (mimeType === "audio/wav") return "wav"
  return "webm"
}
