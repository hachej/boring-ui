/** Native Pi/session IDs are path-safe segments; dots may only separate non-empty segments. */
export const SAFE_NATIVE_SESSION_ID = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/

export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  /** Native Pi transcripts can append a session_info title without a wrapper. */
  rename?(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  /** Exact raw JSONL lines for trusted, already-authorized internal consumers. */
  readRawJsonlPage?(ctx: SessionCtx, sessionId: string, input: SessionJsonlPageInput): Promise<SessionJsonlPage>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
}

export interface SessionCtx {
  workspaceId?: string
  userId?: string
  /** Server-owned Host runtime pin; never sourced from browser input. */
  runtimeScopeIdentity?: string
}

export interface SessionListOptions {
  limit?: number
  offset?: number
  includeId?: string
  /** Server-internal authority lookup for turn-less sessions; never exposed as an HTTP query. */
  includeEmpty?: boolean
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
}

export type SessionDetail = SessionSummary

export interface SessionJsonlPageInput {
  cursor: number
  limit: number
  maxBytes: number
  signal?: AbortSignal
}

export interface SessionJsonlPage {
  lines: string[]
  nextCursor: number
  hasMore: boolean
}
