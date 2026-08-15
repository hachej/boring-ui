import { ERROR_CODES, HttpError } from '../shared/errors.js'

/**
 * Decision 28: every initialized Workspace durably persists its
 * `defaultAgentTypeId`. This module owns trusted write validation, legacy
 * cohort classification, and fail-closed runtime resolution.
 *
 * Agent type ids share the workspace-type slug grammar (lowercase slug,
 * <= 63 chars), matching the `workspaces_default_agent_type_id_check`
 * constraint installed by migration 0024.
 */
export const AGENT_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/

export function isAgentTypeId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_TYPE_ID_PATTERN.test(value)
}

export function parseTrustedDefaultAgentTypeId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!isAgentTypeId(value)) {
    throw new HttpError({ status: 400, code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID, message: 'Invalid default agent type ID' })
  }
  return value
}

export interface WorkspaceDefaultAgentTypeInventoryItem {
  readonly defaultAgentTypeId: string | null
  readonly count: number
}

export interface WorkspaceDefaultAgentTypeCohorts {
  readonly nullCount: number
  readonly knownCount: number
  readonly unknown: ReadonlyArray<{ readonly defaultAgentTypeId: string; readonly count: number }>
}

/** Classifies persisted cohorts without mutating or repairing any row. */
export function classifyWorkspaceDefaultAgentTypeCohorts(
  inventory: readonly WorkspaceDefaultAgentTypeInventoryItem[],
  availableAgentTypeIds: readonly string[],
): WorkspaceDefaultAgentTypeCohorts {
  const available = new Set(availableAgentTypeIds)
  let nullCount = 0
  let knownCount = 0
  const unknown: Array<{ defaultAgentTypeId: string; count: number }> = []
  for (const item of inventory) {
    if (item.defaultAgentTypeId === null) nullCount += item.count
    else if (available.has(item.defaultAgentTypeId)) knownCount += item.count
    else unknown.push({ defaultAgentTypeId: item.defaultAgentTypeId, count: item.count })
  }
  unknown.sort((left, right) => left.defaultAgentTypeId.localeCompare(right.defaultAgentTypeId))
  return { nullCount, knownCount, unknown }
}

export const LEGACY_DEFAULT_AGENT_TYPE_ID = 'default'

/** Resolves and validates the application default used by the NULL-only backfill. */
export function resolveApplicationDefaultAgentTypeId(input: {
  readonly bootDefaultAgentTypeId: string | undefined
  readonly availableAgentTypeIds: readonly string[]
}): string {
  const candidate = input.bootDefaultAgentTypeId ?? input.availableAgentTypeIds[0] ?? LEGACY_DEFAULT_AGENT_TYPE_ID
  if (!input.availableAgentTypeIds.includes(candidate)) {
    throw new HttpError({
      status: 500,
      code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      message: 'Configured application default Agent is unavailable',
    })
  }
  return candidate
}

export interface ResolveWorkspaceDefaultAgentTypeIdInput {
  readonly persistedDefaultAgentTypeId: string | null | undefined
  readonly bootDefaultAgentTypeId: string | undefined
  readonly availableAgentTypeIds: readonly string[]
  readonly onUnknownPersistedSeat?: (diagnostic: {
    readonly code: typeof ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT
    readonly persistedDefaultAgentTypeId: string
  }) => void
}

/**
 * Resolves the persisted Workspace default after the explicit NULL backfill.
 * Legacy NULL remains readable for rollback/pre-migration cohorts, but a
 * configured non-NULL value is authoritative: an unavailable value fails
 * stably and is never reinterpreted as a boot or fleet default.
 */
export function resolveWorkspaceDefaultAgentTypeId(input: ResolveWorkspaceDefaultAgentTypeIdInput): string {
  const persisted = input.persistedDefaultAgentTypeId ?? null
  if (persisted === null) return resolveApplicationDefaultAgentTypeId(input)
  if (input.availableAgentTypeIds.includes(persisted)) return persisted
  input.onUnknownPersistedSeat?.({
    code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
    persistedDefaultAgentTypeId: persisted,
  })
  throw new HttpError({
    status: 409,
    code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
    message: 'Workspace default Agent is unavailable',
  })
}
