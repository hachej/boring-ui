/**
 * Origin allowlist for anything the agent asks us to frame.
 *
 * Trimmed copy of `packages/workspace/src/shared/urlPane.ts`
 * (`originMatchesPattern` / `resolveUrlPaneTarget`), duplicated because this
 * app depends only on `@hachej/boring-agent` and must not pull in
 * `@hachej/boring-workspace`. Same rule, same threat model: an agent (possibly
 * prompt-injected) must not be able to frame an arbitrary origin in the user's
 * screen, so the default is loopback-only with an explicit env opt-in.
 */

export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'http://[::1]:*',
]

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

export type StageUrlRejectionReason =
  | 'empty'
  | 'unparseable'
  | 'protocol-not-allowed'
  | 'credentials-not-allowed'
  | 'origin-not-allowed'

export type StageUrlResolution =
  | { readonly ok: true; readonly url: string; readonly origin: string }
  | { readonly ok: false; readonly reason: StageUrlRejectionReason; readonly message: string }

/** Comma/whitespace separated env form. Empty input yields an empty list, not the default. */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\/+$/, '').toLowerCase()
}

/** Scheme and host must match exactly; only the port may be `*`. No host wildcards. */
export function originMatchesPattern(origin: string, pattern: string): boolean {
  const normalizedPattern = normalizePattern(pattern)
  if (!normalizedPattern) return false
  const normalizedOrigin = normalizePattern(origin)
  if (normalizedPattern === normalizedOrigin) return true

  const wildcardIndex = normalizedPattern.lastIndexOf(':*')
  if (wildcardIndex === -1 || wildcardIndex !== normalizedPattern.length - 2) return false
  const prefix = normalizedPattern.slice(0, wildcardIndex)
  if (!prefix.includes('://')) return false
  if (!normalizedOrigin.startsWith(`${prefix}:`)) return false
  const port = normalizedOrigin.slice(prefix.length + 1)
  return /^\d+$/.test(port)
}

/** The single decision point for every URL the agent hands us. */
export function resolveStageUrl(input: string | undefined | null, origins: readonly string[]): StageUrlResolution {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return { ok: false, reason: 'empty', message: 'No URL was provided.' }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'unparseable', message: `"${trimmed}" is not an absolute URL.` }
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: 'protocol-not-allowed',
      message: `Scheme "${parsed.protocol}" is not allowed — only http and https can be shown.`,
    }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials-not-allowed', message: 'URLs carrying credentials are not allowed.' }
  }
  if (!origins.some((pattern) => originMatchesPattern(parsed.origin, pattern))) {
    return { ok: false, reason: 'origin-not-allowed', message: `Origin ${parsed.origin} is not allowed on this screen.` }
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin }
}

/** Default list plus whatever `ONE_CHAT_ALLOWED_ORIGINS` adds. */
export function resolveAllowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...DEFAULT_ALLOWED_ORIGINS, ...parseAllowedOrigins(env.ONE_CHAT_ALLOWED_ORIGINS)]
}
