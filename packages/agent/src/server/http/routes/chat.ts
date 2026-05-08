import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from '../sse'
import type { UIMessageChunk } from '../sse'
import type { AgentHarness, RunContext } from '../../../shared/harness'
import type { SessionCtx } from '../../../shared/session'
import type { UIMessage } from '../../../shared/message'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
  ERROR_CODE_RANGE_NOT_SATISFIABLE,
} from '../middleware'
import { StreamBufferStore } from '../streamBuffer'
import {
  parseFileChangeChunk,
  type SessionChangesTracker,
} from '../sessionChangesTracker'

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
}

export function chatRoutes(
  app: FastifyInstance,
  opts: ChatRouteOptions,
  done: (err?: Error) => void,
): void {
  const { sessionChangesTracker } = opts
  const validateBody = createBodyValidator(chatBodySchema)
  const buffers = new StreamBufferStore()

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

      request.log.info({ sessionId, turnId, model, thinkingLevel }, '[chat] start')
      const runtime = await resolveRuntime(request)

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

      const ctx: RunContext = {
        abortSignal: abortController.signal,
        workdir: runtime.workdir,
      }

      const buf = buffers.create(sessionId, turnId)

      try {
        const chunks = runtime.harness.sendMessage(
          { sessionId, message, model, thinkingLevel, attachments },
          ctx,
        )

        const stream = createUIMessageStream({
          async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
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
              request.log.error({ err, sessionId }, '[chat] stream error')
              const errChunk = {
                type: 'error',
                errorText: 'internal error',
              } as UIMessageChunk
              buf.append(errChunk)
              writer.write(errChunk)
            } finally {
              streamCompleted = true
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
      const body = request.body as { message?: unknown }
      if (typeof body?.message !== 'string' || body.message.length === 0) {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'message is required' },
        })
      }
      const runtime = await resolveRuntime(request)
      runtime.harness.followUp?.(sessionId, body.message)
      return reply.code(202).send({ queued: true })
    },
  )

  // Discard any queued follow-up (Stop button path).
  app.delete(
    '/api/v1/agent/chat/:sessionId/followup',
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const runtime = await resolveRuntime(request)
      runtime.harness.clearFollowUp?.(sessionId)
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
          await runtime.harness.sessions.saveMessages(ctx, sessionId, body.messages)
        }
        return reply.code(204).send()
      } catch {
        return reply.code(204).send()
      }
    },
  )

  done()
}
