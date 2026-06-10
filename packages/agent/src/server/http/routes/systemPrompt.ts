import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_NOT_IMPLEMENTED,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'
import type { AgentHarness } from '../../../shared/harness'

export interface SystemPromptRouteOptions {
  harness?: AgentHarness
  getHarness?: (request: FastifyRequest) => AgentHarness | Promise<AgentHarness>
}

/**
 * GET /api/v1/agent/sessions/:id/system-prompt
 *
 * Returns the resolved system prompt currently in effect for the given
 * pi session, or 404 if the underlying runtime hasn't materialised the
 * session yet (typical pre-first-turn state — pi creates lazily on first
 * first prompt). Hosts whose harness doesn't implement `getSystemPrompt`
 * get 501 — the capability simply isn't there.
 */
export function systemPromptRoutes(
  app: FastifyInstance,
  opts: SystemPromptRouteOptions,
  done: (err?: Error) => void,
): void {
  async function resolveHarness(request: FastifyRequest): Promise<AgentHarness> {
    if (opts.getHarness) return await opts.getHarness(request)
    if (opts.harness) return opts.harness
    throw new Error('system prompt route requires harness or getHarness')
  }

  app.get(
    '/api/v1/agent/sessions/:id/system-prompt',
    async (request, reply) => {
      const params = request.params as Record<string, unknown>
      const sessionId = params.id
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        return reply.code(400).send({
          error: {
            code: ERROR_CODE_VALIDATION_ERROR,
            message: 'id is required',
            field: 'id',
          },
        })
      }

      const harness = await resolveHarness(request)
      if (typeof harness.getSystemPrompt !== 'function') {
        return reply.code(501).send({
          error: {
            code: ERROR_CODE_NOT_IMPLEMENTED,
            message: 'harness does not expose system prompt',
          },
        })
      }

      const systemPrompt = harness.getSystemPrompt(sessionId)
      if (systemPrompt === undefined) {
        return reply.code(404).send({
          error: {
            code: ERROR_CODE_NOT_FOUND,
            message:
              'session has not been initialised yet — send a message to materialise it',
          },
        })
      }

      return reply.code(200).send({ systemPrompt })
    },
  )

  done()
}
