import type { InterruptReceipt, StopReceipt } from './chat'
import type { AgentEvent, AgentSendInput } from './events'
import type { Workspace } from './workspace'
import type {
  AgentGateway,
  AgentSendReceipt,
  AgentSessionPage,
  AgentSessionRef,
  AuthorizedAgentScope,
} from './gateway/types'

export interface WorkspaceAgentDispatcherContext {
  workspaceId: string
  userId: string
}

export type WorkspaceAgentDispatcherSendInput = Omit<AgentSendInput, 'ctx'>

export interface WorkspaceAgentDispatcherDispatchInput extends WorkspaceAgentDispatcherSendInput {
  /** Optional user-visible presentation when content carries hidden instructions. */
  displayMessage?: string
  /** Optional title for a newly created addressed session. */
  title?: string
  /** Durable caller-owned idempotency key. */
  requestId: string
  /** Defaults to requestId. */
  clientNonce?: string
  /** Defaults to prompt; follow-up requires a non-negative clientSeq. */
  kind?: 'prompt' | 'followup'
  clientSeq?: number
}

export interface WorkspaceAgentDispatch {
  ref: AgentSessionRef
  receipt: AgentSendReceipt
  events: AsyncIterable<AgentEvent>
}

/**
 * Callback-scoped direct Agent capability. The Workspace and operations are
 * lease guarded by the Host and must not be retained after the callback.
 */
export type AgentSendIfIdleReceipt =
  | { status: 'accepted'; receipt: AgentSendReceipt }
  | { status: 'not-idle' }

export interface LeaseBoundWorkspaceAgent {
  readonly workspace: Workspace
  readonly signal: AbortSignal
  dispatch(
    input: WorkspaceAgentDispatcherDispatchInput,
    onEvent: (event: AgentEvent) => void | Promise<void>,
    onAccepted?: (accepted: { readonly ref: AgentSessionRef; readonly receipt: AgentSendReceipt }) => void | Promise<void>,
  ): Promise<{
    readonly ref: AgentSessionRef
    readonly receipt: AgentSendReceipt
  }>
  /** Transcript-redacted sessions for this exact Agent and authorized scope. */
  listSessions(limit?: number): Promise<AgentSessionPage>
  /** Atomically prompt an idle session and return after host acceptance. */
  sendIfIdle(sessionId: string, message: string, requestId: string): Promise<AgentSendIfIdleReceipt>
  interrupt(sessionId: string, requestId: string): Promise<InterruptReceipt>
  stop(sessionId: string, requestId: string): Promise<StopReceipt>
}

export interface WorkspaceAgentDirectRunInput {
  readonly agentTypeId: string
  readonly context: WorkspaceAgentDispatcherContext
  readonly requestId: string
}

export type WorkspaceAgentDirectRunCallback = (
  binding: LeaseBoundWorkspaceAgent,
) => Promise<void>

/** Addressed gateway binding minted by the trusted composition root. */
export interface WorkspaceAgentGatewayBinding {
  gateway: AgentGateway
  scope: AuthorizedAgentScope
  agentTypeId: string
}

/**
 * Compatibility-facing delegation surface. New durable callers use dispatch so
 * the addressed ref and accepted Gateway receipt can be persisted before they
 * consume events. send remains for callers that only need the legacy stream.
 */
export interface WorkspaceAgentDispatcher {
  /** Optional only for source compatibility with pre-Gateway injected resolvers. */
  dispatch?(input: WorkspaceAgentDispatcherDispatchInput): Promise<WorkspaceAgentDispatch>
  send(input: WorkspaceAgentDispatcherSendInput): AsyncIterable<AgentEvent>
  interrupt(sessionId: string): Promise<InterruptReceipt>
  stop(sessionId: string): Promise<StopReceipt>
}
