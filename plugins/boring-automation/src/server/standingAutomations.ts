import { z } from "zod"
import { isValidFiveFieldCron, isValidIanaTimeZone, MAX_AUTOMATION_RUN_DURATION_CAP_MS } from "../shared/schedule"
import type { Automation, AutomationSeed, AutomationStore } from "./store"

export const AutomationSeedSchema = z.object({
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

const ManifestSchema = z.object({ automations: z.array(AutomationSeedSchema) }).strict()
const AdditionalSeedsSchema = z.array(AutomationSeedSchema)

export interface AutomationSeedProviderContext {
  readonly findExistingSeedKeys: (keys: readonly string[]) => Promise<readonly string[] | "unsupported">
  readonly removeSeededAutomationIfIdle: (key: string) => Promise<"removed" | "active" | "unsupported">
  readonly warn: (message: string) => void
}

export type AutomationSeedProvider = (
  context: AutomationSeedProviderContext,
) => Promise<unknown> | unknown

export interface SeedStandingAutomationsOptions {
  readonly additionalSeeds?: readonly unknown[]
  readonly seedProvider?: AutomationSeedProvider
  readonly warn?: (message: string) => void
}

/** Provision workspace-owned and host-injected automation seeds without embedding host policy in the plugin. */
export async function seedStandingAutomations(
  store: AutomationStore,
  options: SeedStandingAutomationsOptions = {},
): Promise<Automation[]> {
  if (!store.ensureSeededAutomation) return []
  const warn = options.warn ?? (() => undefined)
  const manifestSeeds = await readManifestSeeds(store)
  const provided = options.seedProvider
    ? await options.seedProvider({
        findExistingSeedKeys: async (keys) => store.findExistingSeedKeys
          ? await store.findExistingSeedKeys(keys)
          : "unsupported",
        removeSeededAutomationIfIdle: async (key) => store.removeSeededAutomationIfIdle
          ? await store.removeSeededAutomationIfIdle(key) ? "removed" : "active"
          : "unsupported",
        warn,
      })
    : options.additionalSeeds ?? []
  const additionalSeeds = AdditionalSeedsSchema.parse(provided) as AutomationSeed[]
  const seeds = [...manifestSeeds, ...additionalSeeds]
  if (new Set(seeds.map(({ key }) => key)).size !== seeds.length) {
    throw new Error("automation seeds contain duplicate keys")
  }
  const seeded = await Promise.all(seeds.map(async (input) => await store.ensureSeededAutomation!(input)))
  return seeded.filter((automation): automation is Automation => automation !== null)
}

async function readManifestSeeds(store: AutomationStore): Promise<AutomationSeed[]> {
  if (!store.readSeedManifest) return []
  const raw = await store.readSeedManifest()
  if (raw === null) return []
  return ManifestSchema.parse(JSON.parse(raw)).automations as AutomationSeed[]
}
