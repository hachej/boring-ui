import type { Automation, AutomationSeed } from "./store"
import type { AutomationStore } from "./store"

const STANDING_AUTOMATIONS: readonly AutomationSeed[] = [
  {
    key: "orchestrator-tick",
    title: "orchestrator-tick",
    enabled: true,
    cron: "*/10 * * * *",
    timezone: "UTC",
    model: "openai-codex:gpt-5.6-sol",
    agentTypeId: "boring-orchestrator",
    sessionMode: "new",
    promptRef: ".agents/automation/orchestrator-tick.md",
  },
  ...[1, 2, 3].map((slot): AutomationSeed => ({
    key: `worker-slot-${slot}`,
    title: `worker-slot-${slot}`,
    enabled: true,
    cron: null,
    timezone: "UTC",
    model: "openai-codex:gpt-5.6-sol",
    agentTypeId: "boring-worker",
    sessionMode: "new",
    promptRef: ".agents/automation/worker-slot.md",
  })),
  {
    key: "triage",
    title: "triage",
    enabled: true,
    cron: null,
    timezone: "UTC",
    model: "openai-codex:gpt-5.6-sol",
    agentTypeId: "boring-worker",
    sessionMode: "new",
    promptRef: ".agents/automation/triage-slot.md",
  },
]

/** Seed only when this workspace carries the checked-in factory prompts. */
export async function seedStandingAutomations(store: AutomationStore): Promise<Automation[]> {
  if (!store.ensureSeededAutomation) return []
  const seeded = await Promise.all(STANDING_AUTOMATIONS.map(async (input) => await store.ensureSeededAutomation!(input)))
  return seeded.filter((automation): automation is Automation => automation !== null)
}

export { STANDING_AUTOMATIONS }
