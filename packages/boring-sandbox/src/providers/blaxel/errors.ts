import type { ErrorCode } from '@hachej/boring-agent/shared'

import { SandboxProviderError } from '../../shared/providerV1'

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const direct = (error as { status?: unknown }).status
  if (typeof direct === 'number') return direct
  const code = (error as { code?: unknown }).code
  if (typeof code === 'number') return code
  const statusCode = (error as { status_code?: unknown }).status_code
  if (typeof statusCode === 'number') return statusCode
  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

export function isBlaxelNotFound(error: unknown): boolean {
  return statusOf(error) === 404 || String((error as { code?: unknown } | null)?.code) === '404'
}

export function isBlaxelTransient(error: unknown): boolean {
  const status = statusOf(error)
  return status === 502 || status === 503 || status === 504
}

export function isBlaxelAlreadyExists(error: unknown): boolean {
  if (statusOf(error) === 409) return true
  const message = error instanceof Error ? error.message : safeString(error)
  return /already exists|file exists/i.test(message)
}

export function normalizeBlaxelFilesystemError(error: unknown): Error {
  const rawCode = (error as { code?: unknown } | null)?.code
  const filesystemCode = typeof rawCode === 'string'
    && ['ENOENT', 'ENOTDIR', 'EISDIR', 'EEXIST', 'EPERM', 'EACCES'].includes(rawCode)
    ? rawCode
    : isBlaxelNotFound(error) ? 'ENOENT' : undefined
  if (filesystemCode) {
    return Object.assign(new Error(`${filesystemCode}: Blaxel filesystem operation failed`), {
      code: filesystemCode,
    })
  }
  return normalizeBlaxelError(error)
}

export function isBlaxelAlreadyExited(error: unknown): boolean {
  if (isBlaxelNotFound(error)) return true
  const message = error instanceof Error ? error.message : String(error)
  return /already (?:exited|completed|killed)|process.*not found/i.test(message)
}

function safeString(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
    const providerError = (error as { error?: unknown }).error
    if (typeof providerError === 'string') return providerError
  }
  return 'provider error'
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : safeString(error)
  const apiKey = process.env.BL_API_KEY
  const workspace = process.env.BL_WORKSPACE
  return raw
    .replace(/bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/authorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, 'authorization=[redacted]')
    .replace(/\/(?:home|Users|tmp|var\/folders)\/[\w./@+~-]+/g, '[host-path]')
    .replace(apiKey ? new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/, '[redacted]')
    .replace(workspace ? new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : /$^/, '[workspace]')
}

export function normalizeBlaxelError(
  error: unknown,
  fallback: ErrorCode = 'BLAXEL_API_ERROR',
): SandboxProviderError {
  if (error instanceof SandboxProviderError) return error
  const status = statusOf(error)
  const code: ErrorCode = status === 401 || status === 403 ? 'BLAXEL_AUTH_FAILED' : fallback
  return new SandboxProviderError(code, `Blaxel request failed: ${safeMessage(error)}`)
}
