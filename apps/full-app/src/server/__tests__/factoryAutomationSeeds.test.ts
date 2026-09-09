import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFactoryAutomationSeedProvider, createFactoryAutomationSeeds } from '../factoryAutomationSeeds.js'

async function workspace(policy?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'factory-automation-seeds-'))
  await mkdir(join(root, '.agents', 'factory'), { recursive: true })
  await mkdir(join(root, '.agents', 'automation'), { recursive: true })
  await writeFile(join(root, '.agents', 'factory', 'policy.yaml'), policy ?? 'models:\n  seats:\n    worker: T3\n    orchestrator: T1\n    triage: T3\n')
  await writeFile(join(root, '.agents', 'factory', 'fleet.yaml'), 'models:\n  tiers:\n    T1:\n      - provider: google\n        id: gemini-pro\n    T3:\n      - provider: anthropic\n        id: claude-sonnet\n')
  await writeFile(join(root, '.agents', 'automation', 'worker-slot.md'), 'worker prompt')
  await writeFile(join(root, '.agents', 'automation', 'triage-slot.md'), 'triage prompt')
  await writeFile(join(root, '.agents', 'automation', 'orchestrator-tick.md'), 'orchestrator prompt')
  return root
}

function context(
  existingSeedKeys: string[] = [],
  remove: (key: string) => Promise<boolean> = async () => true,
) {
  return {
    listExistingSeedKeys: vi.fn(async (prefix: string) => existingSeedKeys.filter((key) => key.startsWith(prefix))),
    removeSeededAutomationIfIdle: remove,
    warn: vi.fn(),
  }
}

describe('factory automation seed host composition', () => {
  it('derives worker slots with isolated prompt refs plus triage', async () => {
    expect(createFactoryAutomationSeeds(3).map(({ key }) => key)).toEqual([
      'orchestrator-tick', 'worker-slot-1', 'worker-slot-2', 'worker-slot-3', 'triage',
    ])
    expect(new Set(createFactoryAutomationSeeds(3).map(({ promptRef }) => promptRef)).size).toBe(5)
    expect(createFactoryAutomationSeeds(3).every(({ modelManagedByHost }) => modelManagedByHost)).toBe(true)
    const provider = createFactoryAutomationSeedProvider({
      policyRoot: await workspace('beadle:\n  worker_cap: 5\nmodels:\n  seats:\n    worker: T3\n    orchestrator: T1\n    triage: T3\n'),
      env: { ANTHROPIC_API_KEY: 'test', GEMINI_API_KEY: 'test' },
    })
    const seeds = await provider(context())
    expect(seeds).toHaveLength(7)
    expect(seeds[0]).toMatchObject({ key: 'orchestrator-tick', promptBody: 'orchestrator prompt' })
    expect(seeds[1]).toMatchObject({ model: 'anthropic:claude-sonnet', promptBody: 'worker prompt' })
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'beadle:\n  worker_cap: nope\nmodels:\n  seats:\n    worker: T3\n    orchestrator: T1\n    triage: T3\n'],
  ])('falls back to 3 with a warning for %s policy', async (_label, policy) => {
    const warn = vi.fn()
    const provider = createFactoryAutomationSeedProvider({ policyRoot: await workspace(policy), warn })
    expect((await provider(context())).map(({ key }) => key)).toEqual([
      'orchestrator-tick', 'worker-slot-1', 'worker-slot-2', 'worker-slot-3', 'triage',
    ])
    expect(warn).toHaveBeenCalled()
  })

  it('prunes only the existing surplus prefix rows and retains active slots', async () => {
    const warn = vi.fn()
    const remove = vi.fn(async (key: string) => key !== 'worker-slot-4')
    const provider = createFactoryAutomationSeedProvider({
      policyRoot: await workspace('beadle:\n  worker_cap: 3\nmodels:\n  seats:\n    worker: T3\n    orchestrator: T1\n    triage: T3\n'),
      warn,
    })
    const seedContext = context(['worker-slot-1', 'worker-slot-4', 'worker-slot-999'], remove)

    await provider(seedContext)

    expect(seedContext.listExistingSeedKeys).toHaveBeenCalledExactlyOnceWith('worker-slot-')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('worker-slot-4')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('active run'))
  })
})
