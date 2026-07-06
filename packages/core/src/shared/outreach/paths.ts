function hasControlCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function isSafeInternalPath(path: string): boolean {
  if (hasControlCharacter(path)) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  try {
    const parsed = new URL(path, 'https://boring.local')
    return parsed.origin === 'https://boring.local'
  } catch {
    return false
  }
}

export function sanitizeOutreachTargetPath(path: string, fallback = '/'): string {
  const safeFallback = fallback !== path && isSafeInternalPath(fallback) ? fallback : '/'
  if (!isSafeInternalPath(path)) return safeFallback
  return path
}

export function normalizeOutreachTargetPath(path: string): string {
  if (sanitizeOutreachTargetPath(path) !== path) {
    throw new Error('target path must be an internal absolute path')
  }
  return path
}

export function resolveWorkspaceTargetPath(path: string, workspaceId: string): string {
  const normalized = sanitizeOutreachTargetPath(path)
  if (normalized === '/') return `/workspace/${workspaceId}`
  return normalized.replaceAll('{workspaceId}', workspaceId).replaceAll(':workspaceId', workspaceId)
}
