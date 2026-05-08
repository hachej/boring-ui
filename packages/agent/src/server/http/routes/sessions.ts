import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
} from '../../../shared/session'
import type { UIMessage, UIMessageChunk } from '../../../shared/message'
import type { AgentHarness } from '../../../shared/harness'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_NOT_IMPLEMENTED,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

const DEFAULT_SESSION_TITLE = 'New session'
const DEFAULT_WORKSPACE_ID = 'default'
const MAX_ANALYSIS_TRANSCRIPT_CHARS = 120_000

const createSessionBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .optional()

type CreateSessionBody = z.infer<typeof createSessionBodySchema>

const analyzeSessionBodySchema = z
  .object({
    instructions: z.string().max(4_000).optional(),
    title: z.string().min(1).max(200).optional(),
    run: z.boolean().optional(),
    includeTranscript: z.boolean().optional(),
  })
  .optional()

type AnalyzeSessionBody = z.infer<typeof analyzeSessionBodySchema>

interface InMemorySession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  workspaceId: string
  messages: UIMessage[]
}

class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, InMemorySession>()

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === ctx.workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary)
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    const now = new Date().toISOString()
    const session: InMemorySession = {
      id: randomUUID(),
      title: init?.title ?? DEFAULT_SESSION_TITLE,
      createdAt: now,
      updatedAt: now,
      workspaceId: ctx.workspaceId,
      messages: [],
    }

    this.sessions.set(session.id, session)
    return toSummary(session)
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const session = this.sessions.get(sessionId)
    if (!session || session.workspaceId !== ctx.workspaceId) {
      throw new SessionNotFoundError(sessionId)
    }

    return {
      ...toSummary(session),
      messages: session.messages,
    }
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session && session.workspaceId === ctx.workspaceId) {
      this.sessions.delete(sessionId)
    }
  }

  async saveMessages(ctx: SessionCtx, sessionId: string, messages: UIMessage[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session && session.workspaceId === ctx.workspaceId) {
      session.messages = messages
      session.updatedAt = new Date().toISOString()
    }
  }
}

export interface SessionRoutesOptions {
  sessionStore?: SessionStore
  getSessionStore?: (request: FastifyRequest) => SessionStore | Promise<SessionStore>
  harness?: AgentHarness
  workdir?: string
  getRuntime?: (request: FastifyRequest) => Promise<{
    harness: AgentHarness
    workdir: string
  }>
}

function toSummary(session: InMemorySession): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.messages.filter((message) => message.role === 'user').length,
  }
}

function getSessionCtx(request: FastifyRequest): SessionCtx {
  const workspaceContext = (
    request as FastifyRequest & {
      workspaceContext?: { workspaceId: string; authenticated: boolean }
    }
  ).workspaceContext

  return {
    workspaceId: workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID,
  }
}

function requireSessionId(
  value: unknown,
  reply: FastifyReply,
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    reply.code(400).send({
      error: {
        code: ERROR_CODE_VALIDATION_ERROR,
        message: 'id is required',
        field: 'id',
      },
    })
    return null
  }
  return value
}

function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof SessionNotFoundError ||
    (err instanceof Error && /not found/i.test(err.message))
  )
}

function classifySessionError(err: unknown, reply: FastifyReply): FastifyReply {
  if (isNotFoundError(err)) {
    return reply.code(404).send({
      error: {
        code: ERROR_CODE_NOT_FOUND,
        message: 'session not found',
      },
    })
  }

  const message = err instanceof Error ? err.message : 'internal error'
  return reply.code(500).send({
    error: {
      code: ERROR_CODE_INTERNAL,
      message,
    },
  })
}

function stableStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function partText(part: unknown): string {
  const value = part as Record<string, unknown>
  if (typeof value.text === 'string') return value.text
  if (typeof value.delta === 'string') return value.delta
  if (typeof value.content === 'string') return value.content
  return ''
}

function toolName(part: Record<string, unknown>): string {
  if (typeof part.toolName === 'string') return part.toolName
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length)
  }
  return 'tool'
}

