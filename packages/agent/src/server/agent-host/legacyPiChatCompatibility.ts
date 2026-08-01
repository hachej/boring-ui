import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGatewayErrorDTO,
  type AuthorizedAgentScope,
  type JsonValue,
} from '../../shared/index'
import type {
  AgentCoreSessionService,
  PiChatSessionService,
  PiSessionRequestContext,
} from '../../core/piChatSessionService'
import type { AgentGatewayEffect, AgentRequestTarget } from './types'

interface LegacyCompatibilityGateway {
  runLegacyCompatibilityEffect(input: {
    readonly scope: AuthorizedAgentScope
    readonly operation: AgentGatewayEffect
    readonly target: AgentRequestTarget
    readonly requestId: string
    readonly payload: JsonValue
    readonly action: () => Promise<unknown>
    readonly retryableGuard?: () => Promise<AgentGatewayErrorDTO | undefined>
  }): Promise<unknown>
}

function jsonProjection(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return null
  return JSON.parse(encoded) as JsonValue
}

function sessionTarget(agentTypeId: string, sessionId: string): AgentRequestTarget {
  return { kind: 'session', ref: { agentTypeId, sessionId } }
}

function requestIdForPayload(ctx: PiSessionRequestContext, clientNonce?: string): string {
  return clientNonce ?? ctx.requestId
}

/** Collision-safe and reversible identity for the frozen follow-up tuple. */
function requestIdForFollowUp(clientNonce: string, clientSeq: number): string {
  return `legacy-followup:${JSON.stringify([clientNonce, clientSeq])}`
}

/**
 * Legacy Pi-chat mutation projection onto the Host's Level-B request ledger.
 * Read/stream/attachment calls remain direct so their frozen wire is unchanged.
 */
export function createLegacyPiChatCompatibilityService(input: {
  readonly gateway: LegacyCompatibilityGateway
  readonly service: AgentCoreSessionService
  readonly scope: AuthorizedAgentScope
  readonly agentTypeId: string
}): PiChatSessionService {
  const effect = async <T>(options: {
    readonly operation: AgentGatewayEffect
    readonly target: AgentRequestTarget
    readonly requestId: string
    readonly payload: unknown
    readonly action: () => Promise<T>
    readonly retryableGuard?: () => Promise<AgentGatewayErrorDTO | undefined>
  }): Promise<T> => await input.gateway.runLegacyCompatibilityEffect({
    scope: input.scope,
    operation: options.operation,
    target: options.target,
    requestId: options.requestId,
    payload: jsonProjection(options.payload),
    action: options.action,
    ...(options.retryableGuard ? { retryableGuard: options.retryableGuard } : {}),
  }) as T

  const runtimeCtx = (ctx: PiSessionRequestContext): PiSessionRequestContext => ({
    ...ctx,
    liveSessionScopeId: input.scope.workspaceScopeId,
  })

  return {
    ...(input.service.listSessions
      ? { listSessions: (ctx, options) => input.service.listSessions!(runtimeCtx(ctx), options) }
      : {}),
    createSession: (ctx, init) => effect({
      operation: 'session.create',
      target: { kind: 'agent', agentTypeId: input.agentTypeId },
      requestId: ctx.requestId,
      payload: { title: init?.title ?? null, modelDefault: init?.modelDefault ?? null },
      action: () => input.service.createSession(runtimeCtx(ctx), init),
    }),
    ...(input.service.renameSession
      ? {
          renameSession: (ctx, sessionId, title) => effect({
            operation: 'session.rename',
            target: sessionTarget(input.agentTypeId, sessionId),
            requestId: ctx.requestId,
            payload: { title },
            action: () => input.service.renameSession!(runtimeCtx(ctx), sessionId, title),
          }),
        }
      : {}),
    async deleteSession(ctx, sessionId) {
      await effect({
        operation: 'session.delete',
        target: sessionTarget(input.agentTypeId, sessionId),
        requestId: ctx.requestId,
        payload: {},
        action: async () => {
          await input.service.deleteSession(runtimeCtx(ctx), sessionId)
          return null
        },
      })
    },
    ...(input.service.readAttachment
      ? { readAttachment: (ctx, sessionId, messageId, index) => input.service.readAttachment!(runtimeCtx(ctx), sessionId, messageId, index) }
      : {}),
    readState: (ctx, sessionId) => input.service.readState(runtimeCtx(ctx), sessionId),
    subscribe: (ctx, sessionId, cursor, subscriber) => input.service.subscribe(runtimeCtx(ctx), sessionId, cursor, subscriber),
    prompt: (ctx, sessionId, payload) => effect({
      operation: 'session.prompt',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForPayload(ctx, payload.clientNonce),
      payload,
      ...(payload.requireIdle ? {
        retryableGuard: async () => {
          const snapshot = await input.service.readState(runtimeCtx(ctx), sessionId)
          if (snapshot.status === 'idle') return undefined
          return new AgentGatewayError(
            AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
            'session is not idle',
            { status: snapshot.status },
          ).toJSON()
        },
      } : {}),
      action: () => input.service.prompt(runtimeCtx(ctx), sessionId, payload),
    }),
    followUp: (ctx, sessionId, payload) => effect({
      operation: 'session.followup',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForFollowUp(payload.clientNonce, payload.clientSeq),
      payload,
      action: () => input.service.followUp(runtimeCtx(ctx), sessionId, payload),
    }),
    clearQueue: (ctx, sessionId, payload) => effect({
      operation: 'session.queue.clear',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForPayload(ctx, payload.clientNonce),
      payload,
      action: () => input.service.clearQueue(runtimeCtx(ctx), sessionId, payload),
    }),
    interrupt: (ctx, sessionId, payload) => effect({
      operation: 'session.interrupt',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: ctx.requestId,
      payload,
      action: () => input.service.interrupt(runtimeCtx(ctx), sessionId, payload),
    }),
    stop: (ctx, sessionId, payload) => effect({
      operation: 'session.stop',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: ctx.requestId,
      payload,
      action: () => input.service.stop(runtimeCtx(ctx), sessionId, payload),
    }),
  }
}
