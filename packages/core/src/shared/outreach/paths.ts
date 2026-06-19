export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  try {
    const parsed = new URL(path, 'https://boring.local')
    return parsed.origin === 'https://boring.local'
  } catch {
    return false
  }
}

export function normalizeOutreachTargetPath(path: string): string {
  if (!isSafeInternalPath(path)) {
    throw new Error('target path must be an internal absolute path')
  }
  return path
}

export function resolveWorkspaceTargetPath(path: string, workspaceId: string): string {
  const normalized = normalizeOutreachTargetPath(path)
  if (normalized === '/') return `/workspace/${workspaceId}`
  return normalized.replaceAll('{workspaceId}', workspaceId).replaceAll(':workspaceId', workspaceId)
}
