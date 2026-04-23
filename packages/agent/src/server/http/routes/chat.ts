import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createUIMessageStream, pipeUIMessageStreamToResponse } from '../sse'
import type { UIMessageChunk } from '../sse'
import type { AgentHarness, RunContext } from '../../../shared/harness'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
} from '../middleware'

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

  app.post(
    '/api/v1/agent/chat',
    { preHandler: validateBody },
    async (request, reply) => {
      const { sessionId, message, model, thinkingLevel } =
        request.body as ChatBody

      request.log.info({ sessionId, model, thinkingLevel }, '[chat] start')

      const abortController = new AbortController()
      let streamStarted = false
      request.raw.on('close', () => abortController.abort())

      const ctx: RunContext = {
        abortSignal: abortController.signal,
        workdir,
      }

      try {
        const chunks = harness.sendMessage(
          { sessionId, message, model, thinkingLevel },
          ctx,
        )

        const stream = createUIMessageStream({
          async execute({ writer }: { writer: { write(chunk: UIMessageChunk): void } }) {
            try {
              for await (const chunk of chunks) {
                writer.write(chunk as UIMessageChunk)
              }
            } catch (err) {
              request.log.error({ err, sessionId }, '[chat] stream error')
              writer.write({
                type: 'error',
                errorText: 'internal error',
              } as UIMessageChunk)
            }
          },
        })

        streamStarted = true
        reply.hijack()
        pipeUIMessageStreamToResponse({
          response: reply.raw,
          stream,
          headers: {
            'X-Accel-Buffering': 'no',
            'Cache-Control': 'no-cache, no-transform',
          },
        })
      } catch (err) {
        request.log.error({ err, sessionId }, '[chat] error')
        if (streamStarted) return
        return reply.code(500).send({
          error: { code: ERROR_CODE_INTERNAL, message: 'internal error' },
        })
      }
    },
  )

  done()
}
