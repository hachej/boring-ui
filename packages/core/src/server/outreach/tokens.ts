import { createHmac, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

export function generateOutreachToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashOutreachToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token, 'utf8').digest('base64url')
}

export function buildOutreachUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/o/${encodeURIComponent(token)}`
  url.search = ''
  url.hash = ''
  return url.toString()
}
