import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Automation, AutomationRun } from "../types"
import { evaluateAutomationSchedule, validateAutomationSchedule } from "../schedule"

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    title: "Daily",
    enabled: true,
    cron: "0 9 * * *",
    timezone: "UTC",
    model: "test:gpt-5.5",
    promptRef: "prompts/auto-1.md",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    sessionId: null,
    status: "succeeded",
    trigger: "scheduled",
    scheduledFor: "2026-01-01T09:00:00.000Z",
    startedAt: null,
    completedAt: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    promptSnapshot: "prompt",
    modelSnapshot: "test:gpt-5.5",
    error: null,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  }
}

function evaluateAt(nowIso: string, automations: Automation[], runs: AutomationRun[] = []) {
  vi.setSystemTime(new Date(nowIso))
  return evaluateAutomationSchedule({ automations, runs, now: new Date() })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("automation schedule validation", () => {
  it("accepts exactly five-field cron and valid IANA timezones", () => {
    expect(validateAutomationSchedule("0 9 * * *", "UTC")).toEqual({ ok: true, errors: {} })
    expect(validateAutomationSchedule("*/15 9-17 * * MON-FRI", "America/New_York")).toEqual({ ok: true, errors: {} })
  })

  it("rejects non-five-field cron and invalid timezones with shared stable messages", () => {
    expect(validateAutomationSchedule("0 0 9 * * *", "UTC")).toMatchObject({
      ok: false,
      errors: { cron: "Invalid cron schedule. Use exactly five fields, for example 0 9 * * *." },
    })
    expect(validateAutomationSchedule("0 9 * * *", "Mars/Base")).toMatchObject({
      ok: false,
      errors: { timezone: "Invalid timezone. Use a valid IANA timezone, for example UTC or America/New_York." },
    })
  })
})

describe("evaluateAutomationSchedule", () => {
  it("marks only the current matching minute as due with no older backfill", () => {
    const due = evaluateAt("2026-01-01T09:00:59.999Z", [automation()])
    expect(due.due).toEqual([expect.objectContaining({ automationId: "auto-1", scheduledFor: "2026-01-01T09:00:00.000Z", reason: "current-minute-matched" })])

    const missed = evaluateAt("2026-01-01T09:01:00.000Z", [automation()])
    expect(missed.due).toEqual([])
    expect(missed.decisions).toEqual([expect.objectContaining({ kind: "skip", reason: "not-current-minute" })])
  })

  it("skips disabled automations, duplicates for the scheduled instant, and active queued or running runs", () => {
    const now = "2026-01-01T09:00:15.000Z"
    expect(evaluateAt(now, [automation({ enabled: false })]).decisions).toEqual([
      expect.objectContaining({ kind: "skip", reason: "disabled", scheduledFor: null }),
    ])

    expect(evaluateAt(now, [automation()], [run({ scheduledFor: "2026-01-01T09:00:00.000Z" })]).decisions).toEqual([
      expect.objectContaining({ kind: "skip", reason: "duplicate-scheduled-run", scheduledFor: "2026-01-01T09:00:00.000Z" }),
    ])

    expect(evaluateAt(now, [automation()], [run({ trigger: "manual", scheduledFor: null, status: "running" })]).decisions).toEqual([
      expect.objectContaining({ kind: "skip", reason: "active-run", scheduledFor: "2026-01-01T09:00:00.000Z" }),
    ])
  })

  it("skips spring DST nonexistent local minutes", () => {
    const beforeGap = evaluateAt("2026-03-08T06:30:00.000Z", [automation({ cron: "30 2 * * *", timezone: "America/New_York" })])
    const afterGap = evaluateAt("2026-03-08T07:30:00.000Z", [automation({ cron: "30 2 * * *", timezone: "America/New_York" })])

    expect(beforeGap.due).toEqual([])
    expect(afterGap.due).toEqual([])
    expect(beforeGap.decisions[0]).toMatchObject({ reason: "not-current-minute" })
    expect(afterGap.decisions[0]).toMatchObject({ reason: "not-current-minute" })
  })

  it("allows each fall DST repeated UTC instant to run once", () => {
    const repeated = automation({ cron: "30 1 * * *", timezone: "America/New_York" })
    const first = evaluateAt("2026-11-01T05:30:10.000Z", [repeated])
    const second = evaluateAt("2026-11-01T06:30:10.000Z", [repeated], [run({ scheduledFor: "2026-11-01T05:30:00.000Z" })])
    const duplicateSecond = evaluateAt("2026-11-01T06:30:20.000Z", [repeated], [run({ scheduledFor: "2026-11-01T06:30:00.000Z" })])

    expect(first.due).toEqual([expect.objectContaining({ scheduledFor: "2026-11-01T05:30:00.000Z" })])
    expect(second.due).toEqual([expect.objectContaining({ scheduledFor: "2026-11-01T06:30:00.000Z" })])
    expect(duplicateSecond.decisions).toEqual([expect.objectContaining({ reason: "duplicate-scheduled-run", scheduledFor: "2026-11-01T06:30:00.000Z" })])
  })

  it("sorts decisions deterministically by scheduled instant then automation id", () => {
    const result = evaluateAt("2026-01-01T09:00:00.000Z", [
      automation({ id: "b" }),
      automation({ id: "disabled", enabled: false }),
      automation({ id: "a" }),
    ])

    expect(result.decisions.map((decision) => decision.automationId)).toEqual(["a", "b", "disabled"])
    expect(result.due.map((decision) => decision.automationId)).toEqual(["a", "b"])
  })
})
