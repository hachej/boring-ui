import type {
  AgentPromptPayload,
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptPayload,
  PiChatAttachmentResult,
  PiChatEvent,
  PiChatSnapshot,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopPayload,
  StopReceipt,
} from '../../../shared/chat'
import type { AgentSessionRef } from '../../../shared/gateway/types'
import type { AgentHarness } from '../../../shared/harness'
import type { SessionListOptions, SessionStore, SessionSummary } from '../../../shared/session'
import type { Workspace } from '../../../shared/workspace'
import type { EventStreamStore } from '../../events/eventStreamStore'
import type { HarnessPiChatServiceOptions } from '../../pi-chat/harnessPiChatService'
import type { AgentMeteringSink } from '../../pi-chat/metering'

/** Workspace-scoped addressing. Pi-native identities remain adapter-private. */
export interface HarnessSessionAddress {
  readonly workspaceScopeId: string
  readonly ref: AgentSessionRef
}

export interface HarnessAgentScope {
  readonly workspaceScopeId: string
  readonly agentTypeId: string
}

/** Attribution only: authSubjectId is never session-storage ownership. */
export interface HarnessRequestContext {
  readonly requestId: string
  readonly authSubjectId: string
}

export type HarnessWatchResult =
  | { readonly type: 'ok'; unsubscribe(): void; readonly closed?: Promise<void> }
  | { readonly type: 'replay_gap' | 'cursor_ahead'; readonly latestSeq: number; readonly minReplaySeq: number }

/**
 * Private D29 runtime seam. The Gateway ledger is the sole idempotency
 * authority; callers may retry only after ledger admission.
 */
export interface AgentHarnessBackend {
  readonly id: string
  listSessions(
    scope: HarnessAgentScope,
    ctx: HarnessRequestContext,
    options?: SessionListOptions,
  ): Promise<SessionSummary[]>
  createSession(
    scope: HarnessAgentScope,
    ctx: HarnessRequestContext,
    init?: { title?: string },
  ): Promise<SessionSummary>
  readSnapshot(address: HarnessSessionAddress, ctx: HarnessRequestContext): Promise<PiChatSnapshot>
  watchEvents(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    cursor: number,
    subscriber: (event: PiChatEvent) => void,
  ): Promise<HarnessWatchResult>
  submitPrompt(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    payload: AgentPromptPayload,
  ): Promise<PromptReceipt>
  submitFollowUp(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    payload: FollowUpPayload,
  ): Promise<FollowUpReceipt>
  clearQueue(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    payload: QueueClearPayload,
  ): Promise<QueueClearReceipt>
  interrupt(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    payload: InterruptPayload,
  ): Promise<CommandReceipt>
  stop(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    payload: StopPayload,
  ): Promise<StopReceipt>
  renameSession(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    title: string,
  ): Promise<SessionSummary>
  deleteSession(address: HarnessSessionAddress, ctx: HarnessRequestContext): Promise<void>
  readAttachment(
    address: HarnessSessionAddress,
    ctx: HarnessRequestContext,
    messageId: string,
    index: number,
  ): Promise<PiChatAttachmentResult>
  close(): Promise<void>
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
