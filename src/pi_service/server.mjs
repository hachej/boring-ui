import http from 'node:http'
import { randomUUID } from 'node:crypto'

import { Agent } from '@mariozechner/pi-agent-core'
import { getEnvApiKey, getModel, registerBuiltInApiProviders } from '@mariozechner/pi-ai'

import { buildSessionSystemPrompt, createWorkspaceTools, resolveSessionContext } from './tools.mjs'

registerBuiltInApiProviders()

const HOST = process.env.PI_SERVICE_HOST || '0.0.0.0'
const PORT = Number(process.env.PI_SERVICE_PORT || '8789')
const CORS_ORIGIN = process.env.PI_SERVICE_CORS_ORIGIN || '*'
const DEFAULT_MODEL = process.env.PI_SERVICE_MODEL || 'claude-sonnet-4-5-20250929'
const MAX_SESSIONS = Number(process.env.PI_SERVICE_MAX_SESSIONS || '20')
const SYSTEM_PROMPT = [
  'You are an Agent integrated into Boring UI.',
  'Do not claim to be Claude Code.',
  'Be concise, accurate, and action-oriented.',
].join(' ')

const sessions = new Map()

function nowIso() {
  return new Date().toISOString()
}

function withCors(headers = {}) {
  return {
    'access-control-allow-origin': CORS_ORIGIN,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    ...headers,
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, withCors({ 'content-type': 'application/json; charset=utf-8' }))
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 2_000_000) {
      throw new Error('Request body too large')
    }
  }
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Invalid JSON payload')
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function pickDefaultModel() {
  return (
    getModel('anthropic', DEFAULT_MODEL)
    || getModel('anthropic', 'claude-sonnet-4-5-20250929')
    || getModel('openai', 'gpt-4o-mini')
    || getModel('google', 'gemini-2.5-flash')
    || null
  )
}

function textFromMessage(message) {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join(' ')
    .trim()
}

function deriveTitle(messages) {
  const firstUser = messages.find((msg) => msg.role === 'user' || msg.role === 'user-with-attachments')
  const text = textFromMessage(firstUser)
  if (!text) return 'New session'
  if (text.length <= 48) return text
  return `${text.slice(0, 45)}...`
}

function toUiMessages(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant')
    .map((message, index) => ({
      id: message.id || `msg-${index}`,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: textFromMessage(message),
      timestamp: message.timestamp || Date.now(),
    }))
    .filter((message) => message.text.length > 0)
}

function toSessionSummary(session) {
  return {
    id: session.id,
    title: session.title || 'New session',
    createdAt: session.createdAt,
    lastModified: session.lastModified,
    model: session.agent.state.model?.id || null,
    state: session.agent.state.isStreaming ? 'running' : 'idle',
  }
}

function requireServerApiKey() {
  const key = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY
  return typeof key === 'string' && key.trim().length > 0
}

function applySessionContext(session, nextContext = {}) {
  if (nextContext.workspaceId) {
    session.workspaceId = nextContext.workspaceId
  }
  if (nextContext.internalApiToken) {
    session.internalApiToken = nextContext.internalApiToken
  }
  if (nextContext.backendUrl) {
    session.backendUrl = nextContext.backendUrl
  }

  const toolContext = {
    workspaceId: session.workspaceId,
    internalApiToken: session.internalApiToken,
    backendUrl: session.backendUrl,
  }
  session.agent.setSystemPrompt(buildSessionSystemPrompt(SYSTEM_PROMPT, toolContext))
  session.agent.setTools(createWorkspaceTools(toolContext))
}

function createSession(sessionContext = {}) {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`PI session limit reached (${MAX_SESSIONS})`)
  }

  const model = pickDefaultModel()
  if (!model) {
    throw new Error('PI service could not resolve a default model')
  }

  const id = randomUUID()
  const agent = new Agent({
    initialState: {
      model,
      systemPrompt: buildSessionSystemPrompt(SYSTEM_PROMPT, sessionContext),
      thinkingLevel: 'off',
      tools: createWorkspaceTools(sessionContext),
      messages: [],
    },
    getApiKey: async (provider) => getEnvApiKey(provider),
  })
  agent.sessionId = id

  const session = {
    id,
    createdAt: nowIso(),
    lastModified: nowIso(),
    title: 'New session',
    workspaceId: sessionContext.workspaceId || '',
    internalApiToken: sessionContext.internalApiToken || '',
    backendUrl: sessionContext.backendUrl || '',
    agent,
  }
  sessions.set(id, session)
  return session
}

function getOrCreateSession(sessionId, sessionContext = {}) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)
    applySessionContext(session, sessionContext)
    return session
  }
  return createSession(sessionContext)
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function listSortedSessions() {
  return Array.from(sessions.values())
    .sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)))
    .map(toSessionSummary)
}

