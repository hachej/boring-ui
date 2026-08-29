import type { CoreConfig } from '../../shared/types.js'

/**
 * Builds user-facing links for auth emails so they land on SPA routes
 * instead of raw API endpoints. The SPA and API may run on different
 * origins (e.g. in dev, where Vite serves the front on its own port and
 * proxies API calls) — links here always target the front origin.
 *
 * Route shapes are mirrored from packages/core/src/front/utils.ts
 * (`routes.inviteAccept` = '/invites/:token', `routes.resetPassword` =
 * '/auth/reset-password'). Keep both in sync if those routes change.
 */

type EmailLinkConfig = {
  auth: Pick<CoreConfig['auth'], 'url' | 'frontUrl'>
}

function frontOrigin(config: EmailLinkConfig): string {
  const origin = config.auth.frontUrl ?? config.auth.url
  return origin.replace(/\/+$/, '')
}

/** SPA invite-accept link: /invites/:token */
export function buildInviteAcceptUrl(config: EmailLinkConfig, inviteToken: string): string {
  return `${frontOrigin(config)}/invites/${encodeURIComponent(inviteToken)}`
}

/** SPA password-reset link: /auth/reset-password?token=... */
export function buildResetPasswordUrl(config: EmailLinkConfig, resetToken: string): string {
  return `${frontOrigin(config)}/auth/reset-password?token=${encodeURIComponent(resetToken)}`
}
