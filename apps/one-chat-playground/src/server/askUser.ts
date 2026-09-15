import type { FastifyInstance } from 'fastify'
import type { AgentTool } from '@hachej/boring-agent/shared'

// The ask-user plugin's published entry point is bound to the Workspace shell
// (Dockview panels, the Inbox, the UI bridge). This playground has none of
// that, so it deep-imports only the three modules that are shell-free — the
// tool, the runtime that blocks the turn, and the file-backed store — and
// renders the question itself, inline in the transcript.
import { createAskUserTool } from '../../../../plugins/ask-user/src/server/createAskUserTool'
import { AskUserRuntime } from '../../../../plugins/ask-user/src/server/askUserRuntime'
import { FileAskUserStore } from '../../../../plugins/ask-user/src/server/askUserStore'
import { questionsRoutes } from '../../../../plugins/ask-user/src/server/questionsRoutes'
import type { AskUserQuestion } from '../../../../plugins/ask-user/src/shared/types'

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

  return {
    tool,
    async registerRoutes(app) {
      // A question left pending by a previous run has no waiter any more: its
      // card would never resolve. Retire them before the first page load.
      for (const stale of await store.listPending()) {
        await runtime.cancelQuestion(stale.questionId, stale.sessionId, 'abandoned').catch(() => undefined)
      }
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
