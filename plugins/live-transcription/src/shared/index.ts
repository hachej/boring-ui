export const LIVE_TRANSCRIPT_BASE_PATH = "/api/v1/live-transcripts"
export const LIVE_PCM_SAMPLE_RATE = 16_000
export const LIVE_PCM_FRAME_SAMPLES = 1_600
export const LIVE_PCM_FRAME_BYTES = LIVE_PCM_FRAME_SAMPLES * 2
export const LIVE_SOCKET_HIGH_WATER_BYTES = 64 * 1024
export const LIVE_NONCE_BYTES = 32

export const LIVE_TRANSCRIPT_ERROR_CODES = [
  "live_transcript_disabled",
  "live_transcript_local_only",
  "live_transcript_already_active",
  "live_transcript_session_not_found",
  "live_transcript_attachment_invalid",
  "live_transcript_setup_timeout",
  "live_transcript_permission_denied",
  "live_transcript_attachment_failed",
  "live_transcript_invalid_audio",
  "live_transcript_backpressure",
  "live_transcript_limit_exceeded",
  "live_transcript_upstream_failed",
  "live_transcript_revision_conflict",
  "live_transcript_not_active",
] as const

export type LiveTranscriptErrorCode = typeof LIVE_TRANSCRIPT_ERROR_CODES[number]
export type LiveTranscriptState = "setup" | "active" | "stopping" | "complete" | "interrupted"

export interface LiveTranscriptStartResponse {
  liveSessionId: string
  transcriptPath: string
  socketNonce: string
  state: "setup"
}

export interface LiveTranscriptStatusResponse {
  active: boolean
  liveSessionId?: string
  transcriptPath?: string
  originatingSessionId?: string
  state?: LiveTranscriptState
  outcome?: LiveTranscriptErrorCode
  projectionRevision?: number
}

export interface LiveTranscriptTerminalResponse {
  liveSessionId: string
  transcriptPath: string
  state: "complete" | "interrupted"
  outcome?: LiveTranscriptErrorCode
  projectionRevision: number
}

export interface LiveTranscriptReadiness {
  ready: true
  commands: readonly ["/live start", "/live stop", "/live status", "/review transcript"]
}
