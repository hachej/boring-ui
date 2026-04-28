import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { HttpError, ERROR_CODES } from '../../shared/errors.js'
import { requireWorkspaceMember } from '../auth/requireWorkspaceMember.js'
import { createMailTransport } from '../mail/transport.js'
import type { MailTransport } from '../mail/transport.js'
import { renderWorkspaceInvite } from '../mail/templates/index.js'
import { createInviteBody, acceptInviteQuery } from './__schemas__/invites.js'
import type { Database } from '../db/connection.js'
import { createIdempotencyMiddleware, createDrizzleIdempotencyStore } from '../middleware/idempotency.js'
import type { IdempotencyKeyStore } from '../middleware/idempotency.js'

function buildTransport(config: { auth: { mail?: { transportUrl: string; from: string } | null } }): MailTransport | null {
  if (!config.auth.mail) return null
  const env = process.env.NODE_ENV === 'production'
    ? 'production' as const
    : process.env.NODE_ENV === 'test'
      ? 'test' as const
      : 'development' as const
  return createMailTransport(config.auth.mail.transportUrl, config.auth.mail.from, env)
}

interface InviteRoutesOptions {
  idempotencyStore?: IdempotencyKeyStore
}

const inviteRoutesPlugin: FastifyPluginAsync<InviteRoutesOptions> = async (app, opts) => {
  const store = app.workspaceStore
  const transport = buildTransport(app.config)

  const idempotencyStore =
    opts.idempotencyStore ??
    (() => {
      const db = (app as unknown as { db?: Database }).db
      return db ? createDrizzleIdempotencyStore(db) : null
    })()

  const idem = idempotencyStore ? createIdempotencyMiddleware(idempotencyStore) : null
  if (idem) {
    app.addHook('onSend', idem.onSendCapture)
  }

  app.get(
    '/api/v1/workspaces/:id/invites',
    { preHandler: requireWorkspaceMember() },
    async (request) => {
      const { id } = request.params as { id: string }
      const invites = await store.listInvites(id)
      return { invites }
    },
  )

  app.post(
    '/api/v1/workspaces/:id/invites',
    {
      preHandler: idem
        ? [requireWorkspaceMember('owner'), idem.guard('invites')]
        : requireWorkspaceMember('owner'),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const parsed = createInviteBody.safeParse(request.body)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: request.id,
        })
      }

      const { invite, rawToken } = await store.createInvite(
        id,
        parsed.data.email,
        parsed.data.role,
        request.user!.id,
      )

      if (transport) {
        const workspace = await store.get(id)
        const acceptUrl = `${app.config.auth.url}/api/v1/workspaces/${id}/invites/${invite.id}/accept?invite_token=${rawToken}`
        try {
          const email = await renderWorkspaceInvite({
            to: parsed.data.email,
            acceptUrl,
            inviterName: request.user!.name ?? request.user!.email,
            workspaceName: workspace?.name ?? 'Workspace',
            role: parsed.data.role,
            expiresInDays: 7,
          })
          await transport.send(email)
        } catch (err) {
          request.log.warn({ workspaceId: id, inviteId: invite.id, err }, 'invite.email.send.failed')
        }
      }

      request.log.info({ workspaceId: id, inviteId: invite.id, email: parsed.data.email }, 'invite.create')
      reply.status(201)

      if (!transport) {
        return { invite, warning: 'mail_disabled' as const }
      }
      return { invite }
    },
  )

  app.post(
    '/api/v1/workspaces/:id/invites/:inviteId/accept',
    async (request) => {
      const { id, inviteId } = request.params as { id: string; inviteId: string }
      const user = request.user
      if (!user) {
        throw new HttpError({
          status: 401,
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Authentication required',
          requestId: request.id,
        })
      }

      const parsed = acceptInviteQuery.safeParse(request.query)
      if (!parsed.success) {
        throw new HttpError({
          status: 400,
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'invite_token query parameter is required',
          requestId: request.id,
        })
      }

      const tokenHash = createHash('sha256').update(parsed.data.invite_token).digest('hex')
      const invite = await store.getInviteByTokenHash(tokenHash)

      if (!invite || invite.id !== inviteId || invite.workspaceId !== id) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.INVITE_NOT_FOUND,
          message: 'Invite not found',
          requestId: request.id,
        })
      }

      const result = await store.acceptInvite(id, inviteId, user.id)

      request.log.info({ workspaceId: id, inviteId, userId: user.id }, 'invite.accept')
      return { invite: result.invite, member: result.member }
    },
  )

  app.delete(
    '/api/v1/workspaces/:id/invites/:inviteId',
    { preHandler: requireWorkspaceMember('owner') },
    async (request) => {
      const { id, inviteId } = request.params as { id: string; inviteId: string }
      const revoked = await store.revokeInvite(id, inviteId)

      if (!revoked) {
        throw new HttpError({
          status: 404,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invite not found',
          requestId: request.id,
        })
      }

      request.log.info({ workspaceId: id, inviteId }, 'invite.revoke')
      return { revoked: true }
    },
  )
}

export const registerInviteRoutes = fp(inviteRoutesPlugin, { name: 'invite-routes' })
