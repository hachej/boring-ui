import type { FastifyRequest } from "fastify"
import { LiveTranscriptError } from "./errors"

export interface LiveTranscriptAuthority {
  listenerHost: string
  canonicalHost: string
  canonicalOrigin: string
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

export function validateLocalAuthority(authority: LiveTranscriptAuthority, upstreamUrl: string): void {
  let origin: URL
  let upstream: URL
  try {
    origin = new URL(authority.canonicalOrigin)
    upstream = new URL(upstreamUrl)
  } catch {
    throw new LiveTranscriptError("live_transcript_local_only", "Live transcript authority URLs are invalid.", 500)
  }
  if (
    !isLoopbackHost(authority.listenerHost)
    || !isLoopbackHost(origin.hostname)
    || origin.host !== authority.canonicalHost
    || !["http:", "https:"].includes(origin.protocol)
    || !isLoopbackHost(upstream.hostname)
    || !["ws:", "wss:"].includes(upstream.protocol)
    || upstream.pathname !== "/asr"
    || upstream.username
    || upstream.password
  ) {
    throw new LiveTranscriptError(
      "live_transcript_local_only",
      "Live transcripts require exact loopback listener, browser, and WhisperLiveKit authorities.",
      500,
    )
  }
}

export function assertExactOrigin(
  request: Pick<FastifyRequest, "headers">,
  authority: LiveTranscriptAuthority,
): void {
  if (request.headers.host !== authority.canonicalHost || request.headers.origin !== authority.canonicalOrigin) {
    throw new LiveTranscriptError(
      "live_transcript_local_only",
      "Live transcript request Host or Origin did not match the configured local authority.",
      403,
    )
  }
}
