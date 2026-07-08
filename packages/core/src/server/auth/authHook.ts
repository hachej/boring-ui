import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { isCoreEmailVerificationEnabled } from '../../shared/authPolicy.js'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { decideAnonymousRequest } from '../outreach/policy.js'
import type { BetterAuthInstance } from './createAuth.js'

export interface AuthHookOptions {
  public?: RegExp[]
}

const DEFAULT_PUBLIC: RegExp[] = [
  /^\/auth\//,
  /^\/health$/,
  /^\/api\/v1\/config$/,
]

declare module 'fastify' {
  interface FastifyInstance {
    auth: BetterAuthInstance
  }
}

const authHookPlugin: FastifyPluginAsync<AuthHookOptions> = async (app, opts) => {
  const publicPatterns = opts.public ?? DEFAULT_PUBLIC

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    request.user = null

    if (app.auth) {
      try {
        const headers = new Headers()
        for (const [key, val] of Object.entries(request.headers)) {
          if (val) headers.set(key, Array.isArray(val) ? val[0] : val)
        }

        const result = await app.auth.api.getSession({ headers })
        if (result?.user) {
          const authUser = result.user as typeof result.user & { isAnonymous?: boolean }
          const isAuthAnonymous = Boolean(authUser.isAnonymous)
          const isOutreachLead = app.isAnonymousOutreachUser
            ? await app.isAnonymousOutreachUser(app.config.appId, authUser.id)
            : false
          const isAnonymous = isAuthAnonymous || isOutreachLead
          request.user = {
            id: authUser.id,
            email: isAnonymous ? '' : authUser.email,
            name: isAnonymous ? 'Anonymous lead' : authUser.name ?? null,
            emailVerified: Boolean(authUser.emailVerified),
            isAnonymousLead: isAnonymous,
          }
        }
      } catch {
        request.user = null
      }
    }

    const path = request.url.split('?')[0]
    if (path === '/auth/sign-in/anonymous' || path === '/auth/delete-anonymous-user') {
      throw new HttpError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'Auth endpoint not found',
        requestId: request.id,
      })
    }
    const isProtectedApi = path.startsWith('/api/v1/') && !publicPatterns.some((re) => re.test(path))

    if (isProtectedApi && !request.user) {
      throw new HttpError({
        status: 401,
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required',
        requestId: request.id,
      })
    }

    if (isProtectedApi && request.user?.isAnonymousLead) {
      const hasOutreachLead = app.isAnonymousOutreachUser
        ? await app.isAnonymousOutreachUser(app.config.appId, request.user.id)
        : false
      if (!hasOutreachLead && path !== '/api/v1/me') {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.FORBIDDEN,
          message: 'Anonymous auth sessions must enter through an outreach link.',
          requestId: request.id,
        })
      }
      const decision = decideAnonymousRequest(request.method, path)
      if (!decision.allowed) {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.FORBIDDEN,
          message: decision.reason,
          requestId: request.id,
        })
      }
    }

    const verifyUser = request.user
    if (isProtectedApi && verifyUser && !verifyUser.isAnonymousLead && isCoreEmailVerificationEnabled(app.config) && verifyUser.emailVerified !== true) {
      // Outreach leads who claimed an account arrived through a trusted token
      // and were provisioned into a workspace; keep that access frictionless
      // instead of walling them out behind email verification. They remain
      // ordinary role-scoped members, so the workspace role gate still applies.
      const isClaimedOutreachLead = app.isClaimedOutreachUser
        ? await app.isClaimedOutreachUser(app.config.appId, verifyUser.id)
        : false
      if (!isClaimedOutreachLead) {
        throw new HttpError({
          status: 403,
          code: ERROR_CODES.EMAIL_NOT_VERIFIED,
          message: 'Email verification required',
          requestId: request.id,
        })
      }
    }
  })
}

export const authHook = fp(authHookPlugin, { name: 'auth-hook' })
