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
import type { SessionListOptions, SessionSummary } from '../../../shared/session'

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
  listSessions(
    scope: HarnessAgentScope,
    ctx: HarnessRequestContext,
    options?: SessionListOptions,
  ): Promise<SessionSummary[]>
  createSession(
    scope: HarnessAgentScope,
    ctx: HarnessRequestContext,
    init?: import('../../../shared/session').SessionCreateInit,
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
