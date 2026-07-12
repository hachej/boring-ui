import { z } from 'zod'
import { ErrorCode } from '../shared/error-codes'
import type { ManageSessionsInput } from '../core/piChatSessionService'

export const MANAGE_SESSIONS_DEFAULT_LIMIT = 10
export const MANAGE_SESSIONS_MAX_LIMIT = 20
export const MANAGE_SESSIONS_MAX_QUERY_LENGTH = 200

export const ManageSessionsInputSchema: z.ZodType<ManageSessionsInput, z.ZodTypeDef, unknown> = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    query: z.string().max(MANAGE_SESSIONS_MAX_QUERY_LENGTH).optional(),
    limit: z.number().int().min(1).max(MANAGE_SESSIONS_MAX_LIMIT).optional(),
    offset: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    action: z.literal('rename'),
    sessionId: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(200),
  }).strict(),
  z.object({
    action: z.literal('delete'),
    sessionId: z.string().min(1).max(128),
    confirm: z.literal(true),
  }).strict(),
])

export function parseManageSessionsInput(value: unknown): ManageSessionsInput {
  const parsed = ManageSessionsInputSchema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const field = issue?.path.length ? issue.path.map(String).join('.') : undefined
  throw sessionManagementInvalidError(
    field ? `${field}: ${issue?.message ?? 'invalid manage_sessions input'}` : issue?.message ?? 'invalid manage_sessions input',
    field,
  )
}

export function normalizeManageSessionsLimit(limit: number | undefined): number {
  return Math.min(MANAGE_SESSIONS_MAX_LIMIT, Math.max(1, limit ?? MANAGE_SESSIONS_DEFAULT_LIMIT))
}

export function normalizeManageSessionsOffset(offset: number | undefined): number {
  return Math.max(0, offset ?? 0)
}

export function normalizeManageSessionsQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim()
  return trimmed ? trimmed.toLowerCase() : undefined
}

export function sessionManagementInvalidError(message: string, field?: string): Error & { code: string; statusCode: number; details?: { field: string } } {
  return Object.assign(new Error(message), {
    code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
    statusCode: 400,
    ...(field ? { details: { field } } : {}),
  })
}
