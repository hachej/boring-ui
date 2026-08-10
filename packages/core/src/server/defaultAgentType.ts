import { ERROR_CODES, HttpError } from '../shared/errors.js'

/**
 * Decision 28: every initialized Workspace durably persists its
 * `defaultAgentTypeId`. This module owns the trusted write-path validation and
 * the read-path resolution preference order.
 *
 * Agent type ids share the workspace-type slug grammar (lowercase slug,
 * <= 63 chars), matching the `workspaces_default_agent_type_id_check`
 * constraint installed by migration 0024.
 */
export const AGENT_TYPE_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/

export function isAgentTypeId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_TYPE_ID_PATTERN.test(value)
}

/**
 * Validates a server-controlled default agent type id at workspace
 * initialization. `undefined` means "no persisted default" and maps to NULL.
 */
export function parseTrustedDefaultAgentTypeId(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!isAgentTypeId(value)) {
    throw new HttpError({
      status: 400,
      code: ERROR_CODES.INVALID_DEFAULT_AGENT_TYPE_ID,
      message: 'Invalid default agent type ID',
    })
  }
  return value
}

export interface ResolveWorkspaceDefaultAgentTypeIdInput {
  /** Persisted per-workspace value (`workspaces.default_agent_type_id`). */
  readonly persistedDefaultAgentTypeId: string | null | undefined
  /** Boot-time host option (`defaultAgentTypeId`). */
  readonly bootDefaultAgentTypeId: string | undefined
  /** Validated fleet seats compiled at boot. */
  readonly availableAgentTypeIds: readonly string[]
  /** Diagnostic sink for the fail-closed fallback; stable error code attached. */
  readonly onUnknownPersistedSeat?: (diagnostic: {
    readonly code: typeof ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT
    readonly persistedDefaultAgentTypeId: string
    readonly fallbackAgentTypeId: string
  }) => void
}

export const LEGACY_DEFAULT_AGENT_TYPE_ID = 'default'

/**
 * Read-path preference order (Decision 28):
 *   1. the workspace's persisted `defaultAgentTypeId`, iff it names a
 *      validated fleet seat;
 *   2. the boot-time host `defaultAgentTypeId` option;
 *   3. the first validated fleet seat;
 *   4. the legacy `'default'` agent.
 *
 * Fails closed to the fallback chain — never throws — when the persisted
 * value names an unknown seat; the caller receives a
 * `default_agent_type_unknown_seat` diagnostic instead.
 */
export function resolveWorkspaceDefaultAgentTypeId(
  input: ResolveWorkspaceDefaultAgentTypeIdInput,
): string {
  const fallback = input.bootDefaultAgentTypeId
    ?? input.availableAgentTypeIds[0]
    ?? LEGACY_DEFAULT_AGENT_TYPE_ID
  const persisted = input.persistedDefaultAgentTypeId ?? null
  if (persisted === null) return fallback
  if (input.availableAgentTypeIds.includes(persisted)) return persisted
  input.onUnknownPersistedSeat?.({
    code: ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
    persistedDefaultAgentTypeId: persisted,
    fallbackAgentTypeId: fallback,
  })
  return fallback
}
