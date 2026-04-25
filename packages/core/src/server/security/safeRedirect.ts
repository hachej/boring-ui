import type { CoreConfig } from '../../shared/types.js'

const DANGEROUS_CHARS = /[\0\r\n<>"'`]/

export function safeRedirect(url: string, config: CoreConfig): string {
  if (!url || typeof url !== 'string') return '/'

  if (DANGEROUS_CHARS.test(url)) return '/'

  const trimmed = url.trim()
  if (!trimmed) return '/'

  if (trimmed.startsWith('//')) return '/'

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return '/'
  }

  if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:') {
    return '/'
  }

  const urlOrigin = parsed.origin

  const allowed = config.cors.origins.some((origin) => {
    const normalizedOrigin = origin.replace(/\/$/, '')
    return normalizedOrigin === urlOrigin
  })

  if (!allowed) return '/'

  return trimmed
}
