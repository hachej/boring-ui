import { createHash } from 'node:crypto'
import type { CoreConfig } from '../../shared/types.js'
import type { WorkspaceStore } from '../app/types.js'
import type { MailTransport } from '../mail/transport.js'
import { renderWelcome } from '../mail/templates/index.js'
import { REQUEST_SCOPE_WORKSPACE_HEADER } from './requestWorkspaceScope.js'
import {
  normalizeSignupHostname,
  resolveSignupDefaultAgentTypeId,
  TRUSTED_SIGNUP_HOSTNAME_HEADER,
  type ValidatedSignupAgentDefaults,
} from '../signupAgentDefaults.js'

export interface PostSignupUser {
  id: string
  email: string
  name: string
  [key: string]: unknown
}

export interface PostSignupContext {
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
  /** Boot-compiled, fleet-validated map. Raw CoreConfig is never consumed. */
  signupAgentDefaults?: ValidatedSignupAgentDefaults
  workspaceStore: WorkspaceStore
  transport: MailTransport | null
  logger?: { warn: (obj: Record<string, unknown>, msg: string) => void }
  disableDefaultWorkspaceCreation?: boolean
}

function readHeader(ctx: PostSignupContext | null, name: string): string | null {
  if (!ctx) return null
  const fromGetHeader = ctx.getHeader?.(name)
  if (fromGetHeader) return fromGetHeader
  const ctxAny = ctx as Record<string, unknown>
  const req = ctxAny.request as { headers?: { get?: (n: string) => string | null } } | undefined
  return req?.headers?.get?.(name) ?? null
}

function readRequestWorkspaceId(ctx: PostSignupContext | null): string | null {
  const encoded = readHeader(ctx, REQUEST_SCOPE_WORKSPACE_HEADER)
  if (!encoded) return null
  try {
    const decoded = decodeURIComponent(encoded)
    return decoded && encodeURIComponent(decoded) === encoded ? decoded : null
  } catch {
    return null
  }
}

export function createPostSignupHook(deps: PostSignupHookDeps) {
  const {
    config,
    signupAgentDefaults,
    workspaceStore,
    transport,
    logger,
    disableDefaultWorkspaceCreation,
  } = deps

  return async function postSignupHook(
    user: PostSignupUser & Record<string, unknown>,
    rawCtx: unknown,
  ): Promise<void> {
    const ctx = rawCtx as PostSignupContext | null
    const inviteToken = readHeader(ctx, 'x-invite-token')
    const requestWorkspaceId = disableDefaultWorkspaceCreation
      ? readRequestWorkspaceId(ctx)
      : null
    let inviteAccepted = false

    if (inviteToken) {
      try {
        const failureCode = await tryAcceptInvite(user, inviteToken, requestWorkspaceId)
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
      } catch (err) {
        logger?.warn(
          { userId: user.id, email: user.email, error: err instanceof Error ? err.message : String(err) },
          'post-signup invite acceptance threw unexpectedly',
        )
      }
    }

    if (!inviteAccepted && !disableDefaultWorkspaceCreation) {
      // Decision 28 hook: an exact trusted signup-domain mapping may
      // initialize the default seat of this newly created default Workspace.
      // The hostname is read once, matched exactly against boot-validated
      // trusted host configuration, then discarded — it is never persisted
      // and has no routing, membership, selection, or authorization effect.
      const signupHostname = normalizeSignupHostname(
        readHeader(ctx, TRUSTED_SIGNUP_HOSTNAME_HEADER),
      )
      const signupSeat = resolveSignupDefaultAgentTypeId(signupAgentDefaults, signupHostname)
      const initialSeat = signupSeat ?? config.defaultAgentTypeId
      await workspaceStore.create(user.id, 'Default workspace', config.appId, {
        isDefault: true,
        // Decision 28: stamp the initial default seat at initialization only.
        ...(initialSeat ? { defaultAgentTypeId: initialSeat } : {}),
      })
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
    requestWorkspaceId: string | null,
  ): Promise<InviteFailureCode | null> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const invite = await workspaceStore.getInviteByTokenHash(tokenHash)

    if (!invite) return 'invite_not_found'
    if (disableDefaultWorkspaceCreation && invite.workspaceId !== requestWorkspaceId) return 'invite_not_found'
    if (invite.lockedUntil && new Date(invite.lockedUntil) > new Date()) return 'invite_not_found'
    if (invite.acceptedAt) return 'invite_already_accepted'
    if (new Date(invite.expiresAt) <= new Date()) return 'invite_expired'
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) return 'invite_email_mismatch'

    await workspaceStore.acceptInvite(invite.workspaceId, invite.id, user.id)
    return null
  }
}
