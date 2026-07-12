import type { FastifyRequest } from "fastify"

export interface TaskSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/** Host-authorized scope. Plugins never derive this from request headers, query, or body. */
export interface TaskSessionHostContext {
  workspaceId: string
  authSubject?: string
}

/** Typed host composition port to the normal Pi session application service. */
export interface TaskSessionPort {
  findAuthorizedSession(context: TaskSessionHostContext, sessionId: string): Promise<TaskSessionSummary | null>
  searchAuthorizedSessions(context: TaskSessionHostContext, query: string): Promise<TaskSessionSummary[]>
}

export interface TaskSessionPortProvider {
  resolve(request: FastifyRequest): { context: TaskSessionHostContext; port: TaskSessionPort }
}

export interface TaskSessionPortHost {
  boringTaskSessionPortProvider?: TaskSessionPortProvider
}
