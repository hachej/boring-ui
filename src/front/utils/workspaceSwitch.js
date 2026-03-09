/**
 * Pure workspace-switch logic, extracted from App.jsx for testability.
 *
 * The functions here contain zero side-effects — no window.prompt, no
 * window.location, no fetch.  App.jsx orchestrates those around these helpers.
 */

/**
 * Filter the full workspace list down to candidates the user can switch to.
 * Excludes the current workspace and any entry without an id.
 */
export function getWorkspaceSwitchCandidates(workspaces, currentWorkspaceId) {
  return workspaces.filter(
    (ws) => ws.id && ws.id !== currentWorkspaceId,
  )
}

/**
 * Build the prompt message and default value shown by `window.prompt`.
 * Returns null when there are no candidates.
 */
export function buildSwitchPrompt(candidates) {
  if (candidates.length === 0) return null

  const defaultId = candidates[0].id
  const optionsText = candidates
    .map((ws) => `- ${ws.name || ws.id} (${ws.id})`)
    .join('\n')

  return {
    message: `Select workspace id to switch:\n${optionsText}`,
    defaultValue: defaultId,
  }
}

/**
 * Given what the user typed (or accepted) in the prompt, resolve the
 * workspace they want to switch to.
 *
 * Returns the matching workspace object, or null when the input is
 * empty, matches the current workspace, or doesn't match any candidate.
 */
export function resolveWorkspaceSwitchTarget(candidates, currentWorkspaceId, promptValue) {
  if (!promptValue) return null
  const selectedId = promptValue.trim()
  if (!selectedId || selectedId === currentWorkspaceId) return null

  const selected = candidates.find(
    (ws) => ws.id === selectedId || ws.name === selectedId,
  )
  return selected?.id ? selected : null
}
