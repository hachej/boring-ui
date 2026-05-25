import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from '../sse'
import type { UIMessageChunk } from '../sse'
import type { AgentHarness, RunContext } from '../../../shared/harness'
import type { SessionCtx } from '../../../shared/session'
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
import { StreamBufferStore } from '../streamBuffer'
import {
  parseFileChangeChunk,
  type SessionChangesTracker,
} from '../sessionChangesTracker'
import { projectPiDataMessages } from '../../harness/pi-coding-agent/projectPiDataMessages'

function c(data: Record<string, unknown>): UIMessageChunk {
  return data as unknown as UIMessageChunk
}

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
})

type ChatBody = z.infer<typeof chatBodySchema>

export interface ChatRouteOptions {
  harness?: AgentHarness
  workdir?: string
  getRuntime?: (request: FastifyRequest) => Promise<{
    harness: AgentHarness
    workdir: string
  }>
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
  const buffers = new StreamBufferStore()
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

  app.post(
    '/api/v1/agent/chat',
    { preHandler: validateBody },
    async (request, reply) => {
      const { sessionId, message, model, thinkingLevel, attachments } =
        request.body as ChatBody
      const turnId = randomUUID()
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

      const abortController = new AbortController()
      let streamStarted = false
      let streamCompleted = false
      // Abort only when the response stream connection closes while a turn is
      // still active. Using request.raw "close" can fire right after request-body
      // read on some clients/proxies, which prematurely aborts turns.
      reply.raw.on('close', () => {
        if (streamStarted && !streamCompleted && !abortController.signal.aborted) {
          abortController.abort()
        }
      })

      const buf = buffers.create(sessionId, turnId)

      try {
        const runtime = await resolveRuntime(request)
        const ctx: RunContext = {
          abortSignal: abortController.signal,
          workdir: runtime.workdir,
        }
        safeCapture(telemetry, {
          name: 'agent.chat.message.submitted',
          properties: telemetryProperties,
        })
        const chunks = runtime.harness.sendMessage(
          { sessionId, message, model, thinkingLevel, attachments },
          ctx,
        )

        const stream = createUIMessageStream({
          async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
            let streamFailed = false
            try {
              for await (const chunk of chunks) {
                const c = chunk as UIMessageChunk
                const fileChange = parseFileChangeChunk(c)
                if (fileChange) {
                  sessionChangesTracker?.record(sessionId, fileChange)
                }
                buf.append(c)
                writer.write(c)
              }
            } catch (err) {
              streamFailed = true
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
              const errChunk = {
                type: 'error',
                errorText: 'internal error',
              } as UIMessageChunk
              buf.append(errChunk)
              writer.write(errChunk)
            } finally {
              // Set streamCompleted BEFORE marking buffer complete so the
              // reply.raw 'close' event handler (which fires asynchronously
              // and may arrive before markComplete's callback) sees the flag
              // and does NOT abort an already-finished stream.
              streamCompleted = true
              if (!streamFailed) {
                safeCapture(telemetry, {
                  name: 'agent.chat.completed',
                  properties: {
                    ...telemetryProperties,
                    status: 'ok',
                    durationMs: Date.now() - startedAt,
                  },
                })
              }
              buf.markComplete(() => buffers.evict(sessionId, turnId))
            }
          },
        })

        streamStarted = true
        reply.hijack()
        pipeUIMessageStreamToResponse({
          response: reply.raw,
          stream,
          headers: {
            'X-Turn-Id': turnId,
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
        buf.markComplete(() => buffers.evict(sessionId, turnId))
        if (streamStarted) return
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

      const active = buffers.getActive(sessionId)

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

      const stream = createUIMessageStream({
        async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
          const replayed = buf.replay(cursor)
          for (const e of replayed) writer.write(e.chunk)
          if (buf.complete) return
          await new Promise<void>((resolve) => {
            const unsub = buf.subscribe(
              (e) => writer.write(e.chunk),
              () => {
                unsub()
                resolve()
              },
            )
            request.raw.on('close', () => {
              unsub()
              resolve()
            })
          })
        },
      })

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
        const runtime = await resolveRuntime(request)
        const detail = await runtime.harness.sessions.load(ctx, sessionId)
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
        const runtime = await resolveRuntime(request)
        if (runtime.harness.sessions.saveMessages) {
          await runtime.harness.sessions.saveMessages(ctx, sessionId, projectPiDataMessages(body.messages))
        }
        return reply.code(204).send()
      } catch {
        return reply.code(204).send()
      }
    },
  )

  done()
}
