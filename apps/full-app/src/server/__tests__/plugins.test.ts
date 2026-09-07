import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createFullAppAutomationPluginEntry,
  resolveFullAppFactoryPolicyRoot,
} from '../plugins.js'

describe('full-app factory automation composition', () => {
  it('uses an explicit deployable policy root and derives worker_cap 5', async () => {
    const policyRoot = await mkdtemp(join(tmpdir(), 'full-app-factory-policy-'))
    await mkdir(join(policyRoot, '.agents', 'factory'), { recursive: true })
    await mkdir(join(policyRoot, '.agents', 'automation'), { recursive: true })
    await writeFile(join(policyRoot, '.agents', 'factory', 'policy.yaml'), 'beadle:\n  worker_cap: 5\nmodels:\n  seats:\n    worker: T3\n')
    await writeFile(join(policyRoot, '.agents', 'factory', 'fleet.yaml'), 'models:\n  tiers:\n    T3:\n      - provider: google\n        id: gemini-worker\n        envVar: GEMINI_API_KEY\n')
    await writeFile(join(policyRoot, '.agents', 'automation', 'worker-slot.md'), 'worker prompt')
    await writeFile(join(policyRoot, '.agents', 'automation', 'triage-slot.md'), 'triage prompt')

    const entry = createFullAppAutomationPluginEntry(policyRoot)
    if (!('options' in entry)) throw new TypeError('expected package plugin entry')
    const provider = (entry.options as {
      seedProvider: (context: {
        listExistingSeedKeys: (prefix: string) => Promise<readonly string[]>
        removeSeededAutomationIfIdle: (key: string) => Promise<boolean>
        warn: (message: string) => void
      }) => Promise<readonly { key: string; promptRef: string; promptBody: string }[]>
    }).seedProvider
    const seeds = await provider({
      listExistingSeedKeys: async () => [],
      removeSeededAutomationIfIdle: async () => true,
      warn: vi.fn(),
    })

    expect(seeds.map(({ key }) => key)).toEqual([
      'worker-slot-1',
      'worker-slot-2',
      'worker-slot-3',
      'worker-slot-4',
      'worker-slot-5',
      'triage',
    ])
    expect(new Set(seeds.map(({ promptRef }) => promptRef)).size).toBe(seeds.length)
    expect(seeds[0]).toMatchObject({ promptBody: 'worker prompt' })
    expect(resolveFullAppFactoryPolicyRoot({ BORING_FACTORY_POLICY_ROOT: policyRoot }, '/wrong')).toBe(policyRoot)
  })
})