async function handleStream(_req, res, session, payload = {}) {
  const prompt = String(payload?.message || '').trim()
  if (!prompt) {
    sendJson(res, 400, { error: 'message is required' })
    return
  }
  if (session.agent.state.isStreaming) {
    sendJson(res, 409, { error: 'session is busy' })
    return
  }

  res.writeHead(200, withCors({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  }))
  res.write('\n')

  let closed = false
  let assistantText = ''

  const unsubscribe = session.agent.subscribe((event) => {
    if (closed) return
    if (event.type === 'message_update' && event.message?.role === 'assistant') {
      assistantText = textFromMessage(event.message)
      sendSse(res, 'delta', { text: assistantText })
      return
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      assistantText = textFromMessage(event.message)
    }
  })

  _req.on('close', () => {
    closed = true
    unsubscribe()
    if (session.agent.state.isStreaming) {
      try {
        const result = session.agent.abort()
        if (result && typeof result.catch === 'function') {
          result.catch(() => {})
        }
      } catch {
        // Ignore abort errors during client disconnect.
      }
    }
  })

  try {
    sendSse(res, 'session', { session: toSessionSummary(session) })
    await session.agent.prompt(prompt)

    session.lastModified = nowIso()
    session.title = deriveTitle(session.agent.state.messages)

    sendSse(res, 'done', {
      text: assistantText,
      session: toSessionSummary(session),
    })
  } catch (error) {
    sendSse(res, 'error', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    unsubscribe()
    if (!closed) {
      res.end()
    }
  }
}

async function handleHttpRequest(req, res) {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'invalid request' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors())
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'pi-service',
      sessions: sessions.size,
      hasAnthropicKey: requireServerApiKey(),
    })
    return
  }

  if (!requireServerApiKey()) {
    sendJson(res, 503, {
      error: 'ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN) is required on PI service',
    })
    return
  }

  if (req.method === 'POST' && path === '/api/v1/agent/pi/sessions/create') {
    try {
      const payload = await readJsonBody(req)
      const session = createSession(resolveSessionContext(payload, req.headers))
      sendJson(res, 201, { session: toSessionSummary(session) })
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid JSON payload') {
        sendJson(res, 400, { error: error.message })
        return
      }
      sendJson(res, 429, { error: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (req.method === 'POST' && path === '/api/v1/agent/pi/sessions/context') {
    let payload = {}
    try {
      payload = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    const sessionId = safeDecodeURIComponent(String(payload?.session_id || ''))
    if (!sessionId) {
      sendJson(res, 400, { error: 'session_id is required' })
      return
    }
    const session = sessions.get(sessionId)
    if (!session) {
      sendJson(res, 404, { error: 'session not found' })
      return
    }
    applySessionContext(session, resolveSessionContext(payload, req.headers))
    session.lastModified = nowIso()
    sendJson(res, 200, { ok: true, session: toSessionSummary(session) })
    return
  }

  if (req.method === 'GET' && path === '/api/v1/agent/pi/sessions') {
    sendJson(res, 200, { sessions: listSortedSessions() })
    return
  }

  const historyMatch = path.match(/^\/api\/v1\/agent\/pi\/sessions\/([^/]+)\/history$/)
  if (req.method === 'GET' && historyMatch) {
    const sessionId = safeDecodeURIComponent(historyMatch[1])
    if (!sessionId) {
      sendJson(res, 400, { error: 'invalid session id' })
      return
    }
    const session = sessions.get(sessionId)
    if (!session) {
      sendJson(res, 404, { error: 'session not found' })
      return
    }
    sendJson(res, 200, {
      session: toSessionSummary(session),
      messages: toUiMessages(session.agent.state.messages),
    })
    return
  }

  const stopMatch = path.match(/^\/api\/v1\/agent\/pi\/sessions\/([^/]+)\/stop$/)
  if (req.method === 'POST' && stopMatch) {
    const sessionId = safeDecodeURIComponent(stopMatch[1])
    if (!sessionId) {
      sendJson(res, 400, { error: 'invalid session id' })
      return
    }
    const session = sessions.get(sessionId)
    if (!session) {
      sendJson(res, 404, { error: 'session not found' })
      return
    }
    session.agent.abort()
    session.lastModified = nowIso()
    sendJson(res, 200, { ok: true, session: toSessionSummary(session) })
    return
  }

  const streamMatch = path.match(/^\/api\/v1\/agent\/pi\/sessions\/([^/]+)\/stream$/)
  if (req.method === 'POST' && streamMatch) {
    const sessionId = safeDecodeURIComponent(streamMatch[1])
    if (!sessionId) {
      sendJson(res, 400, { error: 'invalid session id' })
      return
    }
    try {
      const payload = await readJsonBody(req)
      const session = getOrCreateSession(sessionId, resolveSessionContext(payload, req.headers))
      await handleStream(req, res, session, payload)
    } catch (error) {
      console.error('[pi-service] stream handler failed', error)
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal server error' })
      } else {
        res.end()
      }
    }
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

const server = http.createServer((req, res) => {
  handleHttpRequest(req, res).catch((error) => {
    console.error('[pi-service] request handler failed', error)
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal server error' })
    } else {
      res.end()
    }
  })
})

server.listen(PORT, HOST, () => {
  // Keep stdout human-readable for manual ops.
  console.log(`[pi-service] listening on http://${HOST}:${PORT}`)
  console.log(`[pi-service] model=${DEFAULT_MODEL} max_sessions=${MAX_SESSIONS}`)
})
