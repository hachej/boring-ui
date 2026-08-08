import type { CoreFrontendRootHandler } from '@hachej/boring-core/app/server'

/**
 * Presentation-only hostname landings (Decision 28).
 *
 * A landing grants ZERO authority: the request Host header selects nothing but
 * static, trusted landing *content* configured at boot. It never routes,
 * authorizes, or touches membership/workspace/session/default-agent state.
 * Unauthenticated `GET /` on an exactly-matching Host gets a bounded static
 * HTML page whose only link is the fixed same-origin sign-in path; every other
 * request falls through untouched to the normal frontend.
 */

const SIGN_IN_PATH = '/auth/signin?redirect=%2F'

export const HOSTNAME_LANDING_ENV = 'BORING_HOSTNAME_LANDINGS'

export const HOSTNAME_LANDING_BOUNDS = Object.freeze({
  title: 120,
  summary: 500,
  ctaLabel: 80,
})

export interface HostnameLandingContent {
  readonly title: string
  readonly summary: string
  readonly ctaLabel?: string
}

/** Exact lowercase hostname (no port, no wildcard) → bounded landing content. */
export type HostnameLandingMap = ReadonlyMap<string, HostnameLandingContent>

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function validText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\0-\x1f\x7f]/.test(value)
  )
}

// Exact lowercase DNS-style hostname; explicitly no wildcards, ports, or paths.
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/

function renderLanding(content: HostnameLandingContent): string | null {
  const { title, summary, ctaLabel } = content
  if (
    !validText(title, HOSTNAME_LANDING_BOUNDS.title) ||
    !validText(summary, HOSTNAME_LANDING_BOUNDS.summary) ||
    (ctaLabel !== undefined && !validText(ctaLabel, HOSTNAME_LANDING_BOUNDS.ctaLabel))
  ) {
    return null
  }
  const cta = escapeHtml(ctaLabel ?? 'Sign in')
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    `${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(summary)}</p>` +
    `<a href="${SIGN_IN_PATH}">${cta}</a></main></body></html>`
  )
}

/**
 * Parse the static trusted landing config. Fails fast on any malformed entry
 * so a bad deploy config never half-serves. Input shape:
 * `{"agent-a.example.com":{"title":"…","summary":"…","ctaLabel":"…"}}`.
 */
export function parseHostnameLandings(raw: string | undefined): HostnameLandingMap {
  const trimmed = raw?.trim()
  if (!trimmed) return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${HOSTNAME_LANDING_ENV}: invalid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${HOSTNAME_LANDING_ENV}: expected an object mapping hostname to landing content`)
  }
  const landings = new Map<string, HostnameLandingContent>()
  for (const [hostname, value] of Object.entries(parsed)) {
    if (!HOSTNAME_PATTERN.test(hostname)) {
      throw new Error(`${HOSTNAME_LANDING_ENV}: invalid hostname ${JSON.stringify(hostname)} (exact lowercase hostname required, no wildcards or ports)`)
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`${HOSTNAME_LANDING_ENV}: landing for ${hostname} must be an object`)
    }
    const { title, summary, ctaLabel, ...rest } = value as Record<string, unknown>
    if (Object.keys(rest).length > 0) {
      throw new Error(`${HOSTNAME_LANDING_ENV}: unknown keys for ${hostname}: ${Object.keys(rest).join(', ')}`)
    }
    if (
      !validText(title, HOSTNAME_LANDING_BOUNDS.title) ||
      !validText(summary, HOSTNAME_LANDING_BOUNDS.summary) ||
      (ctaLabel !== undefined && !validText(ctaLabel, HOSTNAME_LANDING_BOUNDS.ctaLabel))
    ) {
      throw new Error(`${HOSTNAME_LANDING_ENV}: landing for ${hostname} is out of bounds (title<=120, summary<=500, ctaLabel<=80, no control characters)`)
    }
    landings.set(hostname, ctaLabel === undefined ? { title, summary } : { title, summary, ctaLabel })
  }
  return landings
}

function exactHost(hostHeader: unknown): string | null {
  if (typeof hostHeader !== 'string') return null
  // Strip a plain port suffix only; anything else must match exactly.
  const withoutPort = hostHeader.replace(/:\d{1,5}$/, '')
  const lowered = withoutPort.toLowerCase()
  return HOSTNAME_PATTERN.test(lowered) ? lowered : null
}

/**
 * Root handler for the core `frontendRootHandler` seam. Returns true (handled)
 * only for unauthenticated `GET /` on an exact configured host; returns false
 * (fall through, untouched) otherwise. Reads nothing beyond `request.user`
 * and `request.headers.host`.
 */
export function createHostnameLandingRootHandler(landings: HostnameLandingMap): CoreFrontendRootHandler {
  return (request, reply) => {
    if (landings.size === 0) return false
    if ((request as { user?: unknown }).user) return false
    const host = exactHost(request.headers.host)
    if (host === null) return false
    const content = landings.get(host)
    if (content === undefined) return false
    const html = renderLanding(content)
    if (html === null) return false
    reply
      .status(200)
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(html)
    return true
  }
}
