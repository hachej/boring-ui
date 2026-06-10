const DEFAULT_WORKSPACE_TITLE = "Boring UI"

function sanitizeWorkspaceTitleSegment(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|[a-z]:[\\/]|\\\\|\/|\.\.?[\\/])/i.test(trimmed)) return null
  if (/^(?:::1|localhost(?::\d+)?|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?|\[[a-f\d:]+\](?::\d+)?|[a-z\d-]+(?:\.[a-z\d-]+)+(?::\d+)?)$/i.test(trimmed)) return null
  return trimmed
}

export function formatWorkspaceDocumentTitle(input: {
  workspaceLabel?: string | null
  workspaceId?: string | null
}): string {
  const label = sanitizeWorkspaceTitleSegment(input.workspaceLabel)
  if (label) return `${label} · ${DEFAULT_WORKSPACE_TITLE}`

  const workspaceId = sanitizeWorkspaceTitleSegment(input.workspaceId)
  if (workspaceId) return `${workspaceId} · ${DEFAULT_WORKSPACE_TITLE}`

  return DEFAULT_WORKSPACE_TITLE
}
