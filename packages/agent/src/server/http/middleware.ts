import type { FastifyReply, FastifyRequest } from 'fastify'

export const ERROR_CODE_AUTH_REQUIRED = 'auth_required'
export const ERROR_CODE_AUTH_INVALID = 'auth_invalid'
export const ERROR_CODE_INVALID_PATH = 'invalid_path'
export const ERROR_CODE_PATH_TOO_LONG = 'path_too_long'
export const ERROR_CODE_VALIDATION_ERROR = 'validation_error'

const DEV_MODE_WARNING =
  'No auth token set — running in dev mode'

const MAX_PATH_LENGTH = 4096
const DEFAULT_WORKSPACE_ID = 'default'

export interface WorkspaceContext {
  workspaceId: string
  authenticated: boolean
}

interface ErrorPayload {
  error: {
    code: string
    message: string
    field?: string
  }
}

interface ParseIssue {
  path: Array<string | number>
  message: string
}

interface ParseError {
  issues: ParseIssue[]
}

type ParseResult<TBody> =
  | { success: true; data: TBody }
  | { success: false; error: ParseError }

export interface BodySchema<TBody> {
  safeParse: (input: unknown) => ParseResult<TBody>
}

export interface AuthMiddlewareOptions {
  authToken?: string
  workspaceId?: string
  onDevModeWarning?: (message: string) => void
}

declare module 'fastify' {
  interface FastifyRequest {
    workspaceContext: WorkspaceContext
  }
}

function errorPayload(
  code: string,
  message: string,
  field?: string,
): ErrorPayload {
  return {
    error: {
      code,
      message,
      ...(field ? { field } : {}),
    },
  }
}

function ensureWorkspaceContext(
  request: FastifyRequest,
  workspaceId: string,
  authenticated: boolean,
): void {
  request.workspaceContext = {
    workspaceId,
    authenticated,
  }
}

export function createAuthMiddleware(opts: AuthMiddlewareOptions = {}) {
  let warnedDevMode = false

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const workspaceId = opts.workspaceId ?? DEFAULT_WORKSPACE_ID
    const authToken = opts.authToken?.trim() || undefined

    ensureWorkspaceContext(request, workspaceId, false)

    if (!authToken) {
      if (!warnedDevMode) {
        warnedDevMode = true
        request.log.warn(DEV_MODE_WARNING)
        opts.onDevModeWarning?.(DEV_MODE_WARNING)
      }
      return
    }

    const header = request.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      reply
        .code(401)
        .send(
          errorPayload(
            ERROR_CODE_AUTH_REQUIRED,
            'Missing Bearer token',
          ),
        )
      return
    }

    const candidateToken = header.slice('Bearer '.length)
    if (candidateToken !== authToken) {
      reply
        .code(403)
        .send(errorPayload(ERROR_CODE_AUTH_INVALID, 'Invalid token'))
      return
    }

    ensureWorkspaceContext(request, workspaceId, true)
  }
}

export function validatePathParam(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = request.query as Record<string, unknown>
  const pathParam = query.path

  if (typeof pathParam !== 'string') {
    reply
      .code(400)
      .send(
        errorPayload(
          ERROR_CODE_INVALID_PATH,
          'path query param required',
          'path',
        ),
      )
    return Promise.resolve()
  }

  if (pathParam.length > MAX_PATH_LENGTH) {
    reply
      .code(400)
      .send(
        errorPayload(
          ERROR_CODE_PATH_TOO_LONG,
          `path exceeds ${MAX_PATH_LENGTH} chars`,
          'path',
        ),
      )
    return Promise.resolve()
  }

  if (pathParam.includes('\0')) {
    reply
      .code(400)
      .send(
        errorPayload(
          ERROR_CODE_INVALID_PATH,
          'null bytes not allowed',
          'path',
        ),
      )
    return Promise.resolve()
  }

  return Promise.resolve()
}

export function createBodyValidator<TBody>(schema: BodySchema<TBody>) {
  return async function validateBody(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      const fieldName = firstIssue?.path
        ?.map((segment: string | number) => String(segment))
        .join('.')

      reply.code(400).send(
        errorPayload(
          ERROR_CODE_VALIDATION_ERROR,
          firstIssue?.message ?? 'Invalid request body',
          fieldName || undefined,
        ),
      )
      return
    }

    request.body = parsed.data
  }
}
