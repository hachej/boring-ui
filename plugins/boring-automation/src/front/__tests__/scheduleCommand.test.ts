import { describe, expect, it, vi } from "vitest"
import type { SlashCommandContext } from "@hachej/boring-agent/front"
import type { Automation } from "../../shared"
import type { AutomationClient } from "../client"
import { createScheduleSlashCommand } from "../scheduleCommand"

const context: SlashCommandContext = {
  sessionId: "session-1",
  agentTypeId: "worker",
  model: { provider: "openai", id: "gpt-5" },
  clearMessages: vi.fn(),
  resetSession: vi.fn(),
  listCommands: vi.fn(() => []),
  reloadAgentPlugins: vi.fn(async () => "reloaded"),
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "automation-1",
    title: "send the digest",
    enabled: true,
    cron: "0 8 * * *",
    timezone: "Europe/Zurich",
    model: "openai:gpt-5",
    agentTypeId: "worker",
    promptRef: ".agents/automation/prompts/automation-1.md",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  }
}

function client(overrides: Partial<AutomationClient> = {}): AutomationClient {
  return {
    listAutomations: vi.fn(async () => []),
    createAutomation: vi.fn(async (input) => automation(input)),
    ...overrides,
  } as AutomationClient
}

describe("/schedule slash command", () => {
  it("creates through the canonical client with current seat/model defaults and reports the next fire", async () => {
    const api = client()
    const command = createScheduleSlashCommand({
      client: api,
      workspaceTimezone: "Europe/Zurich",
      now: () => new Date("2026-08-21T07:00:00.000Z"),
    })

    const result = await command.handler("daily 8am send the digest", context)

    expect(api.createAutomation).toHaveBeenCalledWith({
      title: "send the digest",
      enabled: true,
      cron: "0 8 * * *",
      timezone: "Europe/Zurich",
      model: "openai:gpt-5",
      agentTypeId: "worker",
      prompt: "send the digest",
    })
    expect(result).toContain("Created automation “send the digest”")
    expect(result).toContain("Next fire:")
    expect(result).toContain("Disable it from Automations")
  })

  it("applies explicit agent, model, timezone, and title flags", async () => {
    const api = client()
    const command = createScheduleSlashCommand({ client: api, workspaceTimezone: "UTC" })

    await command.handler("weekdays 9:00 report --agent orchestrator --model anthropic:claude --timezone America/New_York --title 'Weekday report'", context)

    expect(api.createAutomation).toHaveBeenCalledWith(expect.objectContaining({
      title: "Weekday report",
      cron: "0 9 * * 1-5",
      timezone: "America/New_York",
      model: "anthropic:claude",
      agentTypeId: "orchestrator",
    }))
  })

  it("shows usage plus existing automations when invoked without arguments", async () => {
    const api = client({ listAutomations: vi.fn(async () => [automation()]) })
    const command = createScheduleSlashCommand({ client: api, workspaceTimezone: "UTC" })

    const result = await command.handler("", context)

    expect(result).toContain("Usage: /schedule")
    expect(result).toContain("send the digest — enabled — 0 8 * * *")
  })

  it.each([
    ["daily nope run", "could not parse cadence"],
    ["daily 8am run --model implicit-model", "provider:model-id"],
  ])("surfaces validation failures as chat errors for %s", async (args, message) => {
    const command = createScheduleSlashCommand({ client: client(), workspaceTimezone: "UTC" })

    await expect(command.handler(args, context)).resolves.toMatchObject({ tone: "error", message: expect.stringContaining(message) })
  })

  it("surfaces permission failures as chat errors without throwing", async () => {
    const api = client({ createAutomation: vi.fn(async () => { throw new Error("automation creator is not authorized") }) })
    const command = createScheduleSlashCommand({ client: api, workspaceTimezone: "UTC" })

    await expect(command.handler("daily 8am run report", context)).resolves.toEqual({
      message: "/schedule failed: automation creator is not authorized",
      tone: "error",
      preserveDraft: true,
    })
  })
})
