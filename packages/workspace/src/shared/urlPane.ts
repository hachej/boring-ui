/**
 * URL pane — the workspace surface that embeds a *running* demo (a worker's dev
 * server, the hub itself) in a sandboxed iframe.
 *
 * This module is the whole security boundary, deliberately pure so both the
 * server (policy source, command rejection) and the front (the only thing that
 * actually renders an iframe) enforce the identical rule.
 *
 * The threat is not SSRF — nothing is fetched server-side; the browser loads the
 * URL directly. The threat is an agent (possibly prompt-injected) framing an
 * arbitrary origin inside the owner's workspace. So the rule is an *origin
 * allowlist*, defaulting to loopback only, with an explicit opt-in for anything
 * else via `BORING_URL_PANE_ALLOWED_ORIGINS`.
 */

export const URL_PANE_PLUGIN_ID = "url-pane"
export const URL_PANE_PANEL_ID = "url-pane.panel"

/** Origin patterns allowed to be framed. `*` is only ever a whole-port wildcard. */
export interface UrlPanePolicy {
  origins: string[]
}

/**
 * Loopback, any port. A worker's dev server is always local to the hub host, so
 * this covers the ratified use case without opening the pane to the internet.
 */
export const DEFAULT_URL_PANE_ORIGINS: readonly string[] = [
  "http://localhost:*",
  "http://127.0.0.1:*",
  "http://[::1]:*",
]

export const defaultUrlPanePolicy = (): UrlPanePolicy => ({ origins: [...DEFAULT_URL_PANE_ORIGINS] })

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

export type UrlPaneRejectionReason =
  | "empty"
  | "unparseable"
  | "protocol-not-allowed"
  | "credentials-not-allowed"
  | "origin-not-allowed"

export type UrlPaneResolution =
  | { ok: true; url: string; origin: string }
  | { ok: false; reason: UrlPaneRejectionReason; message: string }

/**
 * Parses the env/config form: a comma- or whitespace-separated list of origin
 * patterns. Empty input yields an empty list, NOT the default — callers decide
 * whether "unset" means default or means closed.
 */
export function parseUrlPaneOrigins(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\/+$/, "").toLowerCase()
}

/**
 * An origin matches a pattern when scheme and host match exactly and the port
 * matches exactly or the pattern's port is `*`. No host wildcards: `*.foo.com`
 * is a subdomain-takeover shaped footgun and this pane has no need for it.
 */
export function originMatchesPattern(origin: string, pattern: string): boolean {
  const normalizedPattern = normalizePattern(pattern)
  if (!normalizedPattern) return false
  const normalizedOrigin = normalizePattern(origin)
  if (normalizedPattern === normalizedOrigin) return true

  const wildcardIndex = normalizedPattern.lastIndexOf(":*")
  if (wildcardIndex === -1 || wildcardIndex !== normalizedPattern.length - 2) return false
  const prefix = normalizedPattern.slice(0, wildcardIndex)
  if (!prefix.includes("://")) return false
  if (!normalizedOrigin.startsWith(`${prefix}:`)) return false
  const port = normalizedOrigin.slice(prefix.length + 1)
  return /^\d+$/.test(port)
}

/**
 * The single decision point. Returns the URL to embed (serialized through `URL`
 * so no odd input reaches an `src` attribute verbatim) or a stable reason.
 */
export function resolveUrlPaneTarget(input: string | undefined | null, policy: UrlPanePolicy): UrlPaneResolution {
  const trimmed = (input ?? "").trim()
  if (!trimmed) return { ok: false, reason: "empty", message: "No URL was provided." }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, reason: "unparseable", message: `"${trimmed}" is not an absolute URL.` }
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: "protocol-not-allowed",
      message: `Scheme "${parsed.protocol}" is not allowed — the URL pane only embeds http and https.`,
    }
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: "credentials-not-allowed",
      message: "URLs carrying credentials are not allowed.",
    }
  }

  const allowed = policy.origins.some((pattern) => originMatchesPattern(parsed.origin, pattern))
  if (!allowed) {
    return {
      ok: false,
      reason: "origin-not-allowed",
      message: `Origin ${parsed.origin} is not in the URL pane allowlist.`,
    }
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin }
}

export interface UrlPanePaneParams {
  url?: string
  title?: string
}
