export const DEFAULT_WORKSPACE_TYPE_ID = 'default'

export const WORKSPACE_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/

export function isWorkspaceTypeId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_TYPE_ID_PATTERN.test(value)
}
