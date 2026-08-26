import { ERROR_CODES } from '../shared/errors.js'
import type { WorkspaceStore } from './app/types.js'
import {
  DefaultAgentTypeError,
  classifyWorkspaceDefaultAgentTypeCohorts,
} from './defaultAgentType.js'

/** Postgres `undefined_table` — the workspaces relation does not exist yet. */
const UNDEFINED_TABLE = '42P01'
/** Postgres `undefined_column` — migration 0024 has not landed yet. */
const UNDEFINED_COLUMN = '42703'

function hasErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === code) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export interface ReconcileWorkspaceDefaultAgentTypesInput {
  readonly workspaceStore: WorkspaceStore
  readonly appId: string
  /** The validated non-NULL application default the backfill writes. */
  readonly applicationDefaultAgentTypeId: string
  /** Agent type ids of the compiled, validated fleet. */
  readonly availableAgentTypeIds: readonly string[]
  readonly log: {
    info(payload: Record<string, unknown>, message: string): void
    warn(payload: Record<string, unknown>, message: string): void
  }
}

/**
 * Decision 28 migration phase: compare-and-set the legacy NULL cohort to the
 * application default before any route can serve.
 *
 * Runs after the static fleet is compiled and validated, so the value written
 * is known to name a real seat. Re-running is idempotent, and because the
 * write is a compare-and-set against NULL, a concurrent non-NULL writer always
 * wins — a user's stored choice is never rewritten.
 *
 * The one tolerated failure is a pre-0024 schema on the *initial* inventory:
 * the relation may be undefined (42P01), or exist without the migration 0024
 * column (42703). Reference images intentionally prove the process can expose
 * /health before schema deployment. Once the inventory succeeds, every CAS or
 * convergence failure is fatal.
 */
export async function reconcileWorkspaceDefaultAgentTypes(
  input: ReconcileWorkspaceDefaultAgentTypesInput,
): Promise<void> {
  const { appId, applicationDefaultAgentTypeId, availableAgentTypeIds, log, workspaceStore } = input

  let inventoryBefore: Awaited<ReturnType<WorkspaceStore['inventoryDefaultAgentTypeIds']>>
  try {
    inventoryBefore = await workspaceStore.inventoryDefaultAgentTypeIds(appId)
  } catch (error) {
    const missingRelation = hasErrorCode(error, UNDEFINED_TABLE)
    const missingColumn = hasErrorCode(error, UNDEFINED_COLUMN)
    if (!missingRelation && !missingColumn) throw error
    log.warn({
      event: 'workspace.default_agent_type_id.backfill.skipped',
      appId,
      reason: missingRelation ? 'workspaces_relation_absent' : 'workspaces_default_agent_type_id_column_absent',
    }, 'workspace default Agent reconciliation skipped before schema deployment')
    return
  }

  const before = classifyWorkspaceDefaultAgentTypeCohorts(inventoryBefore, availableAgentTypeIds)
  const migratedCount = await workspaceStore.compareAndSetNullDefaultAgentTypeId(
    appId,
    applicationDefaultAgentTypeId,
  )
  const after = classifyWorkspaceDefaultAgentTypeCohorts(
    await workspaceStore.inventoryDefaultAgentTypeIds(appId),
    availableAgentTypeIds,
  )
  if (after.nullCount > 0) {
    throw new DefaultAgentTypeError(
      ERROR_CODES.DEFAULT_AGENT_TYPE_UNKNOWN_SEAT,
      'Workspace default Agent legacy reconciliation did not converge',
    )
  }
  log.info({
    event: 'workspace.default_agent_type_id.backfill',
    appId,
    applicationDefaultAgentTypeId,
    before,
    migratedCount,
    after,
  }, 'workspace default Agent legacy cohorts reconciled')
}
