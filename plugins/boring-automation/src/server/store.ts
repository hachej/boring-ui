import { BORING_AUTOMATION_ERROR_CODES, type BoringAutomationErrorCode } from "../shared/error-codes"
export type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunCreate,
  AutomationRunPatch,
  AutomationStore,
  AutomationStoreCtx,
} from "../shared/types"

export class AutomationStoreError extends Error {
  constructor(
    public readonly code: BoringAutomationErrorCode,
    message: string,
    public readonly status = 500,
  ) {
    super(message)
  }
}

export function automationNotFound(id: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.AUTOMATION_NOT_FOUND, `automation ${id} not found`, 404)
}

export function runNotFound(id: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_NOT_FOUND, `automation run ${id} not found`, 404)
}
