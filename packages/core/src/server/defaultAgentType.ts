import { ERROR_CODES } from '../shared/errors.js'

type DefaultAgentTypeErrorCode =
  | typeof ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID
  | typeof ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT

/** Transport-neutral failure raised by default-Agent validation and resolution. */
export class DefaultAgentTypeError extends Error {
  readonly code: DefaultAgentTypeErrorCode

  constructor(code: DefaultAgentTypeErrorCode, message: string) {
    super(message)
    this.name = 'DefaultAgentTypeError'
    this.code = code
  }
}

/**
 * Decision 28: configured-fleet Workspaces durably persist a regular Agent's
 * `defaultAgentTypeId`. A NULL is reserved for legacy-compatibility mode. This
 * module owns trusted write validation, cohort classification, and fail-closed
 * runtime resolution.
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
    throw new DefaultAgentTypeError(
      ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
      'Invalid default agent type ID',
    )
  }
  return value
}

/** Validates call sites that require an explicit configured regular Agent. */
export function parseRequiredDefaultAgentTypeId(value: unknown): string {
  const parsed = parseTrustedDefaultAgentTypeId(value)
  if (parsed === null) {
    throw new DefaultAgentTypeError(
      ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
      'A default agent type ID is required',
    )
  }
  return parsed
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

function validateApplicationAgentTypeIds(agentTypeIds: readonly string[]): void {
  const unique = new Set<string>()
  for (const agentTypeId of agentTypeIds) {
    if (!isAgentTypeId(agentTypeId) || unique.has(agentTypeId)) {
      throw new DefaultAgentTypeError(
        ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
        'Application Agent fleet identities must be unique valid IDs',
      )
    }
    unique.add(agentTypeId)
  }
}

/**
 * Resolves the Workspace default from regular configured Agents only.
 * `null` means the application is running in legacy-compatibility mode; the
 * `legacyDefault` runtime is never reclassified as a configured default.
 */
export function resolveApplicationDefaultAgentTypeId(input: {
  readonly configuredDefaultAgentTypeId: string | undefined
  readonly regularAgentTypeIds: readonly string[]
}): string | null {
  validateApplicationAgentTypeIds(input.regularAgentTypeIds)
  if (input.configuredDefaultAgentTypeId === undefined) {
    return input.regularAgentTypeIds[0] ?? null
  }
  const candidate = parseRequiredDefaultAgentTypeId(input.configuredDefaultAgentTypeId)
  if (!input.regularAgentTypeIds.includes(candidate)) {
    throw new DefaultAgentTypeError(
      ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      'Configured application default Agent is not an available regular fleet member',
    )
  }
  return candidate
}

export interface ResolveWorkspaceDefaultAgentTypeIdInput {
  readonly persistedDefaultAgentTypeId: string | null | undefined
  /** A configured regular Agent, or null in legacy-compatibility mode. */
  readonly applicationDefaultAgentTypeId: string | null
  readonly regularAgentTypeIds: readonly string[]
  readonly onUnknownPersistedSeat?: (diagnostic: {
    readonly code: typeof ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT
    readonly persistedDefaultAgentTypeId: string
  }) => void
}

/**
 * Resolves the persisted Workspace default after the explicit NULL backfill.
 * NULL selects the configured regular default, or the compatibility runtime
 * when no regular fleet exists. A non-NULL value is authoritative: an
 * unavailable value fails stably and is never silently reinterpreted.
 */
export function resolveWorkspaceDefaultAgentTypeId(input: ResolveWorkspaceDefaultAgentTypeIdInput): string {
  const persisted = input.persistedDefaultAgentTypeId ?? null
  if (persisted === null) {
    return input.applicationDefaultAgentTypeId ?? LEGACY_DEFAULT_AGENT_TYPE_ID
  }
  if (input.regularAgentTypeIds.includes(persisted)) return persisted
  input.onUnknownPersistedSeat?.({
    code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
    persistedDefaultAgentTypeId: persisted,
  })
  throw new DefaultAgentTypeError(
    ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
    'Workspace default Agent is unavailable',
  )
}
