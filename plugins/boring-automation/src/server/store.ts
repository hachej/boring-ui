import { BORING_AUTOMATION_ERROR_CODES, type BoringAutomationErrorCode } from "../shared/error-codes"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunBegin,
  AutomationRunLifecyclePatch,
} from "../shared/types"

export type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunBegin,
  AutomationRunLifecyclePatch,
} from "../shared/types"

/** Plugin-local dependency injection seam for the single-workspace automation store. */
export interface AutomationStore {
  listAutomations(): Promise<Automation[]>
  getAutomation(id: string): Promise<Automation | null>
  createAutomation(input: AutomationCreate): Promise<Automation>
  updateAutomation(id: string, patch: AutomationPatch): Promise<Automation>
  deleteAutomation(id: string): Promise<void>

  getPrompt(automationId: string): Promise<string>
  updatePrompt(automationId: string, body: string): Promise<void>

  // Executor-owned operations. Public HTTP routes expose run history read-only.
  reconcileOrphanedRuns(automationId: string): Promise<void>
  beginRun(input: AutomationRunBegin): Promise<AutomationRun>
  updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun>
  listRuns(automationId: string): Promise<AutomationRun[]>
}

export class AutomationStoreError extends Error {
  constructor(
    public readonly code: BoringAutomationErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function automationNotFound(id: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, `automation ${id} not found`)
}

export function runNotFound(id: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND, `automation run ${id} not found`)
}

export function runAlreadyActive(automationId: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_ACTIVE, `automation ${automationId} already has an active run`)
}

export function runAlreadyRecorded(automationId: string, scheduledFor: string): AutomationStoreError {
  return new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED,
    `automation ${automationId} already has a run for ${scheduledFor}`,
  )
}
