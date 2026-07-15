import type {
  ChatModelSelection,
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptPayload,
  PiChatEvent,
  PiChatSnapshot,
  PromptPayload,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopPayload,
  StopReceipt,
} from '../shared/chat'
import type { SessionListOptions, SessionSummary } from '../shared/session'

export interface PiSessionRequestContext {
  workspaceId?: string
  storageScope?: string
  authSubject?: string
  authEmail?: string
  authEmailVerified?: boolean
  browserDraftNative?: boolean
  requestId: string
}

export interface PiSessionCreateInit {
  title?: string
  modelDefault?: ChatModelSelection
}

export type PiChatReplayRangeError =
  | { type: 'replay_gap'; latestSeq: number; minReplaySeq: number }
  | { type: 'cursor_ahead'; latestSeq: number; minReplaySeq: number }

export interface PiChatEventStreamSubscription {
  type: 'ok'
  unsubscribe: () => void
  /** Optional test/service completion hook. Real live streams normally omit it. */
  closed?: Promise<void>
}

export type PiChatEventStreamResult = PiChatEventStreamSubscription | PiChatReplayRangeError

export type PiChatEventSubscriber = (event: PiChatEvent) => void

export interface PiChatSessionService {
  listSessions?(ctx: PiSessionRequestContext, options?: SessionListOptions): Promise<SessionSummary[]>
  createSession?(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary>
  renameSession?(ctx: PiSessionRequestContext, sessionId: string, title: string): Promise<SessionSummary>
  deleteSession?(ctx: PiSessionRequestContext, sessionId: string): Promise<void>
  readState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot>
  subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult>
  prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt>
  followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt>
  clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt>
  interrupt(ctx: PiSessionRequestContext, sessionId: string, payload: InterruptPayload): Promise<CommandReceipt>
  stop(ctx: PiSessionRequestContext, sessionId: string, payload: StopPayload): Promise<StopReceipt>
}

export interface AgentCoreSessionService extends PiChatSessionService {
  createSession(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary>
  renameSession(ctx: PiSessionRequestContext, sessionId: string, title: string): Promise<SessionSummary>
  deleteSession(ctx: PiSessionRequestContext, sessionId: string): Promise<void>
  dispose?(): Promise<void>
}
