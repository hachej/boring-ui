import { BORING_AUTOMATION_ERROR_CODES, type BoringAutomationErrorCode } from "../shared/error-codes"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunCreate,
  AutomationRunPatch,
} from "../shared/types"

export type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunCreate,
  AutomationRunPatch,
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

  // Future executor-owned operations. Public HTTP routes expose run history read-only.
  createRun(input: AutomationRunCreate): Promise<AutomationRun>
  updateRun(runId: string, patch: AutomationRunPatch): Promise<AutomationRun>
  listRuns(automationId: string): Promise<AutomationRun[]>
  findRunningRun(automationId: string): Promise<AutomationRun | null>
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
