import fastifyWebsocket from "@fastify/websocket"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { LIVE_TRANSCRIPT_BASE_PATH } from "../shared"
import { assertExactOrigin, validateLocalAuthority, type LiveTranscriptAuthority } from "./authority"
import { LiveTranscriptError, liveTranscriptErrorPayload } from "./errors"
import { LiveTranscriptManager, type LiveTranscriptManagerOptions } from "./manager"
import { KyutaiComposerManager } from "./kyutaiComposer"
import { transcribeShortDictation } from "./dictation"

export interface LiveTranscriptServerPluginOptions {
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  agentTypeId?: string
  actorResolver: LiveTranscriptManagerOptions["actorResolver"]
  authority: LiveTranscriptAuthority
  upstreamUrl: string
  /** Default is WhisperLiveKit; Kyutai uses the moshi-server MessagePack protocol. */
  upstreamProvider?: "whisperlivekit" | "kyutai"
  upstreamBearerToken?: string
  /** Optional WhisperLiveKit `/asr` endpoint used only to label `/live` Kyutai words. */
  diarizerUrl?: string
  diarizerBearerToken?: string
  setupTimeoutMs?: number
  drainTimeoutMs?: number
  maxDurationMs?: number
  maxTranscriptBytes?: number
  maxUpstreamMessages?: number
  reviewIntervalMs?: number
  reviewRetryMs?: number
  createUpstreamForTest?: LiveTranscriptManagerOptions["createUpstreamForTest"]
  dictationFetch?: typeof fetch
}

export function createLiveTranscriptServerPlugin(options: LiveTranscriptServerPluginOptions): WorkspaceServerPlugin {
  validateLocalAuthority(options.authority, options.upstreamUrl, options.upstreamProvider)
  if (options.diarizerUrl) validateLocalAuthority(options.authority, options.diarizerUrl, "whisperlivekit")
  const manager = new LiveTranscriptManager({
    dispatcherResolver: options.dispatcherResolver,
    agentTypeId: options.agentTypeId,
    actorResolver: options.actorResolver,
    upstreamUrl: options.upstreamUrl,
    upstreamProvider: options.upstreamProvider,
    upstreamBearerToken: options.upstreamBearerToken,
    diarizerUrl: options.diarizerUrl,
    diarizerBearerToken: options.diarizerBearerToken,
    setupTimeoutMs: options.setupTimeoutMs,
    drainTimeoutMs: options.drainTimeoutMs,
    maxDurationMs: options.maxDurationMs,
    maxTranscriptBytes: options.maxTranscriptBytes,
    maxUpstreamMessages: options.maxUpstreamMessages,
    reviewIntervalMs: options.reviewIntervalMs,
    reviewRetryMs: options.reviewRetryMs,
    createUpstreamForTest: options.createUpstreamForTest,
  })
  const composerManager = options.upstreamProvider === "kyutai"
    ? new KyutaiComposerManager({
        upstreamUrl: options.upstreamUrl,
        apiKey: options.upstreamBearerToken,
        setupTimeoutMs: options.setupTimeoutMs,
        drainTimeoutMs: options.drainTimeoutMs,
        maxDurationMs: options.maxDurationMs,
      })
    : undefined

  return defineServerPlugin({
    id: "live-transcription",
    label: "Live transcription",
    getAgentReloadBlock: () => manager.getAgentReloadBlock(),
    routes: async (app) => {
      await app.register(fastifyWebsocket)

      app.post(LIVE_TRANSCRIPT_BASE_PATH, async (request, reply) => withControl(request, reply, options.authority, async () => {
        const body = strictRecord(request.body, ["sessionId", "title"])
        if (typeof body.sessionId !== "string" || (body.title !== undefined && typeof body.title !== "string")) {
          throw new LiveTranscriptError("live_transcript_session_not_found", "A valid originating Pi session is required.", 400)
        }
        if (composerManager?.isActive) throw new LiveTranscriptError("live_transcript_already_active", "A composer microphone stream is already active.", 409)
        return await manager.start(request, { sessionId: body.sessionId, title: body.title as string | undefined })
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/dictate`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        const body = strictRecord(request.body, ["mimeType", "audioBase64"])
        if (typeof body.mimeType !== "string" || typeof body.audioBase64 !== "string") {
          throw new LiveTranscriptError("live_transcript_invalid_audio", "Short dictation request was invalid.", 400)
        }
        if (options.upstreamProvider === "kyutai") {
          throw new LiveTranscriptError("live_transcript_disabled", "Short dictation is unavailable with Kyutai; start a live transcript instead.", 409)
        }
        return await transcribeShortDictation({
          upstreamWebSocketUrl: options.upstreamUrl,
          bearerToken: options.upstreamBearerToken,
          mimeType: body.mimeType,
          audioBase64: body.audioBase64,
          fetch: options.dictationFetch,
        })
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/composer`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        strictEmptyBody(request.body)
        if (!composerManager) throw new LiveTranscriptError("live_transcript_disabled", "Streaming composer dictation requires Kyutai.", 409)
        if (manager.getAgentReloadBlock()) throw new LiveTranscriptError("live_transcript_already_active", "A live transcript is already active.", 409)
        return composerManager.start()
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/composer/:id/stop`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        strictEmptyBody(request.body)
        if (!composerManager) throw new LiveTranscriptError("live_transcript_disabled", "Streaming composer dictation requires Kyutai.", 409)
        return await composerManager.stop((request.params as { id: string }).id)
      }))

      app.get(`${LIVE_TRANSCRIPT_BASE_PATH}/composer/:id/audio`, {
        websocket: true,
        preValidation: async (request, reply) => {
          try {
            assertExactOrigin(request, options.authority)
            if (request.url.includes("?")) throw new LiveTranscriptError("live_transcript_attachment_invalid", "Composer audio WebSocket query parameters are not allowed.", 400)
          } catch (error) {
            const normalized = liveTranscriptErrorPayload(error)
            return reply.code(normalized.statusCode).send(normalized.payload)
          }
        },
      }, (socket, request) => {
        if (!composerManager) return socket.close(4403, "live_transcript_disabled")
        composerManager.handleSocket((request.params as { id: string }).id, socket)
      })

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/status`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        const body = request.body === undefined ? {} : strictRecord(request.body, ["liveSessionId"])
        if (body.liveSessionId !== undefined && typeof body.liveSessionId !== "string") {
          throw new LiveTranscriptError("live_transcript_not_active", "Live session id was invalid.", 400)
        }
        return manager.status(body.liveSessionId as string | undefined)
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/:id/stop`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        strictEmptyBody(request.body)
        return await manager.stop((request.params as { id: string }).id)
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/:id/review`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        strictEmptyBody(request.body)
        return await manager.review((request.params as { id: string }).id)
      }))

      app.post(`${LIVE_TRANSCRIPT_BASE_PATH}/:id/interrupt`, async (request, reply) => withControl(request, reply, options.authority, async () => {
        const body = strictRecord(request.body, ["reason"])
        if (body.reason !== "permission_denied" && body.reason !== "attachment_failed") {
          throw new LiveTranscriptError("live_transcript_attachment_failed", "Interrupt reason was invalid.", 400)
        }
        return await manager.interruptBeforeAttachment((request.params as { id: string }).id, body.reason)
      }))

      app.get(`${LIVE_TRANSCRIPT_BASE_PATH}/:id/audio`, {
        websocket: true,
        preValidation: async (request, reply) => {
          try {
            assertExactOrigin(request, options.authority)
            if (request.url.includes("?")) {
              throw new LiveTranscriptError("live_transcript_attachment_invalid", "Audio WebSocket query parameters are not allowed.", 400)
            }
          } catch (error) {
            const normalized = liveTranscriptErrorPayload(error)
            return reply.code(normalized.statusCode).send(normalized.payload)
          }
        },
      }, (socket, request) => {
        manager.handleBrowserSocket((request.params as { id: string }).id, socket)
      })

      app.addHook("onClose", async () => {
        composerManager?.close()
        await manager.close()
      })
    },
  })
}

