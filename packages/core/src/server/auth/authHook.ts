import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError } from '../../shared/errors.js'
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
          request.user = {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name ?? null,
          }
        }
      } catch {
        request.user = null
      }
    }

    const path = request.url.split('?')[0]
    if (
      path.startsWith('/api/v1/') &&
      !publicPatterns.some((re) => re.test(path)) &&
      !request.user
    ) {
      throw new HttpError({
        status: 401,
        code: 'unauthorized',
        message: 'Authentication required',
        requestId: request.id,
      })
    }
  })
}

export const authHook = fp(authHookPlugin, { name: 'auth-hook' })
