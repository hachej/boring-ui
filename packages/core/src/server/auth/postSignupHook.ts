import { createHash } from 'node:crypto'
import type { CoreConfig } from '../../shared/types.js'
import type { WorkspaceStore } from '../app/types.js'
import type { MailTransport } from '../mail/transport.js'
import { renderWelcome } from '../mail/templates/index.js'

interface PostSignupUser {
  id: string
  email: string
  name: string
  [key: string]: unknown
}

interface PostSignupContext {
  getHeader?: (key: string) => string | null
  setCookie?: (key: string, value: string, options?: {
    maxAge?: number
    path?: string
    httpOnly?: boolean
    sameSite?: 'lax' | 'strict' | 'none'
  }) => string
}

type InviteFailureCode =
  | 'invite_not_found'
  | 'invite_expired'
  | 'invite_already_accepted'
  | 'invite_email_mismatch'

export interface PostSignupHookDeps {
  config: CoreConfig
  workspaceStore: WorkspaceStore
  transport: MailTransport | null
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void }
}

function readHeader(ctx: PostSignupContext | null, name: string): string | null {
  if (!ctx) return null
  const fromGetHeader = ctx.getHeader?.(name)
  if (fromGetHeader) return fromGetHeader
  const ctxAny = ctx as Record<string, unknown>
  const req = ctxAny.request as { headers?: { get?: (n: string) => string | null } } | undefined
  return req?.headers?.get?.(name) ?? null
}

export function createPostSignupHook(deps: PostSignupHookDeps) {
  const { config, workspaceStore, transport, logger } = deps

  return async function postSignupHook(
    user: PostSignupUser,
    ctx: PostSignupContext | null,
  ): Promise<void> {
    const inviteToken = readHeader(ctx, 'x-invite-token')
    let inviteAccepted = false

    if (inviteToken) {
      const failureCode = await tryAcceptInvite(user, inviteToken)
      if (failureCode) {
        logger?.warn(
          { userId: user.id, email: user.email, code: failureCode },
          'post-signup invite acceptance failed',
        )
        ctx?.setCookie?.('boring_invite_failed', failureCode, {
          maxAge: 60,
          path: '/',
          httpOnly: false,
          sameSite: 'lax',
        })
      } else {
        inviteAccepted = true
      }
    }

    if (!inviteAccepted) {
      await workspaceStore.create(user.id, 'My Workspace', config.appId, { isDefault: true })
    }

    if (
      !inviteAccepted &&
      config.features.sendWelcomeEmail !== false &&
      transport
    ) {
      const getStartedUrl = `${config.auth.url}/`
      try {
        const email = await renderWelcome({
          to: user.email,
          appName: config.appName,
          getStartedUrl,
        })
        await transport.send(email)
      } catch (err) {
        logger?.warn(
          { userId: user.id, err },
          'failed to send welcome email',
        )
      }
    }
  }

  async function tryAcceptInvite(
    user: PostSignupUser,
    rawToken: string,
  ): Promise<InviteFailureCode | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const invite = await workspaceStore.getInviteByTokenHash(tokenHash)

    if (!invite) return 'invite_not_found'
    if (invite.acceptedAt) return 'invite_already_accepted'
    if (new Date(invite.expiresAt) < new Date()) return 'invite_expired'
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) return 'invite_email_mismatch'

    await workspaceStore.acceptInvite(invite.workspaceId, invite.id, user.id)
    return null
  }
}