async function withControl(
  request: FastifyRequest,
  reply: FastifyReply,
  authority: LiveTranscriptAuthority,
  run: () => Promise<unknown>,
): Promise<unknown> {
  try {
    assertExactOrigin(request, authority)
    return await run()
  } catch (error) {
    const normalized = liveTranscriptErrorPayload(error)
    return reply.code(normalized.statusCode).send(normalized.payload)
  }
}

function strictRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LiveTranscriptError("live_transcript_disabled", "Live transcript request body was invalid.", 400)
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    throw new LiveTranscriptError("live_transcript_disabled", "Live transcript request body contained unsupported fields.", 400)
  }
  return record
}

function strictEmptyBody(value: unknown): void {
  if (value === undefined || value === null) return
  const record = strictRecord(value, [])
  if (Object.keys(record).length > 0) {
    throw new LiveTranscriptError("live_transcript_disabled", "Live transcript request body must be empty.", 400)
  }
}

export { LiveTranscriptManager } from "./manager"
export { LiveTranscriptProjector, renderTranscriptMarkdown } from "./projector"
export { KyutaiConnection, resamplePcm16ToFloat32 } from "./kyutai"
export { KyutaiComposerManager } from "./kyutaiComposer"
export { parseWhisperLiveKitSnapshot, WhisperLiveKitConnection } from "./whisperLiveKit"
export { LiveTranscriptError } from "./errors"
export { LiveReviewBroker } from "./reviewBroker"
export { transcribeShortDictation } from "./dictation"
export { isLoopbackHost, validateLocalAuthority } from "./authority"
export type { LiveTranscriptAuthority } from "./authority"
