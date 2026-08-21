import type { AgentSessionRef } from "@hachej/boring-agent/shared"
import { BORING_AUTOMATION_ERROR_CODES, type BoringAutomationErrorCode } from "../shared/error-codes"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunBegin,
  AutomationRunLifecyclePatch,
} from "../shared/types"

export interface AutomationSeed {
  key: string
  title: string
  enabled: boolean
  cron: string | null
  timezone: string
  model: string
  agentTypeId: string
  runDurationCapMs?: number | null
  promptRef: string
}

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
  /** Reads the optional workspace-owned automation seed manifest. */
  readSeedManifest(): Promise<string | null>
  /** Idempotently provisions metadata for a checked-in prompt; returns null when the prompt is absent. */
  ensureSeededAutomation(input: AutomationSeed): Promise<Automation | null>
  /** Resolves immutable seed keys that currently exist without relying on mutable automation metadata. */
  findExistingSeedKeys(keys: readonly string[]): Promise<readonly string[]>
  /** Atomically removes metadata for an immutable seed key only when no run occupies it. */
  removeSeededAutomationIfIdle(key: string): Promise<boolean>
  updateAutomation(id: string, patch: AutomationPatch): Promise<Automation>
  deleteAutomation(id: string): Promise<void>

  getPrompt(automationId: string): Promise<string>
  updatePrompt(automationId: string, body: string): Promise<void>

  // Executor-owned operations. Public HTTP routes expose run history read-only.
  reconcileOrphanedRuns(automationId: string): Promise<void>
  beginRun(input: AutomationRunBegin): Promise<AutomationRun>
  claimRunForDispatch(runId: string): Promise<AutomationRun | null>
  heartbeatRun(runId: string): Promise<boolean>
  /** Preserve host acceptance after lease reconciliation; accepted ambiguity remains occupying. */
  preserveAcceptedDispatch(
    runId: string,
    receipt: NonNullable<AutomationRun["dispatchReceipt"]>,
    completedAt: string,
    error: string,
  ): Promise<AutomationRun | null>
  updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun>
  listRuns(automationId: string, limit?: number): Promise<AutomationRun[]>
  /** Direct actor-scoped lookup for one automation-owned run. */
  getRun(automationId: string, runId: string): Promise<AutomationRun | null>
  /** Globally newest runs for fleet inspection, bounded at storage. */
  listRecentRuns(limit: number): Promise<AutomationRun[]>
  /** Exact durable Agent-address lookup for session controls. */
  findRunBySessionRef(ref: AgentSessionRef): Promise<AutomationRun | null>
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

export function runLeaseLost(runId: string): AutomationStoreError {
  return new AutomationStoreError(BORING_AUTOMATION_ERROR_CODES.RUN_LEASE_LOST, `automation run ${runId} no longer owns an active lease`)
}

export function runAlreadyRecorded(automationId: string, scheduledFor: string): AutomationStoreError {
  return new AutomationStoreError(
    BORING_AUTOMATION_ERROR_CODES.RUN_ALREADY_RECORDED,
    `automation ${automationId} already has a run for ${scheduledFor}`,
  )
}
