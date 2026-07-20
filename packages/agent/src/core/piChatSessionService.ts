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
import type { SessionActivity, SessionActivityOptions, SessionListOptions, SessionSummary } from '../shared/session'

export interface PiSessionRequestContext {
  workspaceId?: string
  storageScope?: string
  authSubject?: string
  authEmail?: string
  authEmailVerified?: boolean
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

export interface PiChatAttachmentResult {
  data: Uint8Array
  mediaType: string
  filename?: string
}

export interface PiChatSessionService {
  listSessions?(ctx: PiSessionRequestContext, options?: SessionListOptions): Promise<SessionSummary[]>
  listSessionActivity?(ctx: PiSessionRequestContext, options: SessionActivityOptions): Promise<SessionActivity[]>
  createSession?(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary>
  deleteSession?(ctx: PiSessionRequestContext, sessionId: string): Promise<void>
  readAttachment?(ctx: PiSessionRequestContext, sessionId: string, messageId: string, index: number): Promise<PiChatAttachmentResult>
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
  deleteSession(ctx: PiSessionRequestContext, sessionId: string): Promise<void>
  dispose?(): Promise<void>
}

export type AgentEffectAdmission = (
  ctx: Pick<PiSessionRequestContext, 'workspaceId' | 'requestId'>,
) => Promise<void>

export class AgentEffectAdmissionError extends Error {
  readonly statusCode = 500

  constructor(
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code)
    this.name = 'AgentEffectAdmissionError'
  }
}

type AgentEffectMethod = Exclude<keyof AgentCoreSessionService, 'listSessions' | 'listSessionActivity' | 'readAttachment' | 'readState' | 'subscribe' | 'dispose'>

export const AGENT_EFFECT_METHODS = {
  createSession: true,
  deleteSession: true,
  prompt: true,
  followUp: true,
  clearQueue: true,
  interrupt: true,
  stop: true,
} as const satisfies Record<AgentEffectMethod, true>

export function withAgentEffectAdmission(
  service: AgentCoreSessionService,
  admit: AgentEffectAdmission,
): AgentCoreSessionService {
  return {
    ...(service.listSessions
      ? { listSessions: (ctx, options) => service.listSessions!(ctx, options) }
      : {}),
    ...(service.listSessionActivity
      ? { listSessionActivity: (ctx, options) => service.listSessionActivity!(ctx, options) }
      : {}),
    async createSession(ctx, init) { await admit(ctx); return service.createSession(ctx, init) },
    async deleteSession(ctx, sessionId) { await admit(ctx); return service.deleteSession(ctx, sessionId) },
    ...(service.readAttachment
      ? { readAttachment: (ctx, sessionId, messageId, index) => service.readAttachment!(ctx, sessionId, messageId, index) }
      : {}),
    readState: (ctx, sessionId) => service.readState(ctx, sessionId),
    subscribe: (ctx, sessionId, cursor, subscriber) => service.subscribe(ctx, sessionId, cursor, subscriber),
    async prompt(ctx, sessionId, payload) { await admit(ctx); return service.prompt(ctx, sessionId, payload) },
    async followUp(ctx, sessionId, payload) { await admit(ctx); return service.followUp(ctx, sessionId, payload) },
    async clearQueue(ctx, sessionId, payload) { await admit(ctx); return service.clearQueue(ctx, sessionId, payload) },
    async interrupt(ctx, sessionId, payload) { await admit(ctx); return service.interrupt(ctx, sessionId, payload) },
    async stop(ctx, sessionId, payload) { await admit(ctx); return service.stop(ctx, sessionId, payload) },
    ...(service.dispose ? { dispose: () => service.dispose!() } : {}),
  }
}
