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
  NativePromptReceipt,
  NativeSessionStart,
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
  createSession?(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary>
  /** Direct/local-only native first send. Absent in hosted/scoped compositions. */
  promptNewSession?(ctx: PiSessionRequestContext, payload: PromptPayload, start: NativeSessionStart): Promise<NativePromptReceipt>
  renameSession?(ctx: PiSessionRequestContext, sessionId: string, title: string): Promise<SessionSummary>
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

type AgentEffectMethod = Exclude<keyof AgentCoreSessionService, 'listSessions' | 'readAttachment' | 'readState' | 'subscribe' | 'dispose'>

const NATIVE_START_ADMISSION_CACHE_LIMIT = 256
const NATIVE_START_ADMISSION_CACHE_TTL_MS = 2 * 60_000

export const AGENT_EFFECT_METHODS = {
  createSession: true,
  deleteSession: true,
  promptNewSession: true,
  renameSession: true,
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
  const admittedNativeStarts = new Map<string, number>()
  const pendingNativeStartAdmissions = new Map<string, Promise<void>>()

  async function admitNativeStart(ctx: PiSessionRequestContext, start: NativeSessionStart): Promise<void> {
    const key = JSON.stringify([ctx.authSubject ?? '', ctx.workspaceId ?? '', ctx.storageScope ?? '', start.idempotencyKey])
    pruneNativeStartAdmissions(admittedNativeStarts)
    if (start.retry) {
      const pending = pendingNativeStartAdmissions.get(key)
      if (pending) return pending
      if (admittedNativeStarts.has(key)) return
    }

    const pending = Promise.resolve().then(() => admit(ctx))
    pendingNativeStartAdmissions.set(key, pending)
    try {
      await pending
    } catch (error) {
      if (pendingNativeStartAdmissions.get(key) === pending) pendingNativeStartAdmissions.delete(key)
      throw error
    }
    if (pendingNativeStartAdmissions.get(key) !== pending) return

    pendingNativeStartAdmissions.delete(key)
    while (admittedNativeStarts.size >= NATIVE_START_ADMISSION_CACHE_LIMIT) {
      const oldest = admittedNativeStarts.keys().next().value
      if (oldest === undefined) break
      admittedNativeStarts.delete(oldest)
    }
    admittedNativeStarts.set(key, Date.now())
  }

  return {
    ...(service.listSessions
      ? { listSessions: (ctx, options) => service.listSessions!(ctx, options) }
      : {}),
    ...(service.promptNewSession
      ? { promptNewSession: async (ctx, payload, start) => { await admitNativeStart(ctx, start); return service.promptNewSession!(ctx, payload, start) } }
      : {}),
    ...(service.renameSession
      ? { renameSession: async (ctx, sessionId, title) => { await admit(ctx); return service.renameSession!(ctx, sessionId, title) } }
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

function pruneNativeStartAdmissions(admissions: Map<string, number>, now = Date.now()): void {
  for (const [key, admittedAt] of admissions) {
    if (now - admittedAt > NATIVE_START_ADMISSION_CACHE_TTL_MS) admissions.delete(key)
  }
}
