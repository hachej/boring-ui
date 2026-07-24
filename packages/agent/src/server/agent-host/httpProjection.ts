import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { AgentGatewayError, type AgentGateway } from '../../shared/index'
import type { AgentHostHandle, AgentHostHttpProjectionOptions } from './types'

interface ProjectionInput {
  readonly host: AgentHostHandle
  readonly gateway: AgentGateway
  readonly options: AgentHostHttpProjectionOptions
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentGatewayError) {
    const status = error.code === 'AGENT_SCOPE_DENIED' ? 403
      : error.code === 'AGENT_SESSION_NOT_FOUND' || error.code === 'AGENT_TYPE_UNKNOWN' ? 404
        : error.code === 'AGENT_REQUEST_CONFLICT' || error.code.includes('CURSOR') || error.code.includes('REPLAY') ? 409
          : error.code === 'AGENT_GATEWAY_CLOSED' ? 503
            : 400
    return reply.code(status).send({ error: error.toJSON() })
  }
  throw error
}

/** Awaited Fastify projection for the addressed Gateway surface. */
export function createAgentHostRoutes(input: ProjectionInput): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preClose', async () => {
      await input.host.drain()
    })
    app.addHook('onClose', async () => {
      await input.host.close()
    })

    app.get('/api/v1/agents', async (request, reply) => {
      try {
        return await input.gateway.listAgents({ scope: await input.options.authorizeRequest(request) })
      } catch (error) {
        return sendError(reply, error)
      }
    })

    app.get<{ Params: { agentTypeId: string }; Querystring: { cursor?: string; limit?: number } }>(
      '/api/v1/agents/:agentTypeId/sessions',
      async (request, reply) => {
        try {
          return await input.gateway.listSessions({
            scope: await input.options.authorizeRequest(request),
            agentTypeId: request.params.agentTypeId,
            cursor: request.query.cursor,
            limit: request.query.limit,
          })
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )

    app.post<{ Params: { agentTypeId: string }; Body: { requestId?: string; title?: string } }>(
      '/api/v1/agents/:agentTypeId/sessions',
      async (request, reply) => {
        try {
          const ref = await input.gateway.createSession({
            scope: await input.options.authorizeRequest(request),
            agentTypeId: request.params.agentTypeId,
            requestId: request.body?.requestId ?? randomUUID(),
            title: request.body?.title,
          })
          return reply.code(201).send(ref)
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )

    app.get<{ Params: { agentTypeId: string; sessionId: string } }>(
      '/api/v1/agents/:agentTypeId/sessions/:sessionId/state',
      async (request, reply) => {
        try {
          return await input.gateway.readSessionState({
            scope: await input.options.authorizeRequest(request),
            ref: request.params,
          })
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )

    app.post<{ Params: { agentTypeId: string; sessionId: string }; Body: { requestId: string; title: string } }>(
      '/api/v1/agents/:agentTypeId/sessions/:sessionId/rename',
      async (request, reply) => {
        try {
          return await input.gateway.renameSession({
            scope: await input.options.authorizeRequest(request),
            ref: request.params,
            requestId: request.body.requestId,
            title: request.body.title,
          })
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )

    app.delete<{ Params: { agentTypeId: string; sessionId: string }; Querystring: { requestId?: string } }>(
      '/api/v1/agents/:agentTypeId/sessions/:sessionId',
      async (request, reply) => {
        try {
          await input.gateway.deleteSession({
            scope: await input.options.authorizeRequest(request),
            ref: request.params,
            requestId: request.query.requestId ?? randomUUID(),
          })
          return reply.code(204).send()
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )

    app.post<{ Params: { agentTypeId: string; sessionId: string; command: string }; Body: Record<string, unknown> }>(
      '/api/v1/agents/:agentTypeId/sessions/:sessionId/:command',
      async (request, reply) => {
        try {
          const scope = await input.options.authorizeRequest(request)
          const connection = await input.gateway.connectSession({ scope, ref: request.params })
          try {
            const body = request.body ?? {}
            const command = request.params.command
            if (command === 'prompt' || command === 'followup') {
              return reply.code(202).send(await connection.send({ ...body, kind: command } as never))
            }
            const control = { requestId: String(body.requestId ?? randomUUID()) }
            if (command === 'interrupt') return reply.code(202).send(await connection.interrupt(control))
            if (command === 'stop') return reply.code(202).send(await connection.stop(control))
            if (command === 'queue-clear') return reply.code(202).send(await connection.clearQueue({ ...control, ...body } as never))
            return reply.code(404).send({ error: { code: 'AGENT_COMMAND_INVALID_STATE', message: 'unknown command' } })
          } finally {
            await connection.close()
          }
        } catch (error) {
          return sendError(reply, error)
        }
      },
    )
  }
}
