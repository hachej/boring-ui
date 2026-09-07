import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

const DEFAULT_FACTORY_WORKER_CAP = 3
const MAX_FACTORY_WORKER_CAP = 1_000
const WORKER_SLOT_PREFIX = 'worker-slot-'
const DEFAULT_FACTORY_MODEL = 'openai-codex:gpt-5.6-sol'

export interface FactoryAutomationSeed {
  readonly key: string
  readonly title: string
  readonly enabled: true
  readonly cron: null
  readonly timezone: 'UTC'
  readonly model: string
  readonly agentTypeId: 'boring-worker'
  readonly promptRef: `.agents/automation/${string}.md`
  readonly promptBody: string
}

export interface FactoryAutomationSeedContext {
  readonly listExistingSeedKeys: (prefix: string) => Promise<readonly string[]>
  readonly removeSeededAutomationIfIdle: (key: string) => Promise<boolean>
  readonly warn: (message: string) => void
}

export type FactoryAutomationSeedProvider = (
  context: FactoryAutomationSeedContext,
) => Promise<readonly FactoryAutomationSeed[]>

export interface CreateFactoryAutomationSeedProviderOptions {
  /** Host root containing ratified factory policy, fleet, and prompt assets. */
  readonly policyRoot: string
  readonly env?: NodeJS.ProcessEnv
  readonly warn?: (message: string) => void
}

/** Host-owned factory policy composition. The automation plugin only receives generic, self-contained seeds. */
export function createFactoryAutomationSeedProvider(
  options: CreateFactoryAutomationSeedProviderOptions,
): FactoryAutomationSeedProvider {
  return async (context) => {
    const warn = options.warn ?? context.warn
    const workerCap = await readWorkerCap(options.policyRoot, warn)
    const model = await resolveWorkerModel(options.policyRoot, options.env ?? process.env, warn)
    const [workerPrompt, triagePrompt] = await Promise.all([
      readFile(join(options.policyRoot, '.agents', 'automation', 'worker-slot.md'), 'utf8'),
      readFile(join(options.policyRoot, '.agents', 'automation', 'triage-slot.md'), 'utf8'),
    ])
    await pruneSurplusWorkerSlots(context, workerCap, warn)
    return createFactoryAutomationSeeds(workerCap, { model, workerPrompt, triagePrompt })
  }
}

export function createFactoryAutomationSeeds(
  workerCap: number,
  options: { model?: string; workerPrompt?: string; triagePrompt?: string } = {},
): readonly FactoryAutomationSeed[] {
  if (!Number.isSafeInteger(workerCap) || workerCap < 1 || workerCap > MAX_FACTORY_WORKER_CAP) {
    throw new TypeError(`factory worker_cap must be an integer from 1 to ${MAX_FACTORY_WORKER_CAP}`)
  }
  const model = options.model ?? DEFAULT_FACTORY_MODEL
  return Object.freeze([
    ...Array.from({ length: workerCap }, (_, offset) => workerSeed(offset + 1, model, options.workerPrompt ?? '')),
    Object.freeze({
      key: 'triage',
      title: 'triage',
      enabled: true as const,
      cron: null,
      timezone: 'UTC' as const,
      model,
      agentTypeId: 'boring-worker' as const,
      promptRef: '.agents/automation/triage.md' as const,
      promptBody: options.triagePrompt ?? '',
    }),
  ])
}

async function readWorkerCap(workspaceRoot: string, warn: (message: string) => void): Promise<number> {
  const policyPath = join(workspaceRoot, '.agents', 'factory', 'policy.yaml')
  try {
    const policy = parse(await readFile(policyPath, 'utf8')) as unknown
    const workerCap = policy && typeof policy === 'object' ? (policy as { beadle?: unknown }).beadle : undefined
    const value = workerCap && typeof workerCap === 'object' ? (workerCap as { worker_cap?: unknown }).worker_cap : undefined
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_FACTORY_WORKER_CAP) {
      throw new TypeError(`beadle.worker_cap must be an integer from 1 to ${MAX_FACTORY_WORKER_CAP}`)
    }
    return value as number
  } catch (error) {
    warn(`[boring-automation] invalid or missing .agents/factory/policy.yaml; using worker_cap ${DEFAULT_FACTORY_WORKER_CAP}: ${error instanceof Error ? error.message : String(error)}`)
    return DEFAULT_FACTORY_WORKER_CAP
  }
}

async function resolveWorkerModel(root: string, env: NodeJS.ProcessEnv, warn: (message: string) => void): Promise<string> {
  try {
    const [policyRaw, fleetRaw] = await Promise.all([
      readFile(join(root, '.agents', 'factory', 'policy.yaml'), 'utf8'),
      readFile(join(root, '.agents', 'factory', 'fleet.yaml'), 'utf8'),
    ])
    const policy = parse(policyRaw) as { models?: { seats?: { worker?: string } } }
    const fleet = parse(fleetRaw) as { models?: { tiers?: Record<string, Array<{ provider?: string; id?: string; envVar?: string }>> } }
    const tier = policy.models?.seats?.worker
    const candidates = tier ? fleet.models?.tiers?.[tier] ?? [] : []
    const available = candidates.find((candidate) => candidate.provider && candidate.id && (!candidate.envVar || env[candidate.envVar]))
    if (available?.provider && available.id) return `${available.provider}:${available.id}`
    const configured = candidates.find((candidate) => candidate.provider && candidate.id)
    if (configured?.provider && configured.id) return `${configured.provider}:${configured.id}`
    throw new Error('worker model tier has no configured candidates')
  } catch (error) {
    warn(`[boring-automation] could not resolve worker model from factory fleet; using ${DEFAULT_FACTORY_MODEL}: ${error instanceof Error ? error.message : String(error)}`)
    return DEFAULT_FACTORY_MODEL
  }
}

async function pruneSurplusWorkerSlots(
  context: FactoryAutomationSeedContext,
  workerCap: number,
  warn: (message: string) => void,
): Promise<void> {
  const surplus = (await context.listExistingSeedKeys(WORKER_SLOT_PREFIX))
    .map((key) => ({ key, index: workerSlotIndex(key) }))
    .filter((entry): entry is { key: string; index: number } => entry.index !== null && entry.index > workerCap)
    .sort((left, right) => left.index - right.index)
  for (const { key } of surplus) {
    if (!await context.removeSeededAutomationIfIdle(key)) {
      warn(`[boring-automation] retaining ${key} after worker_cap decrease because it has an active run`)
    }
  }
}

function workerSeed(index: number, model: string, promptBody: string): FactoryAutomationSeed {
  const key = `${WORKER_SLOT_PREFIX}${index}`
  return Object.freeze({
    key,
    title: key,
    enabled: true,
    cron: null,
    timezone: 'UTC',
    model,
    agentTypeId: 'boring-worker',
    promptRef: `.agents/automation/${key}.md`,
    promptBody,
  })
}

function workerSlotIndex(id: string): number | null {
  const match = /^worker-slot-([1-9][0-9]*)$/.exec(id)
  if (!match) return null
  const index = Number(match[1])
  return Number.isSafeInteger(index) ? index : null
}
