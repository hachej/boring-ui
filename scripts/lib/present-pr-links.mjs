const REPOSITORY = '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'
const SEMANTIC_PREFIX = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|(?:github\\s+)?issue|refs?|references?|related\\s+to)'
const semanticReference = new RegExp(`\\b${SEMANTIC_PREFIX}\\s*:?[ \\t]*(?:(${REPOSITORY})#|#)(\\d+)\\b`, 'i')
const issueUrl = new RegExp(`https?://github\\.com/(${REPOSITORY})/issues/(\\d+)\\b`, 'i')

export function extractLinkedIssueReference(body = '') {
  const text = String(body ?? '')
  const semanticMatch = text.match(semanticReference)
  if (semanticMatch) {
    return { repo: semanticMatch[1] ?? null, number: Number(semanticMatch[2]) }
  }

  const urlMatch = text.match(issueUrl)
  if (urlMatch) return { repo: urlMatch[1], number: Number(urlMatch[2]) }
  return null
}

export function resolveLinkedIssueReference(reference, currentRepo, lookup) {
  if (!reference) return { issue: null, notice: 'no linked issue' }
  const repo = reference.repo || currentRepo
  try {
    const candidate = lookup(repo, reference.number)
    if (candidate.pull_request) {
      return { issue: null, notice: `no linked issue (reference ${repo}#${reference.number} is a pull request)` }
    }
    return {
      issue: { number: candidate.number, title: candidate.title, url: candidate.html_url },
      notice: '',
    }
  } catch {
    return { issue: null, notice: `linked issue ${repo}#${reference.number} unavailable` }
  }
}

const BEAD_ID = '(?:br|wt)-[a-z0-9-]+(?:\\.[a-z0-9-]+)*'
const titleBead = new RegExp(`^\\[(${BEAD_ID})\\]`, 'i')
const bodyBead = new RegExp(`^\\s*(?:[-*]\\s*)?Bead\\s*:\\s*\\x60?(${BEAD_ID})\\x60?\\s*$`, 'gim')

export function extractBeadIds(title = '', body = '') {
  const titleMatch = String(title ?? '').match(titleBead)
  if (titleMatch) return [titleMatch[1]]

  return [...String(body ?? '').matchAll(bodyBead)]
    .map((match) => match[1])
    .filter((id, index, ids) => ids.indexOf(id) === index)
}
