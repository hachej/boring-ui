import { randomUUID } from 'node:crypto'

import type { FastifyRequest } from 'fastify'
import type { InterruptReceipt, PiChatEvent, StopReceipt } from '../shared/chat'
import type { AgentEvent, AgentMessageContent } from '../shared/events'
import { ErrorCode } from '../shared/error-codes'
import type { Workspace } from '../shared/workspace'
import type {
  WorkspaceAgentDispatch,
  WorkspaceAgentDispatcher,
  WorkspaceAgentDispatcherContext,
  WorkspaceAgentDispatcherDispatchInput,
  WorkspaceAgentGatewayBinding,
} from '../shared/workspaceAgentDispatcher'

export interface WorkspaceAgentDispatcherResolveOptions {
  request?: FastifyRequest
}

export interface WorkspaceAgentDispatcherBinding {
  dispatcher: WorkspaceAgentDispatcher
  workspace: Workspace
  /**
   * Trusted host seam used by local integrations that must bind durable work
   * to the exact logical Pi session before accepting it.
   */
  ensurePiSessionBound?(
    sessionId: string,
    sessionCtx?: { workspaceId?: string; userId?: string },
  ): Promise<{
    /** Trusted, session-bound visible user-turn target for local host integrations. */
    visibleUserMessageTarget?: {
      isIdle(): Promise<boolean>
      send(message: string, displayMessage?: string): Promise<void>
    }
  }>
}

export interface WorkspaceAgentDispatcherResolver {
  resolve(
    ctx: WorkspaceAgentDispatcherContext,
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<WorkspaceAgentDispatcher>
  resolveWithWorkspace?(
    ctx: WorkspaceAgentDispatcherContext,
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<WorkspaceAgentDispatcherBinding>
}

/**
 * Bind the compatibility dispatcher surface to one addressed AgentGateway
 * capability. The gateway, scope, and agent type are supplied only by the
 * trusted composition root.
 */
export function createBoundWorkspaceAgentDispatcher(
  binding: WorkspaceAgentGatewayBinding,
  ctx: WorkspaceAgentDispatcherContext,
): WorkspaceAgentDispatcher {
  normalizeWorkspaceAgentDispatcherContext(ctx)

  const refFor = (sessionId: string) => ({
    agentTypeId: binding.agentTypeId,
    sessionId,
  })

  return {
    async dispatch(input) {
      return await dispatchGatewayInput(binding, input)
    },
    send(input) {
      return {
        async *[Symbol.asyncIterator]() {
          const dispatched = await dispatchGatewayInput(binding, {
            ...input,
            requestId: randomUUID(),
          })
          yield* dispatched.events
        },
      }
    },
    async interrupt(sessionId) {
      const connection = await binding.gateway.connectSession({
        scope: binding.scope,
        ref: refFor(sessionId),
      })
      try {
        return await connection.interrupt({ requestId: randomUUID() })
      } finally {
        await connection.close()
      }
    },
    async stop(sessionId) {
      const connection = await binding.gateway.connectSession({
        scope: binding.scope,
        ref: refFor(sessionId),
      })
      try {
        return await connection.stop({ requestId: randomUUID() })
      } finally {
        await connection.close()
      }
    },
  }
}

async function dispatchGatewayInput(
  binding: WorkspaceAgentGatewayBinding,
  input: WorkspaceAgentDispatcherDispatchInput,
): Promise<WorkspaceAgentDispatch> {
  const requestId = requireNonEmpty(input.requestId, 'requestId')
  const ref = input.sessionId
    ? { agentTypeId: binding.agentTypeId, sessionId: input.sessionId }
    : await binding.gateway.createSession({
        scope: binding.scope,
        agentTypeId: binding.agentTypeId,
        requestId,
        title: input.title?.trim() || contentToText(input.content ?? input.message).slice(0, 80) || undefined,
      })
  const connection = await binding.gateway.connectSession({
    scope: binding.scope,
    ref,
  })
  try {
    const content = contentToText(input.content ?? input.message)
    const clientNonce = input.clientNonce?.trim() || requestId
    const receipt = input.kind === 'followup'
      ? await connection.send({
          kind: 'followup',
          requestId,
          clientNonce,
          clientSeq: requireClientSeq(input.clientSeq),
          content,
        })
      : await connection.send({
          kind: 'prompt',
          requestId,
          clientNonce,
          content,
          ...(input.model ? { model: input.model } : {}),
          ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
          ...(input.attachments ? { attachments: input.attachments } : {}),
        })
    return {
      ref,
      receipt,
      events: projectGatewayEvents(connection.events, connection.close.bind(connection)),
    }
  } catch (error) {
    await connection.close().catch(() => undefined)
    throw error
  }
}

async function* projectGatewayEvents(
  events: AsyncIterable<{ readonly seq: number; readonly ref: { readonly sessionId: string }; readonly event: unknown }>,
  close: () => Promise<void>,
): AsyncIterable<AgentEvent> {
  try {
    for await (const envelope of events) {
      const chunk = envelope.event as PiChatEvent
      yield {
        v: 1,
        eventIndex: envelope.seq,
        timestamp: Date.now(),
        sessionId: envelope.ref.sessionId,
        chunk,
      }
      if (isTerminalEvent(chunk)) return
    }
  } finally {
    await close()
  }
}

function isTerminalEvent(event: PiChatEvent): boolean {
  return event.type === 'error' || (event.type === 'agent-end' && event.willRetry !== true)
}

function contentToText(content: AgentMessageContent | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n')
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new TypeError(`${name} is required`)
  return normalized
}

function requireClientSeq(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value < 0) {
    throw new TypeError('follow-up clientSeq must be a non-negative integer')
  }
  return value
}

export function assertWorkspaceAgentDispatcherRequestContext(
  ctx: WorkspaceAgentDispatcherContext,
  request: FastifyRequest | undefined,
): void {
  normalizeWorkspaceAgentDispatcherContext(ctx)
  if (!request) return
  const requestWorkspaceId = request.workspaceContext?.workspaceId?.trim()
  if (!requestWorkspaceId) return
  if (requestWorkspaceId !== ctx.workspaceId.trim()) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.UNAUTHORIZED,
      'workspace agent dispatcher context does not match request workspace',
      401,
    )
  }
}

export function normalizeWorkspaceAgentDispatcherContext(
  ctx: WorkspaceAgentDispatcherContext,
): WorkspaceAgentDispatcherContext {
  const workspaceId = ctx.workspaceId?.trim()
  const userId = ctx.userId?.trim()
  if (!workspaceId) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.WORKSPACE_UNINITIALIZED,
      'workspace id is required',
      400,
    )
  }
  if (!userId) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.UNAUTHORIZED,
      'user id is required',
      401,
    )
  }
  return { workspaceId, userId }
}

export function createWorkspaceAgentDispatcherError(
  code: typeof ErrorCode.enum[keyof typeof ErrorCode.enum],
  message: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  const error = new Error(message) as Error & { code: string; statusCode: number }
  error.code = code
  error.statusCode = statusCode
  return error
}
