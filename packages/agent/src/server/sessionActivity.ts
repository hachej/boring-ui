import { z } from 'zod'
import { ErrorCode } from '../shared/error-codes'
import type { SessionActivityInput } from '../core/piChatSessionService'

export const SESSION_ACTIVITY_MAX_LIMIT = 100
export const SESSION_ACTIVITY_DEFAULT_LIMIT = 50
export const SESSION_ACTIVITY_MAX_IDS = 100

const SessionActivityIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)

export const SessionActivityInputSchema: z.ZodType<SessionActivityInput, z.ZodTypeDef, unknown> = z.object({
  sessionIds: z.array(SessionActivityIdSchema).min(1).max(SESSION_ACTIVITY_MAX_IDS).optional(),
  limit: z.number().int().min(1).max(SESSION_ACTIVITY_MAX_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.sessionIds && (input.limit !== undefined || input.offset !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sessionIds cannot be combined with limit or offset',
      path: ['sessionIds'],
    })
  }
})

export function normalizeSessionActivityInput(input: SessionActivityInput): Required<Pick<SessionActivityInput, 'limit' | 'offset'>> & { sessionIds?: string[] } {
  const parsed = SessionActivityInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw Object.assign(new Error(issue?.message ?? 'invalid session activity request'), {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      statusCode: 400,
      retryable: false,
      ...(issue?.path.length ? { field: issue.path.map(String).join('.') } : {}),
    })
  }
  return {
    ...(parsed.data.sessionIds ? { sessionIds: dedupeSessionIds(parsed.data.sessionIds) } : {}),
    limit: parsed.data.limit ?? SESSION_ACTIVITY_DEFAULT_LIMIT,
    offset: parsed.data.offset ?? 0,
  }
}

function dedupeSessionIds(sessionIds: string[]): string[] {
  return [...new Set(sessionIds)]
}
