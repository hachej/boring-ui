import type { AuthorizedAgentScope, JsonValue } from '../../shared/index'
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
  }): Promise<T> => await input.gateway.runLegacyCompatibilityEffect({
    scope: input.scope,
    operation: options.operation,
    target: options.target,
    requestId: options.requestId,
    payload: jsonProjection(options.payload),
    action: options.action,
  }) as T

  return {
    ...(input.service.listSessions
      ? { listSessions: (ctx, options) => input.service.listSessions!(ctx, options) }
      : {}),
    createSession: (ctx, init) => effect({
      operation: 'session.create',
      target: { kind: 'agent', agentTypeId: input.agentTypeId },
      requestId: ctx.requestId,
      payload: { title: init?.title ?? null, modelDefault: init?.modelDefault ?? null },
      action: () => input.service.createSession(ctx, init),
    }),
    async deleteSession(ctx, sessionId) {
      await effect({
        operation: 'session.delete',
        target: sessionTarget(input.agentTypeId, sessionId),
        requestId: ctx.requestId,
        payload: {},
        action: async () => {
          await input.service.deleteSession(ctx, sessionId)
          return null
        },
      })
    },
    ...(input.service.readAttachment
      ? { readAttachment: (ctx, sessionId, messageId, index) => input.service.readAttachment!(ctx, sessionId, messageId, index) }
      : {}),
    readState: (ctx, sessionId) => input.service.readState(ctx, sessionId),
    subscribe: (ctx, sessionId, cursor, subscriber) => input.service.subscribe(ctx, sessionId, cursor, subscriber),
    prompt: (ctx, sessionId, payload) => effect({
      operation: 'session.prompt',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForPayload(ctx, payload.clientNonce),
      payload,
      action: () => input.service.prompt(ctx, sessionId, payload),
    }),
    followUp: (ctx, sessionId, payload) => effect({
      operation: 'session.followup',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForPayload(ctx, payload.clientNonce),
      payload,
      action: () => input.service.followUp(ctx, sessionId, payload),
    }),
    clearQueue: (ctx, sessionId, payload) => effect({
      operation: 'session.queue.clear',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: requestIdForPayload(ctx, payload.clientNonce),
      payload,
      action: () => input.service.clearQueue(ctx, sessionId, payload),
    }),
    interrupt: (ctx, sessionId, payload) => effect({
      operation: 'session.interrupt',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: ctx.requestId,
      payload,
      action: () => input.service.interrupt(ctx, sessionId, payload),
    }),
    stop: (ctx, sessionId, payload) => effect({
      operation: 'session.stop',
      target: sessionTarget(input.agentTypeId, sessionId),
      requestId: ctx.requestId,
      payload,
      action: () => input.service.stop(ctx, sessionId, payload),
    }),
  }
}
