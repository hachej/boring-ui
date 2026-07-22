import type { FastifyRequest } from 'fastify'
import type { InterruptReceipt, StopReceipt } from '../shared/chat'
import { CommandReceiptSchema, StopReceiptSchema } from '../shared/chat'
import type { Agent } from '../shared/events'
import { ErrorCode } from '../shared/error-codes'
import type { Workspace } from '../shared/workspace'
import type {
  WorkspaceAgentDispatcher,
  WorkspaceAgentDispatcherContext,
} from '../shared/workspaceAgentDispatcher'

export interface WorkspaceAgentDispatcherResolveOptions {
  request?: FastifyRequest
}

export interface WorkspaceAgentDispatcherBinding {
  dispatcher: WorkspaceAgentDispatcher
  workspace: Workspace
}

export interface AuthorizedSessionRunDetails {
  runId: string
  terminalEntryId: string
  state: "success" | "error" | "aborted" | "interrupted"
  createdAt?: string
  details: readonly unknown[]
}

export interface WorkspaceAgentDispatcherResolver {
  resolve(
    ctx: WorkspaceAgentDispatcherContext,
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<WorkspaceAgentDispatcher>
  resolveWithWorkspace?(
    ctx: WorkspaceAgentDispatcherContext,
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<WorkspaceAgentDispatcherBinding>
  /** Authorize an existing native session without exposing transcript data. */
  authorizeSession?(
    ctx: WorkspaceAgentDispatcherContext,
    sessionId: string,
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<void>
  /** Authorized, transcript-redacted run projection for structured plugin details. */
  readSessionRunDetails?(
    ctx: WorkspaceAgentDispatcherContext,
    sessionId: string,
    detailKinds: readonly string[],
    options?: WorkspaceAgentDispatcherResolveOptions,
  ): Promise<readonly AuthorizedSessionRunDetails[]>
}

export function createBoundWorkspaceAgentDispatcher(
  agent: Agent,
  ctx: WorkspaceAgentDispatcherContext,
): WorkspaceAgentDispatcher {
  const boundCtx = normalizeWorkspaceAgentDispatcherContext(ctx)
  return {
    send(input) {
      return agent.send({ ...input, ctx: boundCtx })
    },
    async interrupt(sessionId) {
      return parseControlReceipt(await agent.interrupt(sessionId, boundCtx), 'interrupt')
    },
    async stop(sessionId) {
      return parseStopReceipt(await agent.stop(sessionId, boundCtx))
    },
  }
}

export function assertWorkspaceAgentDispatcherRequestContext(
  ctx: WorkspaceAgentDispatcherContext,
  request: FastifyRequest | undefined,
): void {
  normalizeWorkspaceAgentDispatcherContext(ctx)
  if (!request) return
  const requestWorkspaceId = request.workspaceContext?.workspaceId?.trim()
  if (!requestWorkspaceId) return
  if (requestWorkspaceId !== ctx.workspaceId.trim()) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.UNAUTHORIZED,
      'workspace agent dispatcher context does not match request workspace',
      401,
    )
  }
}

export function normalizeWorkspaceAgentDispatcherContext(
  ctx: WorkspaceAgentDispatcherContext,
): WorkspaceAgentDispatcherContext {
  const workspaceId = ctx.workspaceId?.trim()
  const userId = ctx.userId?.trim()
  if (!workspaceId) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.WORKSPACE_UNINITIALIZED,
      'workspace id is required',
      400,
    )
  }
  if (!userId) {
    throw createWorkspaceAgentDispatcherError(
      ErrorCode.enum.UNAUTHORIZED,
      'user id is required',
      401,
    )
  }
  return { workspaceId, userId }
}

function parseControlReceipt(receipt: unknown, action: 'interrupt'): InterruptReceipt {
  const parsed = CommandReceiptSchema.safeParse(receipt)
  if (parsed.success) return parsed.data
  throw createWorkspaceAgentDispatcherError(
    ErrorCode.enum.AGENT_CONTROL_RECEIPT_INVALID,
    `agent ${action} returned a malformed receipt`,
    500,
  )
}

function parseStopReceipt(receipt: unknown): StopReceipt {
  const parsed = StopReceiptSchema.safeParse(receipt)
  if (parsed.success) return parsed.data
  throw createWorkspaceAgentDispatcherError(
    ErrorCode.enum.AGENT_CONTROL_RECEIPT_INVALID,
    'agent stop returned a malformed receipt',
    500,
  )
}

export function createWorkspaceAgentDispatcherError(
  code: typeof ErrorCode.enum[keyof typeof ErrorCode.enum],
  message: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  const error = new Error(message) as Error & { code: string; statusCode: number }
  error.code = code
  error.statusCode = statusCode
  return error
}
