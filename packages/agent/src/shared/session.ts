export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  rename?(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
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
  /** Present only for a direct native Pi transcript, never a legacy wrapper. */
  nativeSessionId?: string
  /** Rename is enabled only after Pi has persisted an assistant reply. */
  hasAssistantReply?: boolean
}

export type SessionDetail = SessionSummary
