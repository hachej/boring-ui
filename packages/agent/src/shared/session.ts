export interface SessionStore {
  list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
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
}

export type SessionActivityStatus = 'idle' | 'submitted' | 'streaming' | 'aborting' | 'error'

export interface SessionActivity {
  sessionId: string
  working: boolean
  status: SessionActivityStatus
  queuedCount?: number
  source: 'live-runtime' | 'persisted'
}

export interface SessionActivityOptions {
  sessionIds: string[]
}

export type SessionDetail = SessionSummary
