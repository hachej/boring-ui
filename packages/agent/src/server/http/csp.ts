export const EXAMPLE_CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
].join('; ')

interface HeaderLike {
  setHeader(name: string, value: string): void
}

export function applyCspHeaders(response: HeaderLike): void {
  response.setHeader('Content-Security-Policy', EXAMPLE_CSP_POLICY)
}
