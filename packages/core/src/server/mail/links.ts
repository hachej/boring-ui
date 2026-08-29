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
  const base = config.auth.frontUrl ?? config.auth.url
  // Parse and take `.origin` rather than string-trimming: this reliably
  // strips any path/query/fragment/userinfo the configured value might carry
  // (frontUrl is schema-validated to be a bare origin, but auth.url is not —
  // and a naive trailing-slash strip would otherwise silently root the link
  // under a stray path segment instead of the actual origin).
  return new URL(base).origin
}

/** SPA invite-accept link: /invites/:token */
export function buildInviteAcceptUrl(config: EmailLinkConfig, inviteToken: string): string {
  return `${frontOrigin(config)}/invites/${encodeURIComponent(inviteToken)}`
}

/** SPA password-reset link: /auth/reset-password?token=... */
export function buildResetPasswordUrl(config: EmailLinkConfig, resetToken: string): string {
  return `${frontOrigin(config)}/auth/reset-password?token=${encodeURIComponent(resetToken)}`
}
