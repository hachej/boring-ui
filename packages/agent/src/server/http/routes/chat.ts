import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { pipeUIMessageStreamToResponse } from '../sse'
import type { AgentHarness } from '../../../shared/harness'
import type { SessionCtx, SessionStore } from '../../../shared/session'
import type { UIMessage } from '../../../shared/message'
import { ErrorCode } from '../../../shared/error-codes'
import { noopTelemetry, safeCapture, type TelemetrySink } from '../../../shared/telemetry'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
  ERROR_CODE_RANGE_NOT_SATISFIABLE,
  ERROR_CODE_CONFLICT,
} from '../middleware'
import type { SessionChangesTracker } from '../sessionChangesTracker'
import { createBufferedUiMessageStream, TurnManager } from '../turnManager'
import { projectPiDataMessages } from '../../harness/pi-coding-agent/projectPiDataMessages'

const chatBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(1_000_000),
  model: z
    .object({
      provider: z.string().min(1),
      id: z.string().min(1),
    })
    .optional(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high']).optional(),
  // Attachments metadata (data URLs or remote URLs). The client already
  // inlines text attachments into `message`; this field keeps the structured
  // list around so vision-capable models can later be fed image parts
  // directly without losing provenance.
  attachments: z
    .array(
      z.object({
        filename: z.string().optional(),
        mediaType: z.string().optional(),
        url: z.string(),
      }),
    )
    .max(20)
    .optional(),
  clientTurnId: z.string().min(1).max(128).optional(),
})

type ChatBody = z.infer<typeof chatBodySchema>

export interface ChatRouteOptions {
  harness?: AgentHarness
  workdir?: string
  sessionStore?: SessionStore
  getRuntime?: (request: FastifyRequest) => Promise<{
    harness: AgentHarness
    workdir: string
  }>
  getSessionStore?: (request: FastifyRequest) => Promise<SessionStore>
  sessionChangesTracker?: SessionChangesTracker
  telemetry?: TelemetrySink
}

function addTelemetryProperty(
  properties: Record<string, string | number>,
  key: string,
  value: unknown,
): void {
  if (typeof value === 'string' && value) properties[key] = value
  if (typeof value === 'number' && Number.isFinite(value)) properties[key] = value
}

function safeTelemetryErrorCode(value: unknown): string {
  const parsed = ErrorCode.safeParse(value)
  return parsed.success ? parsed.data : ErrorCode.enum.INTERNAL_ERROR
}

