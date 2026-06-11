function normalizeRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(trimmed)
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`
  }

  const httpsBaseUrl = normalizeHttpsGithubRemote(trimmed)
  if (httpsBaseUrl) return httpsBaseUrl

  return null
}

function normalizeHttpsGithubRemote(remoteUrl: string): string | null {
  let url: URL
  try {
    url = new URL(remoteUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null

  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (parts.length !== 2) return null

  const [owner, repoWithSuffix] = parts
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix
  if (!owner || !repo) return null

  return `https://github.com/${owner}/${repo}`
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
