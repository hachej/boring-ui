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
    await writeFile(join(policyRoot, '.agents', 'factory', 'policy.yaml'), 'beadle:\n  worker_cap: 5\n')

    const entry = createFullAppAutomationPluginEntry(policyRoot)
    if (!('options' in entry)) throw new TypeError('expected package plugin entry')
    const provider = (entry.options as {
      seedProvider: (context: {
        findExistingSeedKeys: (keys: readonly string[]) => Promise<readonly string[]>
        removeSeededAutomationIfIdle: (key: string) => Promise<'removed'>
        warn: (message: string) => void
      }) => Promise<readonly { key: string }[]>
    }).seedProvider
    const seeds = await provider({
      findExistingSeedKeys: async () => [],
      removeSeededAutomationIfIdle: async () => 'removed',
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
    expect(resolveFullAppFactoryPolicyRoot({ BORING_FACTORY_POLICY_ROOT: policyRoot }, '/wrong')).toBe(policyRoot)
  })
})
