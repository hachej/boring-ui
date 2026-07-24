import type { LiveTranscriptErrorCode } from "../shared"

export class LiveTranscriptError extends Error {
  constructor(
    readonly code: LiveTranscriptErrorCode,
    message: string,
    readonly statusCode = 500,
  ) {
    super(message)
    this.name = "LiveTranscriptError"
  }
}

export function liveTranscriptErrorPayload(error: unknown): {
  statusCode: number
  payload: { error: { code: LiveTranscriptErrorCode; message: string } }
} {
  const normalized = error instanceof LiveTranscriptError
    ? error
    : new LiveTranscriptError("live_transcript_upstream_failed", "Live transcript failed.", 500)
  return {
    statusCode: normalized.statusCode,
    payload: { error: { code: normalized.code, message: normalized.message } },
  }
}
