const CANONICAL_RUNNER_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Validates the hub's canonical path alphabet without rewriting identity.
 * Lossy normalization would let distinct workspace/app ids address one cell.
 */
export function sanitizeAppName(name: string): string {
  if (!CANONICAL_RUNNER_ID.test(name) || name.includes("--")) {
    throw new Error(`runner id "${name}" must already be canonical lowercase [a-z0-9-] without repeated or edge dashes`)
  }
  return name
}

/** Builds the app runner service's `{workspace}--{app}` internal id. */
export function appRunnerAppId(workspaceId: string, appName: string): string {
  return `${sanitizeAppName(workspaceId)}--${sanitizeAppName(appName)}`
}
