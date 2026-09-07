function coerceHttpStatus(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function extractHttpStatus(error: unknown): number | null {
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  } | null
  return coerceHttpStatus(candidate?.statusCode)
    ?? coerceHttpStatus(candidate?.status)
    ?? coerceHttpStatus(candidate?.response?.status)
}
