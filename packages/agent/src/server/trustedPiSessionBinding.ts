import type { FastifyRequest } from 'fastify'

import type {
  AgentCoreSessionService,
  PiChatSessionService,
  PiSessionRequestContext,
} from '../core/piChatSessionService'
import { ErrorCode } from '../shared/error-codes'
import { AgentGatewayError, AgentGatewayErrorCode } from '../shared/gateway/errors'
import type { WorkspaceAgentDispatcherContext } from '../shared/workspaceAgentDispatcher'
import {
  createWorkspaceAgentDispatcherError,
  type BoundPiSession,
} from './workspaceAgentDispatcher'

interface TrustedPiSessionServices {
  binding: AgentCoreSessionService
  prompt: Pick<PiChatSessionService, 'prompt'>
}

// TODO(agent-gateway migration): Delete this legacy partition bridge and
// AgentCoreSessionService.ensurePiSessionBound once browser Pi chat creates and
// addresses its sessions through AgentGateway instead of workspace/user storage.

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
      async sendIfIdle(sendInput) {
        const requestId = sendInput.requestId.trim()
        if (!requestId) throw new TypeError('requestId must be a non-empty string')
        try {
          const receipt = await input.withServices(async ({ prompt }) => await prompt.prompt(
            sessionContext,
            input.sessionId,
            {
              message: sendInput.message,
              displayMessage: sendInput.displayMessage ?? sendInput.message,
              clientNonce: requestId,
              requireIdle: true,
            },
          ))
          return {
            status: 'accepted' as const,
            cursor: receipt.cursor,
            ...(receipt.duplicate ? { duplicate: true } : {}),
          }
        } catch (error) {
          if (error instanceof AgentGatewayError && error.code === AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE) {
            return { status: 'busy' as const }
          }
          if (isGoneSessionError(error)) return { status: 'gone' as const }
          throw error
        }
      },
    },
  }
}

function isGoneSessionError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND
    || code === AgentGatewayErrorCode.AGENT_SCOPE_DENIED
    || code === AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH
    || code === ErrorCode.enum.SESSION_NOT_FOUND
    || code === ErrorCode.enum.UNAUTHORIZED
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
