import { randomUUID } from 'node:crypto'
import { Agent } from '@mariozechner/pi-agent-core'
import { getEnvApiKey, getModel, registerBuiltInApiProviders } from '@mariozechner/pi-ai'
import type { ServerConfig } from '../config.js'
import { buildSessionSystemPrompt, createWorkspaceTools } from './piTools.js'
import { resolveAgentSessionContext, type AgentSessionContext } from './sessionContext.js'

const DEFAULT_MODEL = process.env.PI_SERVICE_MODEL || 'claude-sonnet-4-5-20250929'
const SYSTEM_PROMPT = [
  'You are an Agent integrated into Boring UI.',
  'Do not claim to be Claude Code.',
  'Be concise, accurate, and action-oriented.',
].join(' ')

let builtInProvidersRegistered = false

interface UiTextPart {
  type: 'text'
  text: string
}

interface UiToolUsePart {
  type: 'tool_use'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: {
    text: string
    isError: boolean
  }
}

export type UiMessagePart = UiTextPart | UiToolUsePart

const normalizeWorkspaceId = (value: unknown) => String(value || '').trim()

const requireServerApiKey = () => {
  const key = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY
  return typeof key === 'string' && key.trim().length > 0
}

const ensureBuiltInProviders = () => {
  if (builtInProvidersRegistered) return
  registerBuiltInApiProviders()
  builtInProvidersRegistered = true
}

const getModelById = (provider: string, modelId: string) =>
  getModel(provider as never, modelId as never)

const pickDefaultModel = () => (
  getModelById('anthropic', DEFAULT_MODEL)
  || getModelById('anthropic', 'claude-sonnet-4-5-20250929')
  || getModelById('openai', 'gpt-4o-mini')
  || getModelById('google', 'gemini-2.5-flash')
  || null
)

const textFromMessage = (message: any) => {
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join(' ')
    .trim()
}

const deriveTitle = (messages: any[]) => {
  const firstUser = messages.find((msg) => msg.role === 'user' || msg.role === 'user-with-attachments')
  const text = textFromMessage(firstUser)
  if (!text) return 'New session'
  if (text.length <= 48) return text
  return `${text.slice(0, 45)}...`
}

const normalizeContentParts = (message: any): UiMessagePart[] => {
  const content = message?.content
  if (!Array.isArray(content)) {
    const text = textFromMessage(message)
    return text ? [{ type: 'text', text }] : []
  }
  const parts: UiMessagePart[] = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      parts.push({ type: 'text', text: block.text })
      continue
    }
    if (block?.type === 'toolCall') {
      parts.push({
        type: 'tool_use',
        toolCallId: block.id || '',
        toolName: block.name || '',
        args: block.arguments || {},
      })
    }
  }
  return parts
}

const toUiMessages = (messages: any[]) => {
  const toolResultMap = new Map<string, { text: string; isError: boolean }>()

  for (const message of messages) {
    if (message.role !== 'toolResult' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!block.toolCallId) continue
      toolResultMap.set(block.toolCallId, {
        text: typeof block.result === 'string'
          ? block.result
          : (block.result?.content?.[0]?.text || JSON.stringify(block.result || '')),
        isError: block.isError || false,
      })
    }
  }

  return messages
    .filter((message) => message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant')
    .map((message, index) => {
      const parts = normalizeContentParts(message)
      for (const part of parts) {
        if (part?.type === 'tool_use' && toolResultMap.has(part.toolCallId)) {
          part.result = toolResultMap.get(part.toolCallId)
        }
      }
      return {
        id: message.id || `msg-${index}`,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        text: textFromMessage(message),
        parts,
        timestamp: message.timestamp || Date.now(),
      }
    })
    .filter((message) => message.text.length > 0 || message.parts.length > 0)
}

const toSessionSummary = (session: PiSession) => ({
  id: session.id,
  title: session.title || 'New session',
  createdAt: session.createdAt,
  lastModified: session.lastModified,
  model: session.agent.state.model?.id || null,
  state: session.agent.state.isStreaming ? 'running' : 'idle',
  workspaceId: session.workspaceId || '',
})

export interface PiSessionContext {
  workspaceId: string
  workspaceRoot: string
}

interface PiSession {
  id: string
  ownerUserId: string
  createdAt: string
  lastModified: string
  title: string
  workspaceId: string
  workspaceRoot: string
  agent: any
}

const nowIso = () => new Date().toISOString()