function formatToolPart(part: Record<string, unknown>): string {
  const name = toolName(part)
  const lines = [`[tool:${name}]`]
  if ('input' in part) {
    lines.push('input:', stableStringify(part.input))
  }
  if ('output' in part) {
    lines.push('output:', stableStringify(part.output))
  }
  if (typeof part.errorText === 'string' && part.errorText.length > 0) {
    lines.push('error:', part.errorText)
  }
  return lines.join('\n')
}

function formatMessageForTranscript(message: UIMessage, index: number): string {
  const msg = message as UIMessage & { parts?: unknown[]; content?: unknown }
  const role = String(msg.role ?? 'unknown').toUpperCase()
  const parts = Array.isArray(msg.parts) ? msg.parts : []
  const lines: string[] = [`## ${index + 1}. ${role}`]

  if (typeof msg.content === 'string' && msg.content.trim()) {
    lines.push(msg.content.trim())
  }

  for (const part of parts) {
    const record = part as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'text') {
      const text = partText(record).trim()
      if (text) lines.push(text)
      continue
    }
    if (type === 'reasoning') {
      const text = partText(record).trim()
      if (text) lines.push(`[reasoning]\n${text}`)
      continue
    }
    if (type.startsWith('tool-')) {
      lines.push(formatToolPart(record))
      continue
    }
    const text = partText(record).trim()
    if (text) lines.push(`[${type || 'part'}]\n${text}`)
  }

  if (lines.length === 1) lines.push('(no visible content)')
  return lines.join('\n\n')
}

