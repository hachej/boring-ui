import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from '../sse'
import type { UIMessageChunk } from '../sse'
import type { AgentHarness, RunContext } from '../../../shared/harness'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_RANGE_NOT_SATISFIABLE,
} from '../middleware'
import { StreamBufferStore } from '../streamBuffer'

const chatBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(100_000),
  model: z
    .object({
      provider: z.string().min(1),
      id: z.string().min(1),
    })
    .optional(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high']).optional(),
})

type ChatBody = z.infer<typeof chatBodySchema>

export interface ChatRouteOptions {
  harness: AgentHarness
  workdir: string
}

export function chatRoutes(
  app: FastifyInstance,
  opts: ChatRouteOptions,
  done: (err?: Error) => void,
): void {
  const { harness, workdir } = opts
  const validateBody = createBodyValidator(chatBodySchema)
  const buffers = new StreamBufferStore()

  app.post(
    '/api/v1/agent/chat',
    { preHandler: validateBody },
    async (request, reply) => {
      const { sessionId, message, model, thinkingLevel } =
        request.body as ChatBody
      const turnId = randomUUID()

      request.log.info({ sessionId, turnId, model, thinkingLevel }, '[chat] start')

      const abortController = new AbortController()
      let streamStarted = false
      request.raw.on('close', () => abortController.abort())

      const ctx: RunContext = {
        abortSignal: abortController.signal,
        workdir,
      }

      const buf = buffers.create(sessionId, turnId)

      try {
        const chunks = harness.sendMessage(
          { sessionId, message, model, thinkingLevel },
          ctx,
        )

        const stream = createUIMessageStream({
          async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
            try {
              for await (const chunk of chunks) {
                const c = chunk as UIMessageChunk
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
      const cursor = Number(
        (request.query as Record<string, string>).cursor ?? '-1',
      )
      const active = buffers.getActive(sessionId)

      if (!active) {
        try {
          const detail = await (harness.sessions as any).load(
            { workspaceId: 'default' },
            sessionId,
          )
          const stream = createUIMessageStream({
            async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
              for (const msg of detail.messages) {
                if (msg.role !== 'assistant') continue
                for (const part of (msg as any).parts) {
                  if (part.type === 'text')
                    writer.write({
                      type: 'text-delta',
                      delta: part.text,
                    } as UIMessageChunk)
                  if (part.type === 'tool-invocation') {
                    writer.write({
                      type: 'tool-input-available',
                      toolCallId: part.toolCallId,
                      toolName: part.toolName,
                      input: part.input,
                    } as UIMessageChunk)
                    if (part.state === 'output-available')
                      writer.write({
                        type: 'tool-output-available',
                        toolCallId: part.toolCallId,
                        output: part.output,
                      } as UIMessageChunk)
                  }
                }
                writer.write({ type: 'finish' } as UIMessageChunk)
              }
            },
          })
          reply.hijack()
          return pipeUIMessageStreamToResponse({
            response: reply.raw,
            stream,
          })
        } catch {
          return reply.code(204).send()
        }
      }

      const { buffer: buf } = active

      if (cursor >= 0 && cursor > buf.highIdx) {
        return reply.code(416).send({
          error: {
            code: ERROR_CODE_RANGE_NOT_SATISFIABLE,
            message: 'Cursor beyond buffer',
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
    },
  )

  done()
}
