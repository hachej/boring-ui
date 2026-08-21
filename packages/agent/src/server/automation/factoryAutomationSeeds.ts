import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'

const DEFAULT_FACTORY_WORKER_CAP = 3
const MAX_FACTORY_WORKER_CAP = 1_000
const WORKER_SLOT_PREFIX = 'worker-slot-'

export interface FactoryAutomationSeed {
  readonly key: string
  readonly title: string
  readonly enabled: true
  readonly cron: null
  readonly timezone: 'UTC'
  readonly model: 'openai-codex:gpt-5.6-sol'
  readonly agentTypeId: 'boring-worker'
  readonly promptRef: '.agents/automation/worker-slot.md' | '.agents/automation/triage-slot.md'
}

export interface FactoryAutomationSeedContext {
  readonly findExistingSeedKeys: (keys: readonly string[]) => Promise<readonly string[] | 'unsupported'>
  readonly removeSeededAutomationIfIdle: (key: string) => Promise<'removed' | 'active' | 'unsupported'>
  readonly warn: (message: string) => void
}

export type FactoryAutomationSeedProvider = (
  context: FactoryAutomationSeedContext,
) => Promise<readonly FactoryAutomationSeed[]>

export interface CreateFactoryAutomationSeedProviderOptions {
  /** Host root containing .agents/factory/policy.yaml; independent of runtime workspace storage. */
  readonly policyRoot: string
  readonly warn?: (message: string) => void
}

/** Host-owned factory policy composition. The automation plugin only receives the resulting generic seeds. */
export function createFactoryAutomationSeedProvider(
  options: CreateFactoryAutomationSeedProviderOptions,
): FactoryAutomationSeedProvider {
  return async (context) => {
    const warn = options.warn ?? context.warn
    const workerCap = await readWorkerCap(options.policyRoot, warn)
    await pruneSurplusWorkerSlots(context, workerCap, warn)
    return createFactoryAutomationSeeds(workerCap)
  }
}

export function createFactoryAutomationSeeds(workerCap: number): readonly FactoryAutomationSeed[] {
  if (!Number.isSafeInteger(workerCap) || workerCap < 1 || workerCap > MAX_FACTORY_WORKER_CAP) {
    throw new TypeError(`factory worker_cap must be an integer from 1 to ${MAX_FACTORY_WORKER_CAP}`)
  }
  return Object.freeze([
    ...Array.from({ length: workerCap }, (_, offset) => workerSeed(offset + 1)),
    Object.freeze({
      key: 'triage',
      title: 'triage',
      enabled: true as const,
      cron: null,
      timezone: 'UTC' as const,
      model: 'openai-codex:gpt-5.6-sol' as const,
      agentTypeId: 'boring-worker' as const,
      promptRef: '.agents/automation/triage-slot.md' as const,
    }),
  ])
}

async function readWorkerCap(workspaceRoot: string, warn: (message: string) => void): Promise<number> {
  const policyPath = join(workspaceRoot, '.agents', 'factory', 'policy.yaml')
  try {
    const policy = parse(await readFile(policyPath, 'utf8')) as unknown
    const workerCap = policy && typeof policy === 'object'
      ? (policy as { beadle?: unknown }).beadle
      : undefined
    const value = workerCap && typeof workerCap === 'object'
      ? (workerCap as { worker_cap?: unknown }).worker_cap
      : undefined
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_FACTORY_WORKER_CAP) {
      throw new TypeError(`beadle.worker_cap must be an integer from 1 to ${MAX_FACTORY_WORKER_CAP}`)
    }
    return value as number
  } catch (error) {
    warn(`[boring-automation] invalid or missing .agents/factory/policy.yaml; using worker_cap ${DEFAULT_FACTORY_WORKER_CAP}: ${error instanceof Error ? error.message : String(error)}`)
    return DEFAULT_FACTORY_WORKER_CAP
  }
}

async function pruneSurplusWorkerSlots(
  context: FactoryAutomationSeedContext,
  workerCap: number,
  warn: (message: string) => void,
): Promise<void> {
  const candidateKeys = Array.from(
    { length: MAX_FACTORY_WORKER_CAP - workerCap },
    (_, offset) => `${WORKER_SLOT_PREFIX}${workerCap + offset + 1}`,
  )
  const existingKeys = await context.findExistingSeedKeys(candidateKeys)
  if (existingKeys === 'unsupported') {
    warn('[boring-automation] retaining surplus worker slots because the store cannot resolve immutable seed keys')
    return
  }
  const surplus = existingKeys
    .map((key) => ({ key, index: workerSlotIndex(key) }))
    .filter((entry): entry is { key: string; index: number } => entry.index !== null && entry.index > workerCap)
    .sort((left, right) => left.index - right.index)
  for (const { key } of surplus) {
    const result = await context.removeSeededAutomationIfIdle(key)
    if (result === 'active') {
      warn(`[boring-automation] retaining ${key} after worker_cap decrease because it has an active run`)
    } else if (result === 'unsupported') {
      warn(`[boring-automation] retaining ${key} after worker_cap decrease because the store cannot remove seeded automations atomically`)
    }
  }
}

function workerSeed(index: number): FactoryAutomationSeed {
  const key = `${WORKER_SLOT_PREFIX}${index}`
  return Object.freeze({
    key,
    title: key,
    enabled: true,
    cron: null,
    timezone: 'UTC',
    model: 'openai-codex:gpt-5.6-sol',
    agentTypeId: 'boring-worker',
    promptRef: '.agents/automation/worker-slot.md',
  })
}

function workerSlotIndex(id: string): number | null {
  const match = /^worker-slot-([1-9][0-9]*)$/.exec(id)
  if (!match) return null
  const index = Number(match[1])
  return Number.isSafeInteger(index) ? index : null
}
