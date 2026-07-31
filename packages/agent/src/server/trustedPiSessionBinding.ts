import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

import type {
  AgentCoreSessionService,
  PiChatSessionService,
  PiSessionRequestContext,
} from '../core/piChatSessionService'
import { ErrorCode } from '../shared/error-codes'
import type { WorkspaceAgentDispatcherContext } from '../shared/workspaceAgentDispatcher'
import {
  createWorkspaceAgentDispatcherError,
  type BoundPiSession,
} from './workspaceAgentDispatcher'

interface TrustedPiSessionServices {
  binding: AgentCoreSessionService
  prompt: Pick<PiChatSessionService, 'prompt'>
}

export async function bindTrustedPiSession(input: {
  ctx: WorkspaceAgentDispatcherContext
  request?: FastifyRequest
  sessionId: string
  requested?: { workspaceId?: string; userId?: string }
  withServices<T>(effect: (services: TrustedPiSessionServices) => Promise<T>): Promise<T>
}): Promise<BoundPiSession> {
  const sessionContext = trustedPiSessionContext(input.ctx, input.request, input.requested)
  await input.withServices(async ({ binding }) => {
    if (!binding.ensurePiSessionBound) {
      throw createWorkspaceAgentDispatcherError(
        ErrorCode.enum.INTERNAL_ERROR,
        'Pi session binding is unavailable',
        500,
      )
    }
    return await binding.ensurePiSessionBound(sessionContext, input.sessionId)
  })
  return {
    visibleUserMessageTarget: {
      async isIdle() {
        return await input.withServices(async ({ binding }) => {
          const snapshot = await binding.readState(sessionContext, input.sessionId)
          return snapshot.status === 'idle'
        })
      },
      async send(message, displayMessage) {
        await input.withServices(async ({ prompt }) => {
          await prompt.prompt(sessionContext, input.sessionId, {
            message,
            displayMessage: displayMessage ?? message,
            clientNonce: `trusted-visible-turn:${randomUUID()}`,
          })
        })
      },
    },
  }
}

function trustedPiSessionContext(
  ctx: WorkspaceAgentDispatcherContext,
  request?: FastifyRequest,
  requested?: { workspaceId?: string; userId?: string },
): PiSessionRequestContext {
  if (requested?.workspaceId && requested.workspaceId !== ctx.workspaceId) {
    throw createWorkspaceAgentDispatcherError(ErrorCode.enum.UNAUTHORIZED, 'Pi session workspace context mismatch', 401)
  }
  if (requested?.userId && requested.userId !== ctx.userId) {
    throw createWorkspaceAgentDispatcherError(ErrorCode.enum.UNAUTHORIZED, 'Pi session user context mismatch', 401)
  }
  return {
    workspaceId: requested?.workspaceId ?? ctx.workspaceId,
    authSubject: requested?.userId ?? ctx.userId,
    requestId: request?.id ?? `trusted:${ctx.workspaceId}:${ctx.userId}`,
  }
}