const normalizeOwnerUserId = (value: unknown) => String(value || '').trim()

export function resolvePiSessionContext(
  config: ServerConfig,
  payload: Record<string, unknown> = {},
  workspaceIdHeader?: string,
): PiSessionContext {
  return resolveAgentSessionContext(config, payload, workspaceIdHeader)
}

export function createPiRuntime(config: ServerConfig) {
  ensureBuiltInProviders()
  const sessions = new Map<string, PiSession>()

  const requireOwnerUserId = (ownerUserId: string) => {
    const normalized = normalizeOwnerUserId(ownerUserId)
    if (normalized) return normalized
    const error = new Error('authenticated user id is required')
    ;(error as any).status = 401
    throw error
  }

  const applySessionContext = (session: PiSession, nextContext: PiSessionContext) => {
    let changed = false
    if (nextContext.workspaceId && nextContext.workspaceId !== session.workspaceId) {
      session.workspaceId = nextContext.workspaceId
      changed = true
    }
    if (nextContext.workspaceRoot && nextContext.workspaceRoot !== session.workspaceRoot) {
      session.workspaceRoot = nextContext.workspaceRoot
      changed = true
    }
    if (!changed) return
    session.agent.setSystemPrompt(buildSessionSystemPrompt(SYSTEM_PROMPT, { workspaceRoot: session.workspaceRoot }))
    session.agent.setTools(createWorkspaceTools({ workspaceRoot: session.workspaceRoot }))
  }

  const createSession = (ownerUserId: string, sessionContext: PiSessionContext) => {
    const normalizedOwnerUserId = requireOwnerUserId(ownerUserId)

    if (!requireServerApiKey()) {
      const error = new Error('ANTHROPIC_API_KEY (or ANTHROPIC_OAUTH_TOKEN) is required for server-side PI')
      ;(error as any).status = 503
      throw error
    }

    const model = pickDefaultModel()
    if (!model) {
      const error = new Error('PI service could not resolve a default model')
      ;(error as any).status = 503
      throw error
    }

    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: buildSessionSystemPrompt(SYSTEM_PROMPT, { workspaceRoot: sessionContext.workspaceRoot }),
        thinkingLevel: 'off',
        tools: createWorkspaceTools({ workspaceRoot: sessionContext.workspaceRoot }),
        messages: [],
      },
      getApiKey: async (provider: string) => getEnvApiKey(provider),
    })

    const session: PiSession = {
      id: randomUUID(),
      ownerUserId: normalizedOwnerUserId,
      createdAt: nowIso(),
      lastModified: nowIso(),
      title: 'New session',
      workspaceId: sessionContext.workspaceId || '',
      workspaceRoot: sessionContext.workspaceRoot,
      agent,
    }
    agent.sessionId = session.id
    sessions.set(session.id, session)
    return session
  }

  const getSession = (
    sessionId: string,
    ownerUserId: string,
    sessionContext?: PiSessionContext,
  ) => {
    const normalizedOwnerUserId = requireOwnerUserId(ownerUserId)
    const session = sessions.get(sessionId)
    if (!session || session.ownerUserId !== normalizedOwnerUserId) return null
    if (sessionContext) applySessionContext(session, sessionContext)
    return session
  }

  const listSessions = (
    ownerUserId: string,
    options: { workspaceId?: string } = {},
  ) => {
    const normalizedOwnerUserId = requireOwnerUserId(ownerUserId)
    const normalizedWorkspaceId = normalizeWorkspaceId(options.workspaceId)
    return Array.from(sessions.values())
      .filter((session) => session.ownerUserId === normalizedOwnerUserId)
      .filter((session) => {
        return !normalizedWorkspaceId || session.workspaceId === normalizedWorkspaceId
      })
      .sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)))
      .map(toSessionSummary)
  }

  const stopSession = (sessionId: string, ownerUserId: string) => {
    const session = getSession(sessionId, ownerUserId)
    if (!session) return null
    session.agent.abort()
    session.lastModified = nowIso()
    return session
  }

  const updateSessionAfterPrompt = (session: PiSession) => {
    session.lastModified = nowIso()
    session.title = deriveTitle(session.agent.state.messages)
  }

  return {
    hasServerApiKey: requireServerApiKey,
    createSession,
    getSession,
    listSessions,
    stopSession,
    updateSessionAfterPrompt,
    toSessionSummary,
    toUiMessages,
    textFromMessage,
    normalizeContentParts,
  }
}
