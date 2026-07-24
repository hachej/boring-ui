import fastifyWebsocket from "@fastify/websocket"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { LIVE_TRANSCRIPT_BASE_PATH } from "../shared"
import { assertExactOrigin, validateLocalAuthority, type LiveTranscriptAuthority } from "./authority"
import { LiveTranscriptError, liveTranscriptErrorPayload } from "./errors"
import { LiveTranscriptManager, type LiveTranscriptManagerOptions } from "./manager"

export interface LiveTranscriptServerPluginOptions {
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  actorResolver: LiveTranscriptManagerOptions["actorResolver"]
  authority: LiveTranscriptAuthority
  upstreamUrl: string
  upstreamBearerToken?: string
  setupTimeoutMs?: number
  drainTimeoutMs?: number
  maxDurationMs?: number
  maxTranscriptBytes?: number
  maxUpstreamMessages?: number
  createUpstreamForTest?: LiveTranscriptManagerOptions["createUpstreamForTest"]
}

export function createLiveTranscriptServerPlugin(options: LiveTranscriptServerPluginOptions): WorkspaceServerPlugin {
  validateLocalAuthority(options.authority, options.upstreamUrl)
  const manager = new LiveTranscriptManager({
    dispatcherResolver: options.dispatcherResolver,
    actorResolver: options.actorResolver,
    upstreamUrl: options.upstreamUrl,
    upstreamBearerToken: options.upstreamBearerToken,
    setupTimeoutMs: options.setupTimeoutMs,
    drainTimeoutMs: options.drainTimeoutMs,
    maxDurationMs: options.maxDurationMs,
    maxTranscriptBytes: options.maxTranscriptBytes,
    maxUpstreamMessages: options.maxUpstreamMessages,
    createUpstreamForTest: options.createUpstreamForTest,
  })

  return defineServerPlugin({
    id: "live-transcription",
    label: "Live transcription",
    routes: async (app) => {
      await app.register(fastifyWebsocket)

      app.post(LIVE_TRANSCRIPT_BASE_PATH, async (request, reply) => withControl(request, reply, options.authority, async () => {
        const body = strictRecord(request.body, ["sessionId", "title"])
        if (typeof body.sessionId !== "string" || (body.title !== undefined && typeof body.title !== "string")) {
          throw new LiveTranscriptError("live_transcript_session_not_found", "A valid originating Pi session is required.", 400)
        }
        return await manager.start(request, { sessionId: body.sessionId, title: body.title as string | undefined })
      }))

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
        manager.status((request.params as { id: string }).id)
        return { message: "Transcript review is not available until Slice 3." }
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
export { parseWhisperLiveKitSnapshot, WhisperLiveKitConnection } from "./whisperLiveKit"
export { LiveTranscriptError } from "./errors"
export { isLoopbackHost, validateLocalAuthority } from "./authority"
export type { LiveTranscriptAuthority } from "./authority"
