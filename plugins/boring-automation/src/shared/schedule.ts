import { Cron } from "croner"
import type { Automation, AutomationRun } from "./types"

export const AUTOMATION_SCHEDULE_ERRORS = {
  INVALID_CRON: "Invalid cron schedule. Use exactly five fields, for example 0 9 * * *.",
  INVALID_TIMEZONE: "Invalid timezone. Use a valid IANA timezone, for example UTC or America/New_York.",
} as const

export type AutomationScheduleSkipReason =
  | "disabled"
  | "invalid-cron"
  | "invalid-timezone"
  | "not-current-minute"
  | "duplicate-scheduled-run"
  | "active-run"

export type AutomationScheduleDueReason = "current-minute-matched"

export interface AutomationScheduleValidationResult {
  ok: boolean
  errors: Partial<Record<"cron" | "timezone", string>>
}

export interface AutomationScheduleDueDecision {
  kind: "due"
  automation: Automation
  automationId: string
  scheduledFor: string
  reason: AutomationScheduleDueReason
}

export interface AutomationScheduleSkipDecision {
  kind: "skip"
  automation: Automation
  automationId: string
  scheduledFor: string | null
  reason: AutomationScheduleSkipReason
  message: string
}

export type AutomationScheduleDecision = AutomationScheduleDueDecision | AutomationScheduleSkipDecision

export interface EvaluateAutomationScheduleInput {
  automations: readonly Automation[]
  runs: readonly Pick<AutomationRun, "automationId" | "status" | "trigger" | "scheduledFor">[]
  now: Date
}

export interface EvaluateAutomationScheduleResult {
  decisions: AutomationScheduleDecision[]
  due: AutomationScheduleDueDecision[]
}

export function validateAutomationSchedule(cron: string, timezone: string): AutomationScheduleValidationResult {
  const errors: Partial<Record<"cron" | "timezone", string>> = {}
  if (!isValidFiveFieldCron(cron)) errors.cron = AUTOMATION_SCHEDULE_ERRORS.INVALID_CRON
  if (!isValidIanaTimeZone(timezone)) errors.timezone = AUTOMATION_SCHEDULE_ERRORS.INVALID_TIMEZONE
  return { ok: Object.keys(errors).length === 0, errors }
}

export function isValidFiveFieldCron(cron: string): boolean {
  const normalized = normalizeSpace(cron)
  if (!normalized || normalized.split(" ").length !== 5) return false
  try {
    new Cron(normalized)
    return true
  } catch {
    return false
  }
}

export function isValidIanaTimeZone(timezone: string): boolean {
  const normalized = timezone.trim()
  if (!normalized) return false
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: normalized }).resolvedOptions().timeZone
    return resolved === "UTC" || resolved.includes("/")
  } catch {
    return false
  }
}

export function evaluateAutomationSchedule(input: EvaluateAutomationScheduleInput): EvaluateAutomationScheduleResult {
  const now = new Date(input.now)
  const scheduledFor = floorToMinute(now).toISOString()
  const runs = [...input.runs]
  const decisions = input.automations.map((automation): AutomationScheduleDecision => {
    const validation = validateAutomationSchedule(automation.cron, automation.timezone)
    if (validation.errors.cron) return skip(automation, null, "invalid-cron", validation.errors.cron)
    if (validation.errors.timezone) return skip(automation, null, "invalid-timezone", validation.errors.timezone)
    if (!automation.enabled) return skip(automation, null, "disabled", "Automation is disabled.")

    const cron = new Cron(normalizeSpace(automation.cron), { timezone: automation.timezone.trim() })
    if (!cron.match(new Date(scheduledFor))) {
      return skip(automation, null, "not-current-minute", "Automation is not scheduled for the current minute.")
    }

    if (hasDuplicateScheduledRun(runs, automation.id, scheduledFor)) {
      return skip(automation, scheduledFor, "duplicate-scheduled-run", "A run already exists for this scheduled minute.")
    }
    if (hasActiveRun(runs, automation.id)) {
      return skip(automation, scheduledFor, "active-run", "Automation already has a queued or running run.")
    }

    return {
      kind: "due",
      automation,
      automationId: automation.id,
      scheduledFor,
      reason: "current-minute-matched",
    }
  }).sort(compareScheduleDecisions)

  return { decisions, due: decisions.filter((decision): decision is AutomationScheduleDueDecision => decision.kind === "due") }
}

function skip(
  automation: Automation,
  scheduledFor: string | null,
  reason: AutomationScheduleSkipReason,
  message: string,
): AutomationScheduleSkipDecision {
  return { kind: "skip", automation, automationId: automation.id, scheduledFor, reason, message }
}

function hasDuplicateScheduledRun(runs: EvaluateAutomationScheduleInput["runs"], automationId: string, scheduledFor: string): boolean {
  return runs.some((run) => run.automationId === automationId && run.trigger === "scheduled" && run.scheduledFor === scheduledFor)
}

function hasActiveRun(runs: EvaluateAutomationScheduleInput["runs"], automationId: string): boolean {
  return runs.some((run) => run.automationId === automationId && (run.status === "queued" || run.status === "running"))
}

function floorToMinute(date: Date): Date {
  const next = new Date(date)
  next.setUTCSeconds(0, 0)
  return next
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function compareScheduleDecisions(a: AutomationScheduleDecision, b: AutomationScheduleDecision): number {
  return compareNullableString(a.scheduledFor, b.scheduledFor) || a.automationId.localeCompare(b.automationId)
}

function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}
