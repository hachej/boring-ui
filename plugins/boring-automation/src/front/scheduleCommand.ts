import type { ModelSelection, SlashCommand, SlashCommandContext } from "@hachej/boring-agent/front"
import {
  SCHEDULE_COMMAND_USAGE,
  nextScheduleFire,
  parseScheduleCommandArgs,
  type Automation,
  type AutomationCreate,
} from "../shared"
import type { AutomationClient } from "./client"

export function createScheduleSlashCommand(options: {
  client: AutomationClient
  workspaceTimezone: string
  validateModel: (input: { agentTypeId: string; provider: string; id: string }) => Promise<void>
  now?: () => Date
}): SlashCommand {
  return {
    name: "schedule",
    description: "Create a scheduled automation",
    source: "extension",
    sourcePlugin: "boring-automation",
    handler: async (args, context) => {
      try {
        if (!args.trim()) return await usageWithAutomations(options.client)
        const parsed = parseScheduleCommandArgs(args)
        const timezone = parsed.timezone ?? options.workspaceTimezone
        const model = parsed.model ?? modelId(context.model)
        const agentTypeId = parsed.agentTypeId ?? context.agentTypeId
        if (!model) throw new Error("no current model is selected — pass --model provider:model-id")
        const parsedModel = parseExplicitModel(model)
        if (!parsedModel) throw new Error("model must use provider:model-id syntax")
        if (!agentTypeId.trim()) throw new Error("no current Agent is selected — pass --agent <agentTypeId>")
        await options.validateModel({ agentTypeId, ...parsedModel })
        const input: AutomationCreate = {
          title: parsed.title?.trim() || defaultTitle(parsed.prompt),
          enabled: true,
          cron: parsed.cron,
          timezone,
          model,
          agentTypeId,
          thinkingLevel: "medium",
          prompt: parsed.prompt,
        }
        const automation = await options.client.createAutomation(input)
        const nextFire = nextScheduleFire(automation.cron!, automation.timezone, options.now?.() ?? new Date())
        return [
          `Created automation “${automation.title}”.`,
          `Schedule: ${automation.cron} (${automation.timezone})`,
          `Next fire: ${nextFire}`,
          `Agent/model: ${automation.agentTypeId ?? agentTypeId} · ${automation.model}`,
          `Disable it from Automations by pausing “${automation.title}” (id ${automation.id}).`,
        ].join("\n")
      } catch (error) {
        return {
          message: `/schedule failed: ${errorMessage(error)}`,
          tone: "error",
          preserveDraft: true,
        }
      }
    },
  }
}

async function usageWithAutomations(client: AutomationClient) {
  try {
    const automations = await client.listAutomations()
    const rows = automations.length === 0
      ? ["Existing automations: none."]
      : ["Existing automations:", ...automations.map(formatAutomation)]
    return `${SCHEDULE_COMMAND_USAGE}\n\n${rows.join("\n")}`
  } catch (error) {
    return {
      message: `/schedule could not list automations: ${errorMessage(error)}\n\n${SCHEDULE_COMMAND_USAGE}`,
      tone: "error" as const,
    }
  }
}

function formatAutomation(automation: Automation): string {
  return `- ${automation.title} — ${automation.enabled ? "enabled" : "disabled"} — ${automation.cron ?? "dispatch-only"} (${automation.timezone})`
}

function modelId(model: ModelSelection | null): string | undefined {
  return model ? `${model.provider}:${model.id}` : undefined
}

function parseExplicitModel(value: string): { provider: string; id: string } | null {
  const separator = value.indexOf(":")
  if (separator <= 0 || separator >= value.length - 1) return null
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) }
}

function defaultTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim() || "Scheduled automation"
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || "unknown error"
  return firstLine.slice(0, 300)
}

export type { SlashCommandContext }
