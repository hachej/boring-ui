import type { FastifyRequest } from "fastify"
import { ErrorCode } from "../shared/error-codes"
import type { PiChatSessionService } from "../core/piChatSessionService"
import type { WorkspaceAgentDispatcherContext } from "../shared/workspaceAgentDispatcher"
import {
  createWorkspaceAgentDispatcherError,
  type AuthorizedSessionRunDetails,
} from "./workspaceAgentDispatcher"

function requestUser(request?: FastifyRequest): { id?: string; email?: string; emailVerified?: boolean } | null {
  const user = (request as FastifyRequest & { user?: { id?: unknown; email?: unknown; emailVerified?: unknown } | null } | undefined)?.user
  if (!user) return null
  return {
    ...(typeof user.id === "string" && user.id.trim() ? { id: user.id.trim() } : {}),
    ...(typeof user.email === "string" && user.email ? { email: user.email } : {}),
    ...(user.emailVerified === true ? { emailVerified: true } : {}),
  }
}

export async function readAuthorizedSessionState(
  service: PiChatSessionService,
  ctx: WorkspaceAgentDispatcherContext,
  sessionId: string,
  request: FastifyRequest | undefined,
  requestId: string,
) {
  const user = requestUser(request)
  if (user?.id && user.id !== ctx.userId) {
    throw createWorkspaceAgentDispatcherError(ErrorCode.enum.UNAUTHORIZED, "workspace agent dispatcher context does not match request user", 401)
  }
  const storageScope = request?.headers["x-boring-storage-scope"]
  return await service.readState({
    workspaceId: ctx.workspaceId,
    storageScope: typeof storageScope === "string" && storageScope.length > 0 ? storageScope : undefined,
    authSubject: ctx.userId,
    authEmail: user?.id === ctx.userId ? user?.email : undefined,
    authEmailVerified: user?.id === ctx.userId && user?.emailVerified === true,
    requestId: request?.id ?? requestId,
  }, sessionId)
}

export async function readAuthorizedSessionRunDetails(
  service: PiChatSessionService,
  ctx: WorkspaceAgentDispatcherContext,
  sessionId: string,
  detailKinds: readonly string[],
  request?: FastifyRequest,
): Promise<AuthorizedSessionRunDetails[]> {
  if (detailKinds.length < 1 || detailKinds.length > 16 || detailKinds.some((kind) => !kind || kind.length > 128)) {
    throw createWorkspaceAgentDispatcherError(ErrorCode.enum.TOOL_INVALID_INPUT, "invalid structured detail kinds", 400)
  }
  const snapshot = await readAuthorizedSessionState(service, ctx, sessionId, request, "trusted-session-run-details")
  return projectAuthorizedSessionRunDetails(snapshot.messages, detailKinds)
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/**
 * Redact a native-session snapshot to run identity, terminal state, and the
 * explicitly allowlisted structured detail nodes required by trusted hosts.
 */
export function projectAuthorizedSessionRunDetails(
  messages: readonly unknown[],
  detailKinds: readonly string[],
): AuthorizedSessionRunDetails[] {
  const allowed = new Set(detailKinds)
  const runs: AuthorizedSessionRunDetails[] = []
  let active: { runId: string; details: unknown[] } | null = null
  for (const rawMessage of messages) {
    const message = recordValue(rawMessage)
    if (!message) continue
    if (message.role === "user") {
      const runId = typeof message.piEntryId === "string" ? message.piEntryId : typeof message.id === "string" ? message.id : undefined
      active = runId ? { runId, details: [] } : null
      continue
    }
    if (message.role !== "assistant" || !active) continue
    if (Array.isArray(message.parts)) {
      for (const rawPart of message.parts) {
        const part = recordValue(rawPart)
        if (!part || part.type !== "tool-call" || part.state !== "output-available") continue
        const output = recordValue(part.output)
        const root = recordValue(output?.details)
        const candidates = root
          ? [root, ...Object.values(root).map(recordValue).filter((value): value is Record<string, unknown> => value !== null)]
          : []
        for (const candidate of candidates) {
          if (typeof candidate.kind === "string" && allowed.has(candidate.kind)) active.details.push(structuredClone(candidate))
        }
      }
    }
    const state = message.runTerminalState
    if (state === "success" || state === "error" || state === "aborted" || state === "interrupted") {
      const terminalEntryId = typeof message.piEntryId === "string" ? message.piEntryId : typeof message.id === "string" ? message.id : undefined
      if (terminalEntryId) runs.push({
        runId: active.runId,
        terminalEntryId,
        state,
        ...(typeof message.createdAt === "string" ? { createdAt: message.createdAt } : {}),
        details: active.details,
      })
      active = null
    }
  }
  return runs
}
