/** Native Pi/session IDs are path-safe segments; dots may only separate non-empty segments. */
export const SAFE_NATIVE_SESSION_ID = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/

export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string; reuseEmpty?: boolean }): Promise<SessionSummary>
  /** Native Pi transcripts can append a session_info title without a wrapper. */
  rename?(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
}

export interface SessionCtx {
  workspaceId?: string
  userId?: string
  /** Runtime-only live-channel identity. Never used for storage resolution. */
  liveSessionScopeId?: string
}

/**
 * Identity for in-memory live channels, durable seq streams, idempotency
 * records and pi-session handles — NEVER for storage. When liveSessionScopeId
 * is present it replaces the workspace/user tuple, so a legacy first send and
 * an addressed read converge on one channel. The shape keeps addressed callers
 * byte-identical to before, since their liveSessionScopeId equals their
 * storage scope.
 *
 * This lives here as the single definition on purpose. It was previously
 * duplicated in the service and the harness, each with a comment noting it
 * mirrored the other — two copies of a key derivation that must agree is the
 * exact shape of the bug this branch exists to fix.
 */
export function liveSessionCacheKey(sessionId: string, ctx: SessionCtx): string {
  if (ctx.liveSessionScopeId) return JSON.stringify([sessionId, ctx.liveSessionScopeId, ''])
  return JSON.stringify([sessionId, ctx.workspaceId ?? '', ctx.userId ?? ''])
}

export interface SessionListOptions {
  limit?: number
  offset?: number
  includeId?: string
  /**
   * Server-internal: keep turn-less sessions (an unsent New chat), which
   * listings normally suppress. Used by existence checks that must still
   * resolve a just-created session. Never settable from the HTTP query.
   */
  includeEmpty?: boolean
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  /** Owning agent type in addressed hosts. Absent on the legacy single-agent wire. */
  agentTypeId?: string
  /** Present only for an explicitly allowed bare native Pi transcript. */
  nativeSessionId?: string
  /** Native transcript metadata used to gate rename until a reply exists. */
  hasAssistantReply?: boolean
  /** Browser-only session that materializes as native Pi on its first prompt. */
  ephemeral?: boolean
}

export type SessionDetail = SessionSummary
