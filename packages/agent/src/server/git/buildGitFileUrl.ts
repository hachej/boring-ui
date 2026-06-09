function normalizeRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed)
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`
  }

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(trimmed)
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`
  }

  return null
}

function sanitizeRef(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Build a GitHub blob URL for a repo-relative file path. Pure, server-side:
 * the git file-url route is the only consumer, so it lives in the agent
 * package rather than reaching across into @hachej/boring-workspace.
 */
export function buildGitFileUrl(input: {
  remoteUrl: string
  repoRelativePath: string
  branch?: string | null
  commitSha?: string | null
}): string | null {
  const remoteBaseUrl = normalizeRemoteUrl(input.remoteUrl)
  if (!remoteBaseUrl) return null

  const ref = sanitizeRef(input.branch) ?? sanitizeRef(input.commitSha)
  const repoRelativePath = input.repoRelativePath.trim().replace(/^\/+/, '')
  if (!ref || !repoRelativePath) return null

  return `${remoteBaseUrl}/blob/${encodeURIComponent(ref)}/${repoRelativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}
