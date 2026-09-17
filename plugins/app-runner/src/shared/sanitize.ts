/**
 * Sanitizes an app name to the `[a-z0-9-]` alphabet the app runner service
 * expects, matching the runner's `{workspaceId}--{sanitizedAppName}` app id
 * scheme. Lowercases, replaces disallowed characters with `-`, collapses
 * repeats, and trims leading/trailing dashes.
 */
export function sanitizeAppName(name: string): string {
  const lowered = name.trim().toLowerCase()
  const replaced = lowered.replace(/[^a-z0-9-]+/g, "-")
  const collapsed = replaced.replace(/-+/g, "-")
  return collapsed.replace(/^-+|-+$/g, "")
}

/** Builds the app runner service's `{app}` path segment for a workspace + app name. */
export function appRunnerAppId(workspaceId: string, appName: string): string {
  const sanitizedWorkspace = sanitizeAppName(workspaceId)
  const sanitizedApp = sanitizeAppName(appName)
  return `${sanitizedWorkspace}--${sanitizedApp}`
}
