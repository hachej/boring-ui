import type { AutomationRunStatus } from "./types"

/** Statuses that reserve an automation's single dispatch slot. */
export const AUTOMATION_RUN_OCCUPYING_STATUSES = [
  "queued",
  "dispatching",
  "running",
  "outcome-unknown",
] as const satisfies readonly AutomationRunStatus[]

const AUTOMATION_RUN_OCCUPYING_STATUS_SET = new Set<AutomationRunStatus>(AUTOMATION_RUN_OCCUPYING_STATUSES)

/** SQL literal list for partial indexes that cannot accept query parameters. */
export const AUTOMATION_RUN_OCCUPYING_STATUSES_SQL = AUTOMATION_RUN_OCCUPYING_STATUSES
  .map((status) => `'${status}'`)
  .join(", ")

export function isAutomationRunOccupying(status: AutomationRunStatus): boolean {
  return AUTOMATION_RUN_OCCUPYING_STATUS_SET.has(status)
}
