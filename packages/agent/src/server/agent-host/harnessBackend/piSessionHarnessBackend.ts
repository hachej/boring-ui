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
    childEffectCapability: ctx.childEffectCapability,
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
  readonly agentTypeId: string
  readonly harness: AgentHarness
  readonly sessionStore: SessionStore
  readonly workdir: string
  readonly workspace?: Workspace
  readonly eventStore?: EventStreamStore
  readonly metering?: AgentMeteringSink
  readonly onEvent?: (sessionId: string, event: PiChatEvent) => void
  readonly onRunEvent?: (input: {
    readonly sessionId: string
    readonly context: HarnessRequestContext
    readonly event: PiChatEvent
  }) => void
  readonly attachmentUrl?: HarnessPiChatServiceOptions['attachmentUrl']
}

export function createPiSessionHarnessBackend(
  input: AgentHarnessBackendFactoryInput,
): AgentHarnessBackend {
  const pendingRuns = new Map<string, HarnessRequestContext[]>()
  const activeRuns = new Map<string, HarnessRequestContext>()
  const service = new HarnessPiChatService({
    ...input,
    onEvent(sessionId, event) {
      input.onEvent?.(sessionId, event)
      if (event.type === 'agent-start') {
        const queued = pendingRuns.get(sessionId) ?? []
        const context = queued.shift()
        if (queued.length === 0) pendingRuns.delete(sessionId)
        if (context) {
          activeRuns.set(JSON.stringify([sessionId, event.turnId]), context)
          input.onRunEvent?.({ sessionId, context, event })
        }
        return
      }
      if (event.type !== 'agent-end' && event.type !== 'error') return
      const turnId = event.turnId
      if (!turnId) return
      const activeKey = JSON.stringify([sessionId, turnId])
      const context = activeRuns.get(activeKey)
      if (!context) return
      input.onRunEvent?.({ sessionId, context, event })
      if (event.type === 'agent-end' && event.willRetry !== true) activeRuns.delete(activeKey)
    },
  })
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
      const pending = pendingRuns.get(address.ref.sessionId) ?? []
      pending.push({ ...ctx, runOperation: 'session.prompt' })
      pendingRuns.set(address.ref.sessionId, pending)
      try {
        return await service.prompt(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
      } catch (error) {
        const index = pending.findIndex((candidate) => candidate.requestId === ctx.requestId)
        if (index >= 0) pending.splice(index, 1)
        throw error
      }
    },
    async submitFollowUp(address, ctx, payload) {
      assertOpen()
      const pending = pendingRuns.get(address.ref.sessionId) ?? []
      pending.push({ ...ctx, runOperation: 'session.followup' })
      pendingRuns.set(address.ref.sessionId, pending)
      try {
        return await service.followUp(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
      } catch (error) {
        const matching = pending.findIndex((candidate) => candidate.requestId === ctx.requestId)
        if (matching >= 0) pending.splice(matching, 1)
        throw error
      }
    },
    async clearQueue(address, ctx, payload) {
      assertOpen()
      const receipt = await service.clearQueue(toPiSessionRequestContext(address, ctx), address.ref.sessionId, payload)
      const remaining = (pendingRuns.get(address.ref.sessionId) ?? []).filter((candidate) => candidate.runOperation !== 'session.followup')
      if (remaining.length === 0) pendingRuns.delete(address.ref.sessionId)
      else pendingRuns.set(address.ref.sessionId, remaining)
      return receipt
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
      pendingRuns.delete(address.ref.sessionId)
      for (const key of activeRuns.keys()) {
        if ((JSON.parse(key) as [string, string])[0] === address.ref.sessionId) activeRuns.delete(key)
      }
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
