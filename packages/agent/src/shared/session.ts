import type { UIMessage } from './message'

export interface SessionStore {
  list(ctx: SessionCtx): Promise<SessionSummary[]>
  create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary>
  load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail>
  delete(ctx: SessionCtx, sessionId: string): Promise<void>
  /**
   * Persist a snapshot of UI-layer messages so they survive server restarts.
   * Called by the client after each completed turn. Optional — stores that
   * don't implement it simply don't persist UI messages server-side.
   */
  saveMessages?(ctx: SessionCtx, sessionId: string, messages: UIMessage[]): Promise<void>
}

export interface SessionCtx {
  workspaceId: string
  userId?: string
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turnCount: number
}

export interface SessionDetail extends SessionSummary {
  messages: UIMessage[]
}
