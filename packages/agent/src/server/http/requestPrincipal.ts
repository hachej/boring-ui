import type { FastifyRequest } from 'fastify'
import type { PiSessionRequestContext } from '../../core/piChatSessionService'

export interface ResolvedRequestPrincipal {
  authSubject?: string
  authEmail?: string
  authEmailVerified?: boolean
}

type RequestPrincipalSource = {
  authSubject?: unknown
  authEmail?: unknown
  authEmailVerified?: unknown
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function principalFromSource(source: RequestPrincipalSource): ResolvedRequestPrincipal {
  const authSubject = nonEmptyString(source.authSubject)
  const authEmail = nonEmptyString(source.authEmail)
  return {
    ...(authSubject ? { authSubject } : {}),
    ...(authEmail ? { authEmail } : {}),
    ...(typeof source.authEmailVerified === 'boolean' ? { authEmailVerified: source.authEmailVerified } : {}),
  }
}

/** Returns the host-resolved principal when present, falling back to raw auth only when unresolved. */
export function resolveRequestPrincipal(request: FastifyRequest | undefined): ResolvedRequestPrincipal {
  if (!request) return {}
  const resolvedSession = (request as FastifyRequest & {
    piSessionRequestContext?: PiSessionRequestContext
  }).piSessionRequestContext
  if (resolvedSession) return principalFromSource(resolvedSession)

  const workspaceContext = request.workspaceContext as RequestPrincipalSource | undefined
  if (
    workspaceContext
    && ('authSubject' in workspaceContext || 'authEmail' in workspaceContext || 'authEmailVerified' in workspaceContext)
  ) {
    return principalFromSource(workspaceContext)
  }

  const user = (request as FastifyRequest & {
    user?: { id?: unknown; email?: unknown; emailVerified?: unknown } | null
  }).user
  return principalFromSource({
    authSubject: user?.id,
    authEmail: user?.email,
    authEmailVerified: user?.emailVerified,
  })
}
