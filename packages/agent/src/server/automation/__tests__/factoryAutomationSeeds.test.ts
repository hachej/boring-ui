import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFactoryAutomationSeedProvider, createFactoryAutomationSeeds } from '../factoryAutomationSeeds'

async function workspace(policy?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'factory-automation-seeds-'))
  if (policy !== undefined) {
    await mkdir(join(root, '.agents', 'factory'), { recursive: true })
    await writeFile(join(root, '.agents', 'factory', 'policy.yaml'), policy)
  }
  return root
}

function context(
  existingSeedKeys: string[] = [],
  remove: (key: string) => Promise<boolean> = async () => true,
) {
  return {
    findExistingSeedKeys: vi.fn(async (keys: readonly string[]) => keys.filter((key) => existingSeedKeys.includes(key))),
    removeSeededAutomationIfIdle: remove,
    warn: vi.fn(),
  }
}

describe('factory automation seed host composition', () => {
  it('derives worker slots from worker_cap 3 and 5 plus triage', async () => {
    expect(createFactoryAutomationSeeds(3).map(({ key }) => key)).toEqual([
      'worker-slot-1', 'worker-slot-2', 'worker-slot-3', 'triage',
    ])
    expect(createFactoryAutomationSeeds(5).map(({ key }) => key)).toEqual([
      'worker-slot-1', 'worker-slot-2', 'worker-slot-3', 'worker-slot-4', 'worker-slot-5', 'triage',
    ])
    const provider = createFactoryAutomationSeedProvider({ policyRoot: await workspace('beadle:\n  worker_cap: 5\n') })
    expect((await provider(context())).map(({ key }) => key)).toHaveLength(6)
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'beadle:\n  worker_cap: nope\n'],
  ])('falls back to 3 with a warning for %s policy', async (_label, policy) => {
    const warn = vi.fn()
    const provider = createFactoryAutomationSeedProvider({ policyRoot: await workspace(policy), warn })
    expect((await provider(context())).map(({ key }) => key)).toEqual([
      'worker-slot-1', 'worker-slot-2', 'worker-slot-3', 'triage',
    ])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('retains and warns for an active surplus slot when worker_cap decreases', async () => {
    const warn = vi.fn()
    const remove = vi.fn(async () => false)
    const provider = createFactoryAutomationSeedProvider({
      policyRoot: await workspace('beadle:\n  worker_cap: 3\n'),
      warn,
    })
    await provider(context(['worker-slot-1', 'worker-slot-4'], remove))
    expect(remove).toHaveBeenCalledWith('worker-slot-4')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('active run'))
  })

  it('prunes by immutable seed key rather than mutable title or automation id', async () => {
    const remove = vi.fn(async () => true)
    const provider = createFactoryAutomationSeedProvider({
      policyRoot: await workspace('beadle:\n  worker_cap: 3\n'),
    })
    const seedContext = context(['worker-slot-4'], remove)

    await provider(seedContext)

    expect(seedContext.findExistingSeedKeys).toHaveBeenCalledWith(expect.arrayContaining(['worker-slot-4']))
    expect(remove).toHaveBeenCalledExactlyOnceWith('worker-slot-4')
  })
})
