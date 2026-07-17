import { z } from 'zod'

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

const SessionSummaryBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().default('Untitled'),
  createdAt: z.string().default(new Date(0).toISOString()),
  updatedAt: z.string().default(new Date(0).toISOString()),
  turnCount: z.number().default(0),
})

/** A direct Pi transcript always carries both native identity and rename eligibility. */
export const NativeSessionSummarySchema = SessionSummaryBaseSchema.extend({
  nativeSessionId: z.string().min(1),
  hasAssistantReply: z.boolean(),
})

const NonNativeSessionSummarySchema = SessionSummaryBaseSchema.extend({
  nativeSessionId: z.undefined().optional(),
  hasAssistantReply: z.undefined().optional(),
})

/** Canonical parser for session rows returned across the browser/server boundary. */
export const SessionSummarySchema = z.union([
  NativeSessionSummarySchema,
  NonNativeSessionSummarySchema,
])

export type NativeSessionSummary = z.infer<typeof NativeSessionSummarySchema>
export type SessionSummary = z.infer<typeof SessionSummarySchema>
export type SessionDetail = SessionSummary
