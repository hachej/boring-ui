export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
}

export interface SessionCtx {
  workspaceId?: string
  userId?: string
}

export interface SessionListOptions {
  limit?: number
  offset?: number
  includeId?: string
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
  /** Server-authoritative UI capability. Undefined means older callers should use their default behavior. */
  canRename?: boolean
}

export type SessionDetail = SessionSummary
