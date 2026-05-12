import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from '../sse'
import type { UIMessageChunk } from '../sse'
import type { AgentHarness, RunContext } from '../../../shared/harness'
import type { SessionCtx } from '../../../shared/session'
import type { UIMessage } from '../../../shared/message'
import { DEFAULT_AGENT_RUNTIME_CAPABILITIES, type AgentRuntimeCapabilities } from '../../../shared/capabilities'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
  ERROR_CODE_RANGE_NOT_SATISFIABLE,
  ERROR_CODE_CONFLICT,
  ERROR_CODE_FOLLOWUP_UNSUPPORTED,
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

type PiDataPart = { type?: string; data?: Record<string, unknown> }

function capabilitiesForHarness(harness: AgentHarness): AgentRuntimeCapabilities {
  return harness.capabilities ?? DEFAULT_AGENT_RUNTIME_CAPABILITIES
}

function projectPiDataMessages(messages: UIMessage[]): UIMessage[] {
  const dataParts = messages.flatMap((message) => message.parts ?? []).filter((part) => {
    const type = (part as { type?: unknown }).type
    return typeof type === 'string' && type.startsWith('data-pi-')
  }) as PiDataPart[]
  if (dataParts.length === 0) return messages
  const projected: UIMessage[] = []
  const ensureMessage = (id: string, role: 'user' | 'assistant', text = ''): UIMessage => {
    let msg = projected.find((item) => item.id === id)
    if (!msg) {
      msg = { id, role, parts: text ? [{ type: 'text' as const, text }] : [] }
      projected.push(msg)
    } else if (text && !(msg.parts ?? []).some((part) => part.type === 'text' && part.text)) {
      msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
    }
    return msg
  }
  for (const part of dataParts) {
    const data = part.data ?? {}
    const messageId = typeof data.messageId === 'string' ? data.messageId : undefined
    if (!messageId) continue
    if (part.type === 'data-pi-message-start' && (data.role === 'user' || data.role === 'assistant')) {
      ensureMessage(messageId, data.role, typeof data.text === 'string' ? data.text : '')
    } else if (part.type === 'data-pi-text-start') {
      const msg = ensureMessage(messageId, 'assistant')
      if (!msg.parts?.some((p) => p.type === 'text')) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text: '' }]
    } else if (part.type === 'data-pi-text-delta') {
      const msg = ensureMessage(messageId, 'assistant')
      const delta = typeof data.delta === 'string' ? data.delta : ''
      const index = (msg.parts ?? []).findIndex((p) => p.type === 'text')
      if (index >= 0) {
        msg.parts = (msg.parts ?? []).map((p, i) => i === index && p.type === 'text' ? { ...p, text: `${p.text}${delta}` } : p)
      } else {
        msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text: delta }]
      }
    } else if (part.type === 'data-pi-text-end' || (part.type === 'data-pi-message-end' && data.role === 'assistant')) {
      const msg = ensureMessage(messageId, 'assistant')
      const text = typeof data.text === 'string' ? data.text : ''
      if (text && !(msg.parts ?? []).some((p) => p.type === 'text' && p.text)) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
    }
  }
  if (projected.length === 0) return messages
  const projectedIds = new Set(projected.map((message) => message.id))
  const preserved = messages.filter((message) => {
    if (projectedIds.has(message.id)) return false
    return !(message.parts ?? []).some((part) => {
      const type = (part as { type?: unknown }).type
      return typeof type === 'string' && type.startsWith('data-pi-')
    })
  })
  return [...preserved, ...projected]
}

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
  const lastFollowUpBySession = new Map<string, { seq: number; nonce?: string }>()

  function followUpStateKey(request: FastifyRequest, sessionId: string): string {
    return `${request.workspaceContext?.workspaceId ?? 'default'}\0${sessionId}`
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

  app.get('/api/v1/agent/capabilities', async (request, reply) => {
    const runtime = await resolveRuntime(request)
    return reply.code(200).send(capabilitiesForHarness(runtime.harness))
  })

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
        return reply.code(200).send({ messages, capabilities: capabilitiesForHarness(runtime.harness) })
      } catch {
        // History hydration is best-effort: a missing session has no persisted
        // messages yet. Return an empty history without surfacing a browser
        // console 404 during first-load auto session creation.
        try {
          const runtime = await resolveRuntime(request)
          return reply.code(200).send({ messages: [], capabilities: capabilitiesForHarness(runtime.harness) })
        } catch {
          return reply.code(200).send({ messages: [], capabilities: { protocol: 'ai-sdk' } satisfies AgentRuntimeCapabilities })
        }
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
      const runtime = await resolveRuntime(request)
      const capabilities = capabilitiesForHarness(runtime.harness)
      if (capabilities.protocol !== 'pi-native' || !runtime.harness.followUp) {
        return reply.code(409).send({
          error: { code: ERROR_CODE_FOLLOWUP_UNSUPPORTED, message: 'follow-up is not supported by this runtime' },
        })
      }
      const clientSeq = typeof body.clientSeq === 'number' && Number.isFinite(body.clientSeq)
        ? body.clientSeq
        : undefined
      const clientNonce = typeof body.clientNonce === 'string' && body.clientNonce.length > 0 ? body.clientNonce : undefined
      const followUpKey = followUpStateKey(request, sessionId)
      if (clientSeq !== undefined) {
        const last = lastFollowUpBySession.get(followUpKey)
        if (last !== undefined && clientSeq <= last.seq) {
          if (clientSeq === last.seq && clientNonce && clientNonce === last.nonce) {
            return reply.code(202).send({ queued: true, duplicate: true })
          }
          return reply.code(409).send({
            error: { code: ERROR_CODE_CONFLICT, message: 'followup_out_of_order' },
          })
        }
        // Reserve the sequence before awaiting the runtime so duplicate
        // retries racing this request are idempotent, but roll it back if the
        // runtime rejects and no later request has advanced the sequence.
        lastFollowUpBySession.set(followUpKey, { seq: clientSeq, nonce: clientNonce })
      }
      try {
        await runtime.harness.followUp(
          sessionId,
          body.message,
          parsedAttachments.data,
          typeof body.displayText === 'string' && body.displayText.length > 0 ? body.displayText : body.message,
        )
      } catch (err) {
        if (clientSeq !== undefined) {
          const last = lastFollowUpBySession.get(followUpKey)
          if (last?.seq === clientSeq && last.nonce === clientNonce) lastFollowUpBySession.delete(followUpKey)
        }
        throw err
      }
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
          const capabilities = capabilitiesForHarness(runtime.harness)
          const messages = capabilities.protocol === 'pi-native'
            ? projectPiDataMessages(body.messages)
            : body.messages
          await runtime.harness.sessions.saveMessages(ctx, sessionId, messages)
        }
        return reply.code(204).send()
      } catch {
        return reply.code(204).send()
      }
    },
  )

  done()
}
