import { ErrorCode } from '../../../shared/error-codes'
import type { PiSessionRequestContext } from '../../../core/piChatSessionService'
import { codedError } from '../../codedError'
import { HarnessPiChatService, type HarnessPiChatServiceOptions } from '../../pi-chat/harnessPiChatService'
import type { AgentHarness } from '../../../shared/harness'
import type { SessionStore } from '../../../shared/session'
import type { Workspace } from '../../../shared/workspace'
import type { PiChatEvent } from '../../../shared/chat'
import type { EventStreamStore } from '../../events/eventStreamStore'
import type { AgentMeteringSink } from '../../pi-chat/metering'
import type {
  AgentHarnessBackend,
  HarnessAgentScope,
  HarnessRequestContext,
  HarnessSessionAddress,
} from './types'

function toPiSessionRequestContext(
  target: HarnessSessionAddress | HarnessAgentScope,
  ctx: HarnessRequestContext,
): PiSessionRequestContext {
  return {
    workspaceId: target.workspaceScopeId,
    storageScope: target.workspaceScopeId,
    authSubject: ctx.authSubjectId,
    sessionAuthority: 'workspace-scope',
    requestId: ctx.requestId,
  }
}

function rethrowSnapshotServiceError(error: unknown): never {
  const candidate = error as Error & { code?: unknown; statusCode?: unknown }
  if (
    error instanceof Error
    && candidate.code === ErrorCode.enum.SESSION_NOT_FOUND
    && candidate.statusCode === undefined
  ) {
    // Preserve the service error identity while completing its stable shape.
    Object.assign(candidate, { statusCode: 404 })
  }
  throw error
}

/** Built once per runtime binding; deliberately carries no credentials or membership. */
export interface AgentHarnessBackendFactoryInput {
  readonly harness: AgentHarness
  readonly sessionStore: SessionStore
  readonly workdir: string
  readonly workspace?: Workspace
  readonly eventStore?: EventStreamStore
  readonly metering?: AgentMeteringSink
  readonly onEvent?: (sessionId: string, event: PiChatEvent) => void
  readonly attachmentUrl?: HarnessPiChatServiceOptions['attachmentUrl']
}

export function createPiSessionHarnessBackend(
  input: AgentHarnessBackendFactoryInput,
): AgentHarnessBackend {
  const service = new HarnessPiChatService(input)
  let closed = false
  let closing: Promise<void> | undefined
  const assertOpen = () => {
    if (closed) {
      throw codedError(
        'Pi chat service has been disposed.',
        ErrorCode.enum.AGENT_BINDING_DISPOSED,
      )
    }
  }

  return {
    async listSessions(scope, ctx, options) {
      assertOpen()
      return await service.listSessions(toPiSessionRequestContext(scope, ctx), options)
    },
    async createSession(scope, ctx, init) {
      assertOpen()
      return await service.createSession(toPiSessionRequestContext(scope, ctx), init)
    },
    async readSnapshot(address, ctx) {
      assertOpen()
      try {
        return await service.readState(toPiSessionRequestContext(address, ctx), address.ref.sessionId)
      } catch (error) {
        rethrowSnapshotServiceError(error)
      }
    },
    async watchEvents(address, ctx, cursor, subscriber) {
      assertOpen()
      return await service.subscribe(
        toPiSessionRequestContext(address, ctx),
        address.ref.sessionId,
        cursor,
        subscriber,
      )
    },
    async submitPrompt(address, ctx, payload) {
      assertOpen()
      return await service.prompt(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
    },
    async submitFollowUp(address, ctx, payload) {
      assertOpen()
      return await service.followUp(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
    },
    async clearQueue(address, ctx, payload) {
      assertOpen()
      return await service.clearQueue(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
    },
    async interrupt(address, ctx, payload) {
      assertOpen()
      return await service.interrupt(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
    },
    async stop(address, ctx, payload) {
      assertOpen()
      return await service.stop(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
    },
    async renameSession(address, _ctx, title) {
      assertOpen()
      if (!input.sessionStore.rename) {
        throw codedError(
          'session repository does not support rename',
          ErrorCode.enum.BRIDGE_COMMAND_INVALID,
          409,
        )
      }
      return await input.sessionStore.rename(
        { workspaceId: address.workspaceScopeId },
        address.ref.sessionId,
        title,
      )
    },
    async deleteSession(address, ctx) {
      assertOpen()
      await service.deleteSession(toPiSessionRequestContext(address, ctx), address.ref.sessionId)
    },
    async readAttachment(address, ctx, messageId, index) {
      assertOpen()
      return await service.readAttachment(
        toPiSessionRequestContext(address, ctx),
        address.ref.sessionId,
        messageId,
        index,
      )
    },
    close() {
      if (!closing) {
        closed = true
        closing = service.dispose()
      }
      return closing
    },
  }
}
