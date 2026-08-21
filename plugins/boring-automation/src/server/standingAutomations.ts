import { z } from "zod"
import { isValidFiveFieldCron, isValidIanaTimeZone, MAX_AUTOMATION_RUN_DURATION_CAP_MS } from "../shared/schedule"
import type { Automation, AutomationSeed, AutomationStore } from "./store"

const SeedSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1),
  enabled: z.boolean(),
  cron: z.string().trim().nullable(),
  timezone: z.string().trim().min(1),
  model: z.string().trim().regex(/^[^:]+:.+$/),
  agentTypeId: z.string().trim().min(1),
  runDurationCapMs: z.number().int().positive().max(MAX_AUTOMATION_RUN_DURATION_CAP_MS).nullable().optional(),
  promptRef: z.string().regex(/^\.agents\/automation\/[a-zA-Z0-9_-]+\.md$/),
}).superRefine((seed, context) => {
  if (seed.cron !== null && !isValidFiveFieldCron(seed.cron)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["cron"], message: "invalid five-field cron" })
  }
  if (!isValidIanaTimeZone(seed.timezone)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: "invalid IANA timezone" })
  }
})

const ManifestSchema = z.object({ automations: z.array(SeedSchema) }).strict()

/** Provision a workspace-owned automation manifest without embedding factory policy in the plugin. */
export async function seedStandingAutomations(store: AutomationStore): Promise<Automation[]> {
  if (!store.readSeedManifest || !store.ensureSeededAutomation) return []
  const raw = await store.readSeedManifest()
  if (raw === null) return []
  const seeds = ManifestSchema.parse(JSON.parse(raw)).automations as AutomationSeed[]
  if (new Set(seeds.map(({ key }) => key)).size !== seeds.length) {
    throw new Error("automation seed manifest contains duplicate keys")
  }
  const seeded = await Promise.all(seeds.map(async (input) => await store.ensureSeededAutomation!(input)))
  return seeded.filter((automation): automation is Automation => automation !== null)
}
