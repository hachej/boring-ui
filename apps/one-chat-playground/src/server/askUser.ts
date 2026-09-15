import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AgentTool } from '@hachej/boring-agent/shared'

import {
  AskUserRuntime,
  FileAskUserStore,
  QuestionsBridge,
  QuestionsBridgeError,
  createAskUserTool,
  questionsRoutes,
} from '@hachej/boring-ask-user/server'
import { QuestionsCommandSchema, type AskUserQuestion, type QuestionsCommand } from '@hachej/boring-ask-user/shared'

/** What the front needs to draw one question card and answer it. */
export interface PendingQuestionView {
  readonly questionId: string
  readonly sessionId: string
  readonly toolCallId?: string
  readonly title?: string
  readonly context?: string
  readonly schema?: AskUserQuestion['schema']
  /** Per-question secret the submit command checks. Local, single-user app. */
  readonly answerToken: string
  readonly createdAt: string
}

export const PENDING_QUESTIONS_ROUTE = '/api/v1/questions/pending'

export interface OneChatAskUser {
  readonly tool: AgentTool
  readonly store: FileAskUserStore
  readonly runtime: AskUserRuntime
  abandonStale(): Promise<void>
  registerRoutes(app: FastifyInstance): Promise<void>
}

function sessionIdOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('params' in body)) return undefined
  const params = (body as { params?: unknown }).params
  if (!params || typeof params !== 'object' || !('sessionId' in params)) return undefined
  const sessionId = (params as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

function toView(question: AskUserQuestion): PendingQuestionView {
  return {
    questionId: question.questionId,
    sessionId: question.sessionId,
    toolCallId: question.toolCallId,
    title: question.title,
    context: question.context,
    schema: question.schema,
    answerToken: question.answerToken,
    createdAt: question.createdAt,
  }
}

/**
 * One local user, one pinned conversation, no sign-in: the plugin's per-user
 * checks would have nothing to check. The per-question answer token stays the
 * real guard on the answer route.
 */
const LOCAL_PRINCIPAL = 'anonymous'

export function createAskUser(options: {
  readonly statePath: string
  readonly agentTypeId: string
  readonly defaultSessionId: string
}): OneChatAskUser {
  const store = new FileAskUserStore(options.statePath)
  const runtime = new AskUserRuntime({
    store,
    ownerPrincipalId: LOCAL_PRINCIPAL,
    // One user, one conversation: the plugin's multi-tenant throttle would only
    // cut an interview short. Keep a ceiling, well above a real exchange.
    limits: { perSessionPerMinute: 60, perPrincipalPerHour: 600 },
  })
  const askUserTool = createAskUserTool({ runtime, sessionId: options.defaultSessionId })

  const tool: AgentTool = {
    name: askUserTool.name,
    description:
      'Ask the user one question and wait for their answer. Use it when the answer is a choice between concrete options, or when it decides whether data gets deleted. Give a short title and one field. The conversation is blocked until they answer, so ask one thing at a time.',
    parameters: askUserTool.parameters as AgentTool['parameters'],
    async execute(params, ctx) {
      return askUserTool.execute(
        ctx.toolCallId,
        params as Record<string, unknown>,
        ctx.abortSignal,
        ctx.sessionId ?? options.defaultSessionId,
        // Always the local principal, never the host's internal auth subject:
        // the person who answers in the browser is the person who was asked,
        // and the two must agree or the plugin refuses the answer.
        LOCAL_PRINCIPAL,
        { agentTypeId: options.agentTypeId, workspaceId: ctx.workspaceId, userId: ctx.userId },
      )
    },
  }

  const abandonStale = async () => {
    // A question left pending by a previous run has no waiter any more: its
    // card would never resolve. Retire it before the first page load.
    for (const stale of await store.listPending()) {
      await runtime.cancelQuestion(stale.questionId, stale.sessionId, 'abandoned').catch(() => undefined)
    }
  }

  return {
    tool,
    store,
    runtime,
    abandonStale,
    async registerRoutes(app) {
      await abandonStale()
      app.get(PENDING_QUESTIONS_ROUTE, async () => ({
        questions: (await store.listPending()).map(toView),
      }))
      await app.register(questionsRoutes, {
        store,
        runtime,
        // One local browser, one pinned conversation whose id is minted at
        // runtime: there is no separate session to cross-check the command
        // against. Take the id the command carries — the bridge still refuses
        // it unless it matches the question's own, and the per-question answer
        // token remains the real guard.
        getAuthContext: (request) => ({
          sessionId: sessionIdOf(request.body) ?? options.defaultSessionId,
          principalId: LOCAL_PRINCIPAL,
        }),
      })
    },
  }
}

/** One set of question routes, dispatching to the app selected by the host. */
export function registerScopedAskUserRoutes(
  app: FastifyInstance,
  resolve: (request: FastifyRequest) => Promise<OneChatAskUser>,
): void {
  app.get(PENDING_QUESTIONS_ROUTE, async (request) => {
    const selected = await resolve(request)
    return { questions: (await selected.store.listPending()).map(toView) }
  })

  app.post('/api/v1/questions/commands', async (request, reply) => {
    const parsed = QuestionsCommandSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0]?.message ?? 'invalid command' })
    }
    const selected = await resolve(request)
    const bridge = new QuestionsBridge({
      store: selected.store,
      runtime: selected.runtime,
      getAuthContext: () => ({
        sessionId: sessionIdOf(request.body) ?? 'one-chat',
        principalId: LOCAL_PRINCIPAL,
      }),
    })
    try {
      return await bridge.handle(parsed.data as QuestionsCommand)
    } catch (error) {
      return sendScopedError(reply, error)
    }
  })
}

function sendScopedError(reply: FastifyReply, error: unknown) {
  if (error instanceof QuestionsBridgeError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message })
  }
  throw error
}