export function chatRoutes(
  app: FastifyInstance,
  opts: ChatRouteOptions,
  done: (err?: Error) => void,
): void {
  const { sessionChangesTracker } = opts
  const telemetry = opts.telemetry ?? noopTelemetry
  const validateBody = createBodyValidator(chatBodySchema)
  const turnManager = new TurnManager()
  // Track last follow-up seq/nonce per session for dedupe detection.
  // Evict entries when sessions are deleted via the sessionChangesTracker
  // hook below, and cap at 5000 to bound memory in long-running servers.
  const lastFollowUpBySession = new Map<string, { seq: number; nonce?: string }>()
  const cancelledFollowUpsBySession = new Map<string, Set<string>>()
  const MAX_FOLLOWUP_CACHE = 5000
  function followUpCancelKeys(clientNonce?: string, clientSeq?: number): string[] {
    return [
      clientNonce ? `nonce:${clientNonce}` : undefined,
      clientSeq !== undefined ? `seq:${clientSeq}` : undefined,
    ].filter((key): key is string => Boolean(key))
  }
  function isFollowUpCancelled(sessionId: string, clientNonce?: string, clientSeq?: number): boolean {
    const cancelled = cancelledFollowUpsBySession.get(sessionId)
    if (!cancelled) return false
    return followUpCancelKeys(clientNonce, clientSeq).some((key) => cancelled.has(key))
  }
  function markFollowUpCancelled(sessionId: string, clientNonce?: string, clientSeq?: number): void {
    const keys = followUpCancelKeys(clientNonce, clientSeq)
    if (keys.length === 0) return
    const cancelled = cancelledFollowUpsBySession.get(sessionId) ?? new Set<string>()
    for (const key of keys) cancelled.add(key)
    cancelledFollowUpsBySession.set(sessionId, cancelled)
  }
  function evictFollowupCache(): void {
    const keys = Array.from(new Set([...lastFollowUpBySession.keys(), ...cancelledFollowUpsBySession.keys()]))
    if (keys.length <= MAX_FOLLOWUP_CACHE) return
    for (let i = 0; i < keys.length - MAX_FOLLOWUP_CACHE; i++) {
      lastFollowUpBySession.delete(keys[i])
      cancelledFollowUpsBySession.delete(keys[i])
    }
  }

  async function resolveRuntime(request: FastifyRequest): Promise<{
    harness: AgentHarness
    workdir: string
  }> {
    if (opts.getRuntime) return await opts.getRuntime(request)
    if (opts.harness && opts.workdir) {
      return { harness: opts.harness, workdir: opts.workdir }
    }
    throw new Error('chat route requires harness/workdir or getRuntime')
  }

  async function resolveSessionStore(request: FastifyRequest): Promise<SessionStore> {
    if (opts.getSessionStore) return await opts.getSessionStore(request)
    if (opts.sessionStore) return opts.sessionStore
    const runtime = await resolveRuntime(request)
    return runtime.harness.sessions as unknown as SessionStore
  }

  app.post(
    '/api/v1/agent/chat',
    { preHandler: validateBody },
    async (request, reply) => {
      const { sessionId, message, model, thinkingLevel, attachments, clientTurnId } =
        request.body as ChatBody
      const turnId = clientTurnId ?? randomUUID()
      const startedAt = Date.now()
      const telemetryProperties: Record<string, string | number> = {
        sessionId,
        requestId: request.id,
      }
      addTelemetryProperty(telemetryProperties, 'workspaceId', request.workspaceContext?.workspaceId)
      addTelemetryProperty(telemetryProperties, 'modelProvider', model?.provider)

      request.log.info({ sessionId, turnId, model, thinkingLevel }, '[chat] start')
      safeCapture(telemetry, {
        name: 'agent.chat.started',
        properties: telemetryProperties,
      })

      try {
        const startedTurn = await turnManager.startTurn({
          sessionId,
          turnId,
          input: { sessionId, message, model, thinkingLevel, attachments },
          resolveRuntime: () => resolveRuntime(request),
          sessionChangesTracker,
          onSubmitted: () => {
            safeCapture(telemetry, {
              name: 'agent.chat.message.submitted',
              properties: telemetryProperties,
            })
          },
          onStreamError: (err) => {
            request.log.error({ err, sessionId }, '[chat] stream error')
            safeCapture(telemetry, {
              name: 'agent.chat.failed',
              properties: {
                ...telemetryProperties,
                status: 'error',
                durationMs: Date.now() - startedAt,
                errorCode: ErrorCode.enum.INTERNAL_ERROR,
              },
            })
          },
          onStreamComplete: () => {
            safeCapture(telemetry, {
              name: 'agent.chat.completed',
              properties: {
                ...telemetryProperties,
                status: 'ok',
                durationMs: Date.now() - startedAt,
              },
            })
          },
        })

        if ('active' in startedTurn) {
          return reply.code(409).send({
            error: {
              code: ERROR_CODE_CONFLICT,
              message: 'turn_already_active',
            },
          })
        }

        // Decouple the harness turn from the browser response. Session switches
        // and reloads close the current HTTP response; that must not abort the
        // agent turn or leave a half-persisted user message behind. The running
        // turn pumps into the replay buffer, while each client response only
        // subscribes to that buffer and can disconnect independently.
        const stream = createBufferedUiMessageStream(startedTurn.buffer, request.raw)

        reply.hijack()
        pipeUIMessageStreamToResponse({
          response: reply.raw,
          stream,
          headers: {
            'X-Turn-Id': startedTurn.turnId,
            'X-Accel-Buffering': 'no',
            'Cache-Control': 'no-cache, no-transform',
          },
        })
        // Flush headers immediately so clients don't have to wait for the
        // first LLM chunk before the response starts (improves perceived latency
        // and lets clients read X-Turn-Id without a round-trip delay).
        reply.raw.flushHeaders()
        return
      } catch (err) {
        request.log.error({ err, sessionId }, '[chat] error')
        safeCapture(telemetry, {
          name: 'agent.chat.failed',
          properties: {
            ...telemetryProperties,
            status: 'error',
            durationMs: Date.now() - startedAt,
            errorCode: safeTelemetryErrorCode((err as { code?: unknown })?.code),
          },
        })
        const statusCode = (err as { statusCode?: unknown })?.statusCode
        const stableCode = (err as { code?: unknown })?.code
        if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
          return reply.code(statusCode).send({
            error: {
              code: typeof stableCode === 'string' ? stableCode : ERROR_CODE_INTERNAL,
              message: err instanceof Error ? err.message : 'chat route failed',
              details: (err as { details?: unknown })?.details,
            },
          })
        }
        return reply.code(500).send({
          error: { code: ERROR_CODE_INTERNAL, message: 'internal error' },
        })
      }
    },
  )

  app.get(
    '/api/v1/agent/chat/:sessionId/stream',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const raw = (request.query as Record<string, string>).cursor
      const cursor = raw === undefined ? -1 : Number(raw)

      if (!Number.isInteger(cursor) || cursor < -1) {
        return reply.code(400).send({
          error: {
            code: ERROR_CODE_VALIDATION_ERROR,
            message: 'cursor must be an integer >= -1',
          },
        })
      }

      const active = turnManager.getActive(sessionId)

      if (!active) {
        // No active streaming turn to resume. History hydration goes through
        // the /messages JSON endpoint below, not this stream. Return 204 so
        // useChat({ resume: true }) knows there's nothing live to resume.
        return reply.code(204).send()
      }

      const { buffer: buf } = active

      if (cursor > buf.highIdx || (cursor >= 0 && buf.minIdx > 0 && cursor < buf.minIdx - 1)) {
        return reply.code(416).send({
          error: {
            code: ERROR_CODE_RANGE_NOT_SATISFIABLE,
            message: 'Cursor outside buffer range',
          },
        })
      }

      request.log.info(
        { sessionId, cursor, bufHigh: buf.highIdx },
        '[resume] replaying',
      )

      const stream = createBufferedUiMessageStream(buf, request.raw, cursor)

      reply.hijack()
      pipeUIMessageStreamToResponse({
        response: reply.raw,
        stream,
        headers: {
          'X-Accel-Buffering': 'no',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
      return
    },
  )

  app.get(
    '/api/v1/agent/chat/:sessionId/messages',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const ctx: SessionCtx = {
        workspaceId: request.workspaceContext?.workspaceId ?? 'default',
      }
      try {
        const store = await resolveSessionStore(request)
        const detail = await store.load(ctx, sessionId)
        const messages = Array.isArray(detail?.messages) ? detail.messages : []
        return reply.code(200).send({ messages })
      } catch {
        // History hydration is best-effort: a missing session has no persisted
        // messages yet. Return an empty history without surfacing a browser
        // console 404 during first-load auto session creation.
        return reply.code(200).send({ messages: [] })
      }
    },
  )

  app.delete(
    '/api/v1/agent/chat/:sessionId/turn',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const query = request.query as { turnId?: unknown }
      const requestedTurnId = typeof query.turnId === 'string' && query.turnId.length > 0
        ? query.turnId
        : undefined
      turnManager.abortTurn(sessionId, requestedTurnId)
      return reply.code(204).send()
    },
  )

  // Queue a follow-up message to be delivered after the current streaming
  // turn completes. The harness keeps the HTTP stream open and processes it
  // as a second pi turn, emitting data-followup-consumed before it starts so
  // the client knows to clear its pending-message bubble.
  app.post(
    '/api/v1/agent/chat/:sessionId/followup',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const body = request.body as { message?: unknown; attachments?: unknown; displayText?: unknown; clientNonce?: unknown; clientSeq?: unknown }
      if (typeof body?.message !== 'string' || body.message.length === 0) {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'message is required' },
        })
      }
      const parsedAttachments = chatBodySchema.shape.attachments.safeParse(body.attachments)
      if (!parsedAttachments.success) {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'attachments is invalid' },
        })
      }
      const clientSeq = typeof body.clientSeq === 'number' && Number.isFinite(body.clientSeq)
        ? body.clientSeq
        : undefined
      const clientNonce = typeof body.clientNonce === 'string' && body.clientNonce.length > 0 ? body.clientNonce : undefined
      if (isFollowUpCancelled(sessionId, clientNonce, clientSeq)) {
        return reply.code(202).send({ queued: false, deleted: true })
      }
      if (clientSeq !== undefined) {
        const last = lastFollowUpBySession.get(sessionId)
        if (last !== undefined && clientSeq <= last.seq) {
          if (clientSeq === last.seq && clientNonce && clientNonce === last.nonce) {
            return reply.code(202).send({ queued: true, duplicate: true })
          }
          return reply.code(409).send({
            error: { code: ERROR_CODE_CONFLICT, message: 'followup_out_of_order' },
          })
        }
      }
      const runtime = await resolveRuntime(request)
      if (!runtime.harness.followUp) {
        return reply.code(409).send({
          error: { code: ERROR_CODE_CONFLICT, message: 'followup_unsupported' },
        })
      }
      try {
        await runtime.harness.followUp(
          sessionId,
          body.message,
          parsedAttachments.data,
          typeof body.displayText === 'string' && body.displayText.length > 0 ? body.displayText : body.message,
          { clientNonce, clientSeq },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'followup_session_not_ready') {
          return reply.code(409).send({
            error: { code: ERROR_CODE_CONFLICT, message: 'followup_session_not_ready' },
          })
        }
        throw err
      }
      if (clientSeq !== undefined) {
        lastFollowUpBySession.set(sessionId, { seq: clientSeq, nonce: clientNonce })
        evictFollowupCache()
      }
      return reply.code(202).send({ queued: true })
    },
  )

  // Discard any queued follow-up (Stop button path).
  app.delete(
    '/api/v1/agent/chat/:sessionId/followup',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const query = request.query as { clientNonce?: unknown; clientSeq?: unknown }
      const clientNonce = typeof query.clientNonce === 'string' && query.clientNonce.length > 0 ? query.clientNonce : undefined
      const rawClientSeq = typeof query.clientSeq === 'string' ? Number(query.clientSeq) : query.clientSeq
      const clientSeq = typeof rawClientSeq === 'number' && Number.isFinite(rawClientSeq) ? rawClientSeq : undefined
      const runtime = await resolveRuntime(request)
      markFollowUpCancelled(sessionId, clientNonce, clientSeq)
      evictFollowupCache()
      runtime.harness.clearFollowUp?.(sessionId, { clientNonce, clientSeq })
      return reply.code(204).send()
    },
  )

  // Client pushes a snapshot of UI messages after each completed turn so the
  // server can persist them. On reload the GET /messages endpoint returns
  // these instead of reconstructing from pi's (in-memory) native format.
  app.put(
    '/api/v1/agent/chat/:sessionId/messages',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const body = request.body as { messages?: UIMessage[] }
      if (!Array.isArray(body?.messages)) {
        return reply.code(400).send({ error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'messages must be an array' } })
      }
      const ctx: SessionCtx = {
        workspaceId: request.workspaceContext?.workspaceId ?? 'default',
      }
      try {
        const store = await resolveSessionStore(request)
        if (store.saveMessages) {
          await store.saveMessages(ctx, sessionId, projectPiDataMessages(body.messages))
        }
        return reply.code(204).send()
      } catch {
        return reply.code(204).send()
      }
    },
  )

  done()
}
