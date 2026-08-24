import type { AutomationRunStatus } from "./types"

/** Canonical runtime and validation vocabulary for automation runs. */
export const AUTOMATION_RUN_STATUSES = [
  "queued",
  "dispatching",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "outcome-unknown",
] as const

/** Statuses that reserve an automation's single dispatch slot. */
export const AUTOMATION_RUN_STATUSES_SQL = AUTOMATION_RUN_STATUSES
  .map((status) => `'${status}'`)
  .join(", ")

export const AUTOMATION_RUN_SETTLED_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "outcome-unknown",
] as const satisfies readonly AutomationRunStatus[]

export const AUTOMATION_RUN_OCCUPYING_STATUSES = [
  "queued",
  "dispatching",
  "running",
  "outcome-unknown",
] as const satisfies readonly AutomationRunStatus[]

const AUTOMATION_RUN_OCCUPYING_STATUS_SET = new Set<AutomationRunStatus>(AUTOMATION_RUN_OCCUPYING_STATUSES)
const AUTOMATION_RUN_SETTLED_STATUS_SET = new Set<AutomationRunStatus>(AUTOMATION_RUN_SETTLED_STATUSES)

/** SQL literal list for partial indexes that cannot accept query parameters. */
export const AUTOMATION_RUN_OCCUPYING_STATUSES_SQL = AUTOMATION_RUN_OCCUPYING_STATUSES
  .map((status) => `'${status}'`)
  .join(", ")

export function isAutomationRunOccupying(status: AutomationRunStatus): boolean {
  return AUTOMATION_RUN_OCCUPYING_STATUS_SET.has(status)
}

export function isAutomationRunSettled(status: AutomationRunStatus): boolean {
  return AUTOMATION_RUN_SETTLED_STATUS_SET.has(status)
}

export type AutomationRunAbandonmentReason = "host-restart" | "lease-expired"

export function reconcileAbandonedRun(
  status: AutomationRunStatus,
  reason: AutomationRunAbandonmentReason,
): { status: AutomationRunStatus; error: string } {
  if (status === "queued") {
    return {
      status: "failed",
      error: reason === "host-restart"
        ? "Automation host restarted before the run completed"
        : "Automation worker lease expired before dispatch",
    }
  }
  if (status === "outcome-unknown") {
    return {
      status: "failed",
      error: reason === "host-restart"
        ? "Automation outcome remained unknown after host restart; releasing the occupied slot"
        : "Automation outcome remained unknown after its worker lease expired; releasing the occupied slot",
    }
  }
  return {
    status: "outcome-unknown",
    error: reason === "host-restart"
      ? "Automation dispatch outcome is unknown after host restart; the slot remains occupied"
      : "Automation dispatch outcome is unknown after its worker lease expired; the slot remains occupied",
  }
}
