import { HttpError, ERROR_CODES } from '../shared/errors.js'
import type { ErrorCode } from '../shared/errors.js'

let apiBase = ''

export function setApiBase(base: string) {
  apiBase = base.replace(/\/$/, '')
}

export function getApiBase(): string {
  return apiBase
}

export function buildApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = getApiBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function getWsBase(): string {
  const base = getApiBase()
  if (base.startsWith('https://')) return base.replace('https://', 'wss://')
  if (base.startsWith('http://')) return base.replace('http://', 'ws://')
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? 'wss:'
    : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  return `${protocol}//${host}${base}`
}

export function buildWsUrl(path: string): string {
  const base = getWsBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export function openWebSocket(
  path: string,
  protocols?: string | string[],
): WebSocket {
  return new WebSocket(buildWsUrl(path), protocols)
}

async function parseErrorEnvelope(
  response: Response,
): Promise<{ code: ErrorCode; message: string; requestId?: string }> {
  try {
    const body = (await response.json()) as {
      code?: string
      message?: string
      error?: string
      requestId?: string
    }
    const code = (body.code ?? 'internal_error') as ErrorCode
    const message = body.message ?? body.error ?? response.statusText
    return { code, message, requestId: body.requestId }
  } catch {
    return {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: response.statusText || `HTTP ${response.status}`,
    }
  }
}

export async function apiFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fullUrl = buildApiUrl(url)
  const response = await fetch(fullUrl, {
    ...init,
    credentials: 'include',
  }).catch((err: unknown) => {
    throw new HttpError({
      status: 0,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    })
  })

  if (!response.ok) {
    const envelope = await parseErrorEnvelope(response)
    throw new HttpError({
      status: response.status,
      code: envelope.code,
      message: envelope.message,
      requestId: envelope.requestId,
    })
  }

  return response
}

export async function apiFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(url, init)
  return response.json() as Promise<T>
}

export function getHttpErrorDetail(
  err: unknown,
): { code: string; message: string; status?: number } {
  if (err instanceof HttpError) {
    return { code: err.code, message: err.message, status: err.status }
  }
  if (err instanceof Error) {
    return { code: 'internal_error', message: err.message }
  }
  return { code: 'internal_error', message: String(err) }
}

export type RouteMap = {
  signin: '/auth/signin'
  signup: '/auth/signup'
  forgotPassword: '/auth/forgot-password'
  resetPassword: '/auth/reset-password'
  verifyEmail: '/auth/verify-email'
  authError: '/auth/error'
  callbackGithub: '/auth/callback/github'
  callbackGoogle: '/auth/callback/google'
  me: '/me'
  workspaceMembers: '/w/:id/members'
  workspaceInvites: '/w/:id/invites'
  workspaceSettings: '/w/:id/settings'
  inviteAccept: '/invites/:token'
}

export const routes: RouteMap = {
  signin: '/auth/signin',
  signup: '/auth/signup',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  verifyEmail: '/auth/verify-email',
  authError: '/auth/error',
  callbackGithub: '/auth/callback/github',
  callbackGoogle: '/auth/callback/google',
  me: '/me',
  workspaceMembers: '/w/:id/members',
  workspaceInvites: '/w/:id/invites',
  workspaceSettings: '/w/:id/settings',
  inviteAccept: '/invites/:token',
}

export function routeHref(
  name: keyof RouteMap,
  params?: Record<string, string>,
): string {
  let path: string = routes[name]
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(value))
    }
  }
  return path
}
