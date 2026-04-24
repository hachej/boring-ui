export const EXAMPLE_CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
].join('; ')

// Vite dev server needs 'unsafe-eval' for React Fast Refresh and 'unsafe-inline'
// for its client preamble + HMR websocket bootstrap. connect-src must also permit
// 'ws:' so the HMR socket can reach the browser. This policy is ONLY for dev;
// production builds should use EXAMPLE_CSP_POLICY.
export const EXAMPLE_CSP_POLICY_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // blob: is required for reading dropped files via fetch(blob:…) during
  // FileReader-based blob→data URL conversion in the attachments pipeline.
  "connect-src 'self' ws: wss: blob: data:",
  "img-src 'self' data: blob:",
  "font-src 'self'",
].join('; ')

interface HeaderLike {
  setHeader(name: string, value: string): void
}

export function applyCspHeaders(response: HeaderLike, opts: { dev?: boolean } = {}): void {
  const policy = opts.dev ? EXAMPLE_CSP_POLICY_DEV : EXAMPLE_CSP_POLICY
  response.setHeader('Content-Security-Policy', policy)
}
