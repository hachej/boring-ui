import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { MemberRole } from '../../shared/types.js'
import { ERROR_CODES } from '../../shared/errors.js'
import type { WorkspaceStore } from '../../server/app/index.js'
import { isWorkspaceRoleAtLeast } from '../../server/auth/workspaceRoles.js'

type WorkspaceAccessRequest = {
  user?: { id?: string } | null
  log?: { error: (obj: Record<string, unknown>, msg: string) => void }
}

type WorkspaceIdRequest = {
  headers?: Record<string, unknown>
  query?: unknown
}

function httpError(message: string, statusCode: number, code: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number
    code: string
  }
  error.statusCode = statusCode
  error.code = code
  return error
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === 'string')
}

export function validateWorkspaceIdSegment(value: string): string {
  const workspaceId = value.trim()
  if (!workspaceId) throw httpError('workspace id is required', 400, ERROR_CODES.VALIDATION_FAILED)
  if (
    workspaceId.includes('\0') ||
    workspaceId.includes('/') ||
    workspaceId.includes('\\') ||
    workspaceId.includes('..') ||
    path.isAbsolute(workspaceId)
  ) {
    throw httpError('invalid workspace id', 400, ERROR_CODES.VALIDATION_FAILED)
  }
  return workspaceId
}

export function resolveWorkspaceIdFromRequest(request: WorkspaceIdRequest): string {
  const headers = request.headers ?? {}
  const headerValue =
    headers['x-boring-workspace-id'] ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-boring-workspace-id')?.[1]
  const query = request.query as Record<string, unknown> | undefined
  return validateWorkspaceIdSegment(firstString(headerValue) ?? firstString(query?.workspaceId) ?? '')
}

export async function authorizeWorkspaceAccess(
  request: WorkspaceAccessRequest,
  workspaceId: string,
  workspaceStore: WorkspaceStore,
  options: { minimumRole?: MemberRole } = {},
): Promise<void> {
  const user = request.user
  if (!user?.id) throw httpError('authentication required', 401, ERROR_CODES.UNAUTHORIZED)

  let role: MemberRole | null = null
  try {
    role = await workspaceStore.getMemberRole(workspaceId, user.id)
  } catch (error) {
    request.log?.error({ err: error, workspaceId }, 'workspace access check failed')
    throw httpError('workspace access check failed', 500, ERROR_CODES.INTERNAL_ERROR)
  }
  if (!role) throw httpError('workspace access denied', 403, ERROR_CODES.NOT_MEMBER)
  if (options.minimumRole && !isWorkspaceRoleAtLeast(role, options.minimumRole)) {
    throw httpError('workspace editor role required', 403, ERROR_CODES.FORBIDDEN)
  }
}

export async function resolveWorkspaceMemberId(
  request: WorkspaceIdRequest & WorkspaceAccessRequest,
  workspaceStore: WorkspaceStore,
): Promise<string> {
  const normalizedWorkspaceId = resolveWorkspaceIdFromRequest(request)
  await authorizeWorkspaceAccess(request, normalizedWorkspaceId, workspaceStore)
  return normalizedWorkspaceId
}

export async function resolveWorkspaceRoot(baseRoot: string, workspaceId: string): Promise<string> {
  const base = path.resolve(baseRoot)
  const scopedRoot = path.resolve(base, workspaceId)
  if (scopedRoot === base || !scopedRoot.startsWith(`${base}${path.sep}`)) {
    throw httpError('invalid workspace id', 400, ERROR_CODES.VALIDATION_FAILED)
  }
  await mkdir(scopedRoot, { recursive: true })
  return scopedRoot
}

export function isSharedUiMutationRequest(request: { method: string; url: string }): boolean {
  const pathname = request.url.split('?')[0] ?? request.url
  const method = request.method.toUpperCase()
  return (
    (method === 'PUT' && (pathname === '/api/v1/ui/state' || pathname === '/api/v1/ui/panels/status')) ||
    (method === 'POST' && pathname === '/api/v1/ui/commands')
  )
}
