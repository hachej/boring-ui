/**
 * The agent package's `applyCspHeaders` has no `frame-src` knob, and its
 * `default-src 'self'` blocks the whole point of this app — framing the user's
 * app and any sheet the agent raises. So the playground front sets its own dev
 * policy: the agent's dev policy verbatim, plus `frame-src` built from the same
 * origin allowlist the `show_on_screen` tool enforces server-side. Two places,
 * one list — the browser cannot frame anything the tool would have rejected.
 */
export function devCspPolicy(allowedOrigins: readonly string[]): string {
  const frameSources = allowedOrigins
    // CSP host-sources do not take bracketed IPv6 literals; drop rather than emit junk.
    .filter((origin) => !origin.includes('['))
    .join(' ')
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws: wss: blob: data:",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `frame-src 'self' ${frameSources}`.trim(),
  ].join('; ')
}