function formatSessionTranscript(session: SessionDetail): string {
  const header = [
    `# Agent session transcript: ${session.title}`,
    '',
    `- Session: ${session.id}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    `- User turns: ${session.turnCount}`,
  ]
  const body = session.messages.map(formatMessageForTranscript)
  return [...header, '', ...body].join('\n')
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const keep = Math.floor((maxChars - 200) / 2)
  return `${value.slice(0, keep)}\n\n[... transcript truncated: ${value.length - keep * 2} chars omitted ...]\n\n${value.slice(-keep)}`
}

function buildAnalysisPrompt(
  session: SessionDetail,
  transcript: string,
  instructions?: string,
): string {
  const boundedTranscript = truncateMiddle(transcript, MAX_ANALYSIS_TRANSCRIPT_CHARS)
  return [
    'You are an agent-session analyst. Analyze the transcript below and explain what is going on.',
    '',
    'Return a concise, evidence-backed report with these sections:',
    '1. User goal',
    '2. Current state',
    '3. What the agent did',
    '4. Failures, confusing behavior, or likely root causes',
    '5. Files/tools/commands that matter',
    '6. Risks and recommended next actions',
    '',
    'Rules:',
    '- Cite concrete transcript evidence when possible.',
    '- Say "unknown" when the transcript does not prove something.',
    '- Do not modify files unless explicitly asked in follow-up.',
    instructions ? `- Extra user instructions: ${instructions}` : '',
    '',
    `Source session: ${session.id} (${session.title})`,
    '',
    '<transcript>',
    boundedTranscript,
    '</transcript>',
  ].filter(Boolean).join('\n')
}

function analysisTextFromChunks(chunks: UIMessageChunk[]): string {
  return chunks
    .map((chunk) => {
      const record = chunk as Record<string, unknown>
      return record.type === 'text-delta' && typeof record.delta === 'string'
        ? record.delta
        : ''
    })
    .join('')
    .trim()
}

export function sessionRoutes(
  app: FastifyInstance,
  opts: SessionRoutesOptions,
  done: (err?: Error) => void,
): void {
  const sessionStore = opts.sessionStore ?? new InMemorySessionStore()
  const validateCreateBody = createBodyValidator(createSessionBodySchema)
  const validateAnalyzeBody = createBodyValidator(analyzeSessionBodySchema)

  async function resolveSessionStore(request: FastifyRequest): Promise<SessionStore> {
    if (opts.getSessionStore) return await opts.getSessionStore(request)
    return sessionStore
  }

  async function resolveRuntime(request: FastifyRequest): Promise<{
    harness: AgentHarness
    workdir: string
  }> {
    if (opts.getRuntime) return await opts.getRuntime(request)
    if (opts.harness && opts.workdir) return { harness: opts.harness, workdir: opts.workdir }
    throw new Error('session analysis requires harness/workdir or getRuntime')
  }

  app.get('/api/v1/agent/sessions', async (request, reply) => {
    try {
      const store = await resolveSessionStore(request)
      return await store.list(getSessionCtx(request))
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.post(
    '/api/v1/agent/sessions',
    { preHandler: validateCreateBody },
    async (request, reply) => {
      const body = request.body as CreateSessionBody
      try {
        const store = await resolveSessionStore(request)
        return await store.create(getSessionCtx(request), {
          title: body?.title,
        })
      } catch (err) {
        return classifySessionError(err, reply)
      }
    },
  )

  app.get('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    try {
      const store = await resolveSessionStore(request)
      return await store.load(getSessionCtx(request), sessionId)
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.get('/api/v1/agent/sessions/:id/transcript', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    const query = request.query as Record<string, unknown>
    const format = query.format === 'json' ? 'json' : 'markdown'

    try {
      const store = await resolveSessionStore(request)
      const session = await store.load(getSessionCtx(request), sessionId)
      const transcript = formatSessionTranscript(session)

      if (format === 'json') {
        return {
          session: {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            turnCount: session.turnCount,
          },
          transcript,
          messages: session.messages,
        }
      }

      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .send(transcript)
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.post(
    '/api/v1/agent/sessions/:id/analysis',
    { preHandler: validateAnalyzeBody },
    async (request, reply) => {
      const params = request.params as Record<string, unknown>
      const sourceSessionId = requireSessionId(params.id, reply)
      if (sourceSessionId === null) return

      const body = request.body as AnalyzeSessionBody
      const run = body?.run === true
      const sessionCtx = getSessionCtx(request)

      try {
        const store = await resolveSessionStore(request)
        const sourceSession = await store.load(sessionCtx, sourceSessionId)
        const transcript = formatSessionTranscript(sourceSession)
        const prompt = buildAnalysisPrompt(sourceSession, transcript, body?.instructions)
        let runtime: { harness: AgentHarness; workdir: string } | null = null
        if (run) {
          try {
            runtime = await resolveRuntime(request)
          } catch {
            return reply.code(501).send({
              error: {
                code: ERROR_CODE_NOT_IMPLEMENTED,
                message: 'session analysis runtime is not configured',
              },
            })
          }
        }
        const analysisSession = await store.create(sessionCtx, {
          title: body?.title ?? `Analysis: ${sourceSession.title}`.slice(0, 200),
        })

        if (!run) {
          return {
            sourceSession: {
              id: sourceSession.id,
              title: sourceSession.title,
              createdAt: sourceSession.createdAt,
              updatedAt: sourceSession.updatedAt,
              turnCount: sourceSession.turnCount,
            },
            analysisSession,
            prompt,
            transcriptUrl: `/api/v1/agent/sessions/${encodeURIComponent(sourceSession.id)}/transcript`,
            ...(body?.includeTranscript ? { transcript } : {}),
          }
        }

        if (!runtime) {
          throw new Error('session analysis runtime is not configured')
        }

        const abortController = new AbortController()
        const chunks: UIMessageChunk[] = []
        for await (const chunk of runtime.harness.sendMessage(
          { sessionId: analysisSession.id, message: prompt },
          {
            abortSignal: abortController.signal,
            workdir: runtime.workdir,
          },
        )) {
          chunks.push(chunk)
        }

        return {
          sourceSession: {
            id: sourceSession.id,
            title: sourceSession.title,
            createdAt: sourceSession.createdAt,
            updatedAt: sourceSession.updatedAt,
            turnCount: sourceSession.turnCount,
          },
          analysisSession,
          prompt,
          transcriptUrl: `/api/v1/agent/sessions/${encodeURIComponent(sourceSession.id)}/transcript`,
          analysisText: analysisTextFromChunks(chunks),
          ...(body?.includeTranscript ? { transcript } : {}),
        }
      } catch (err) {
        return classifySessionError(err, reply)
      }
    },
  )

  app.delete('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    const sessionCtx = getSessionCtx(request)

    try {
      const store = await resolveSessionStore(request)
      await store.load(sessionCtx, sessionId)
      await store.delete(sessionCtx, sessionId)
      return reply.code(204).send()
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  done()
}
