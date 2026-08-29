/** Native Pi/session IDs are path-safe segments; dots may only separate non-empty segments. */
export const SAFE_NATIVE_SESSION_ID = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/

export type SessionOrderTuple = readonly [
  updatedAtMs: number,
  agentTypeId: string,
  sessionId: string,
]

/**
 * Canonical session inventory order: newest first, then UTF-16 code-unit
 * identity order. Cursor boundaries and every bounded store prefix must use
 * this exact tuple comparator; locale-sensitive ordering is not stable or portable.
 */
export function compareSessionOrder(left: SessionOrderTuple, right: SessionOrderTuple): number {
  return right[0] - left[0]
    || compareSessionIdentity(left[1], right[1])
    || compareSessionIdentity(left[2], right[2])
}

function compareSessionIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  /** Native Pi transcripts can append a session_info title without a wrapper. */
  rename?(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary>
  /** Optional visibility capability; implementations must not alias it to delete. */
  setArchived?(ctx: SessionCtx, sessionId: string, archived: boolean): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
}

/**
 * Which side of the archive line a listing wants. `all` is the default so
 * every existing caller keeps seeing exactly what it saw before archiving
 * existed; the flag on each summary is what lets a client partition.
 */
export type SessionArchiveFilter = 'active' | 'archived' | 'all'

export interface SessionCtx {
  workspaceId?: string
  userId?: string
}

export interface SessionListOptions {
  limit?: number
  offset?: number
  includeId?: string
  /** Server-internal authority lookup for turn-less sessions; never exposed as an HTTP query. */
  includeEmpty?: boolean
  /** Defaults to `all`: archiving is a visibility flag, not a listing default. */
  archived?: SessionArchiveFilter
  /** Server-internal global cursor boundary applied before this store cuts its bounded prefix. */
  after?: {
    position: SessionOrderTuple
    agentTypeId: string
  }
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  /** Owning Agent type projected by addressed session routes. */
  agentTypeId?: string
  /** Native Pi transcript identity used by session controls. */
  nativeSessionId?: string
  /** Native transcript metadata used to gate rename until a reply exists. */
  hasAssistantReply?: boolean
  /** Addressed AgentHost live activity; absent on storage-only summaries. */
  status?: 'idle' | 'running' | 'aborting' | 'error'
  /** Visibility flag only. Present (true) exactly while the session is archived. */
  archived?: boolean
}

export type SessionDetail = SessionSummary
