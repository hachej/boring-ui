import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createPiRuntime, resolvePiSessionContext } from '../agent/piRuntime.js'

const sendSse = (reply: FastifyReply, event: string, payload: unknown) => {
  reply.raw.write(`event: ${event}\n`)
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const safeDecodeURIComponent = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

const requireSessionUserId = (request: FastifyRequest, reply: FastifyReply) => {
  const userId = String(request.sessionUserId || '').trim()
  if (userId) return userId
  reply.code(401).send({
    error: 'unauthorized',
    code: 'SESSION_REQUIRED',
    message: 'Authentication required',
  })
  return null
}

export async function registerPiRoutes(app: FastifyInstance): Promise<void> {
  const runtime = createPiRuntime(app.config)

  app.post('/agent/pi/sessions/create', async (request, reply) => {
    const userId = requireSessionUserId(request, reply)
    if (!userId) return reply
    try {
      const payload = (request.body as Record<string, unknown> | null) || {}
      const session = runtime.createSession(
        userId,
        resolvePiSessionContext(
          app.config,
          payload,
          request.headers['x-workspace-id'] as string | undefined,
        ),
      )
      return reply.code(201).send({ session: runtime.toSessionSummary(session) })
    } catch (error) {
      const status = Number((error as any)?.status || 500)
      return reply.code(status).send({
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  app.get<{ Querystring: { workspace_id?: string; workspaceId?: string } }>('/agent/pi/sessions', async (request, reply) => {
    const userId = requireSessionUserId(request, reply)
    if (!userId) return reply
    const workspaceId = String(request.query?.workspace_id || request.query?.workspaceId || '').trim()
    return {
      sessions: runtime.listSessions(userId, { workspaceId }),
    }
  })

  app.get<{ Params: { sessionId: string } }>('/agent/pi/sessions/:sessionId/history', async (request, reply) => {
    const userId = requireSessionUserId(request, reply)
    if (!userId) return reply
    const sessionId = safeDecodeURIComponent(request.params.sessionId)
    if (!sessionId) {
      return reply.code(400).send({ error: 'invalid session id' })
    }
    const session = runtime.getSession(sessionId, userId)
    if (!session) {
      return reply.code(404).send({ error: 'session not found' })
    }
    return {
      session: runtime.toSessionSummary(session),
      messages: runtime.toUiMessages(session.agent.state.messages),
    }
  })

  app.post<{ Params: { sessionId: string } }>('/agent/pi/sessions/:sessionId/stop', async (request, reply) => {
    const userId = requireSessionUserId(request, reply)
    if (!userId) return reply
    const sessionId = safeDecodeURIComponent(request.params.sessionId)
    if (!sessionId) {
      return reply.code(400).send({ error: 'invalid session id' })
    }
    const session = runtime.stopSession(sessionId, userId)
    if (!session) {
      return reply.code(404).send({ error: 'session not found' })
    }
    return {
      ok: true,
      session: runtime.toSessionSummary(session),
    }
  })

  app.post<{ Params: { sessionId: string } }>('/agent/pi/sessions/:sessionId/stream', async (request, reply) => {
    const userId = requireSessionUserId(request, reply)
    if (!userId) return reply
    const sessionId = safeDecodeURIComponent(request.params.sessionId)
    if (!sessionId) {
      return reply.code(400).send({ error: 'invalid session id' })
    }
    const payload = (request.body as Record<string, unknown> | null) || {}
    const prompt = String(payload?.message || '').trim()
    if (!prompt) {
      return reply.code(400).send({ error: 'message is required' })
    }

    let session
    try {
      session = runtime.getSession(
        sessionId,
        userId,
        resolvePiSessionContext(
          app.config,
          payload,
          request.headers['x-workspace-id'] as string | undefined,
        ),
      )
    } catch (error) {
      const status = Number((error as any)?.status || 500)
      return reply.code(status).send({
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (!session) {
      return reply.code(404).send({ error: 'session not found' })
    }

    if (session.agent.state.isStreaming) {
      return reply.code(409).send({ error: 'session is busy' })
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    reply.raw.write('\n')

    let closed = false
    let assistantText = ''
    let assistantParts: ReturnType<typeof runtime.normalizeContentParts> = []

    const unsubscribe = session.agent.subscribe((event: any) => {
      if (closed) return

      if (event.type === 'message_update' && event.message?.role === 'assistant') {
        assistantText = runtime.textFromMessage(event.message)
        sendSse(reply, 'delta', { text: assistantText })
        return
      }

      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        assistantText = runtime.textFromMessage(event.message)
        assistantParts = runtime.normalizeContentParts(event.message)
        return
      }

      if (event.type === 'tool_execution_start') {
        sendSse(reply, 'tool_start', {
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          args: event.args || {},
        })
        return
      }

      if (event.type === 'tool_execution_end') {
        const resultText = event.result?.content?.[0]?.text || ''
        sendSse(reply, 'tool_end', {
          toolCallId: event.toolCallId || '',
          toolName: event.toolName || '',
          result: {
            text: resultText,
            details: event.result?.details || {},
          },
          isError: event.isError || false,
        })
      }
    })

    request.raw.on('close', () => {
      closed = true
      unsubscribe()
      if (!session.agent.state.isStreaming) return
      try {
        session.agent.abort()
      } catch {
        // ignore best-effort abort errors on disconnect
      }
    })

    try {
      sendSse(reply, 'session', { session: runtime.toSessionSummary(session) })
      await session.agent.prompt(prompt)
      runtime.updateSessionAfterPrompt(session)
      sendSse(reply, 'done', {
        text: assistantText,
        parts: assistantParts,
        session: runtime.toSessionSummary(session),
      })
    } catch (error) {
      sendSse(reply, 'error', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      unsubscribe()
      if (!closed) {
        reply.raw.end()
      }
    }

    return reply
  })
}
