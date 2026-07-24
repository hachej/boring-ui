import type {
  ChatAttachmentPayload,
  ChatModelSelection,
  CommandReceipt as PiCommandReceipt,
  PiChatSnapshot,
  QueueClearReceipt as PiQueueClearReceipt,
  QueuedUserMessage,
  StopReceipt as PiStopReceipt,
  ThinkingLevel,
} from '../chat'
import type { AgentSessionEvent } from './events'

export type WorkspaceScopeId = string
export type AuthSubjectId = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Maps unknown event leaves onto the JSON transport boundary. */
export type JsonSafe<T> = unknown extends T
  ? JsonValue
  : T extends JsonPrimitive
    ? T
    : T extends (...args: readonly never[]) => unknown
      ? never
      : T extends readonly (infer U)[]
        ? readonly JsonSafe<U>[]
        : T extends object
          ? { readonly [K in keyof T]: JsonSafe<T[K]> }
          : never

/** Verified identity facts returned only by the app-owned verifier. */
export interface VerifiedAgentScopeClaim {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
}

declare const authorizedAgentScope: unique symbol

/**
 * Issuer-owned runtime capability. It is deliberately not a transport DTO and
 * must be checked by issuer identity and current membership on every use.
 */
export interface AuthorizedAgentScope {
  readonly workspaceScopeId: WorkspaceScopeId
  readonly authSubjectId: AuthSubjectId
  readonly [authorizedAgentScope]: true
}

export interface AgentScopeVerifier {
  verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim>
}

export interface AgentSessionRef {
  readonly agentTypeId: string
  readonly sessionId: string
}

export interface AgentSummary {
  readonly agentTypeId: string
  readonly label: string
  readonly description?: string
  readonly definition?: {
    readonly version: string
    readonly digest: string
  }
}

export interface ListAgentsInput {
  readonly scope: AuthorizedAgentScope
}

export interface AuthorizedAgentSessionQuery {
  readonly scope: AuthorizedAgentScope
  readonly agentTypeId?: string
  readonly cursor?: string
  readonly limit?: number
}

export type AgentSessionActivity = 'idle' | 'running' | 'aborting' | 'error'

export interface AgentSessionSummary {
  readonly ref: AgentSessionRef
  readonly title: string
  readonly status: AgentSessionActivity
  readonly createdAt: number
  readonly updatedAt: number
}

export interface AgentSessionPage {
  readonly sessions: readonly AgentSessionSummary[]
  readonly nextCursor?: string
}

export interface CreateAgentSessionInput {
  readonly scope: AuthorizedAgentScope
  readonly agentTypeId: string
  readonly requestId: string
  readonly title?: string
}

export interface ConnectAgentSessionInput {
  readonly scope: AuthorizedAgentScope
  readonly ref: AgentSessionRef
  readonly cursor?: number
}

export interface ReadAgentSessionStateInput {
  readonly scope: AuthorizedAgentScope
  readonly ref: AgentSessionRef
}

export interface RenameAgentSessionInput {
  readonly scope: AuthorizedAgentScope
  readonly ref: AgentSessionRef
  readonly requestId: string
  readonly title: string
}

export interface DeleteAgentSessionInput {
  readonly scope: AuthorizedAgentScope
  readonly ref: AgentSessionRef
  readonly requestId: string
}

export interface AgentPromptCommand {
  readonly kind: 'prompt'
  readonly requestId: string
  readonly clientNonce: string
  readonly content: string
  readonly displayContent?: string
  readonly model?: ChatModelSelection
  readonly thinkingLevel?: ThinkingLevel
  readonly attachments?: readonly ChatAttachmentPayload[]
}

export interface AgentFollowUpCommand {
  readonly kind: 'followup'
  readonly requestId: string
  readonly clientNonce: string
  readonly content: string
  readonly displayContent?: string
  readonly clientSeq: number
}

export type IdempotentAgentSend = AgentPromptCommand | AgentFollowUpCommand

export interface IdempotentAgentControl {
  readonly requestId: string
}

export interface IdempotentQueueClear extends IdempotentAgentControl {
  readonly clientNonce?: string
  readonly clientSeq?: number
}

export type CommandReceipt = PiCommandReceipt

export interface AgentSendReceipt extends CommandReceipt {
  readonly disposition: 'prompt' | 'followup'
  readonly clientNonce: string
  readonly duplicate?: boolean
  readonly clientSeq?: number
}

export type QueueClearReceipt = PiQueueClearReceipt
export type StopReceipt = PiStopReceipt

export interface AgentSessionStateSnapshot {
  readonly ref: AgentSessionRef
  readonly seq: number
  readonly summary: AgentSessionSummary
  readonly state: PiChatSnapshot
}

export interface AgentSessionConnection {
  readonly ref: AgentSessionRef
  readonly events: AsyncIterable<AgentSessionEvent>
  send(input: IdempotentAgentSend): Promise<AgentSendReceipt>
  interrupt(input: IdempotentAgentControl): Promise<CommandReceipt>
  stop(input: IdempotentAgentControl): Promise<StopReceipt>
  clearQueue(input: IdempotentQueueClear): Promise<QueueClearReceipt>
  close(): Promise<void>
}

export interface AgentGateway {
  listAgents(input: ListAgentsInput): Promise<readonly AgentSummary[]>
  listSessions(input: AuthorizedAgentSessionQuery): Promise<AgentSessionPage>
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>
  connectSession(input: ConnectAgentSessionInput): Promise<AgentSessionConnection>
  readSessionState(input: ReadAgentSessionStateInput): Promise<AgentSessionStateSnapshot>
  renameSession(input: RenameAgentSessionInput): Promise<AgentSessionSummary>
  deleteSession(input: DeleteAgentSessionInput): Promise<void>
  close(): Promise<void>
}

export type { QueuedUserMessage }
