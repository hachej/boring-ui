const ISSUE_REFERENCE_PATTERNS = [
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?[ \t]*(?:[\w.-]+\/[\w.-]+)?#(\d+)\b/i,
  /\b(?:github\s+)?issue\s*:?[ \t]*#(\d+)\b/i,
  /\b(?:refs?|references?|related\s+to)\s*:?[ \t]*#(\d+)\b/i,
  /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)\b/i,
]

export function extractLinkedIssueNumber(body = '') {
  for (const pattern of ISSUE_REFERENCE_PATTERNS) {
    const match = String(body).match(pattern)
    if (match) return Number(match[1])
  }
  return null
}

export function extractBeadId(title = '', body = '') {
  const titleMatch = String(title).match(/^\[([^\]]+)\]/)
  if (titleMatch && /^(?:br|wt)-[a-z0-9-]+$/i.test(titleMatch[1])) return titleMatch[1]

  const bodyMatch = String(body).match(/\b(?:bead\s*:\s*`?)?((?:br|wt)-[a-z0-9-]+)\b/i)
  return bodyMatch?.[1] ?? 'unknown bead'
}
