import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createFullAppAutomationPluginEntry,
  FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS,
  resolveFullAppFactoryPolicyRoot,
} from '../plugins.js'

describe('full-app factory automation composition', () => {
  it('does not register configured automation again through package defaults', () => {
    expect(FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS).toEqual([])
  })

  it('uses an explicit deployable policy root and derives worker_cap 5', async () => {
    const policyRoot = await mkdtemp(join(tmpdir(), 'full-app-factory-policy-'))
    await mkdir(join(policyRoot, '.agents', 'factory'), { recursive: true })
    await mkdir(join(policyRoot, '.agents', 'automation'), { recursive: true })
    await writeFile(join(policyRoot, '.agents', 'factory', 'policy.yaml'), 'beadle:\n  worker_cap: 5\nmodels:\n  seats:\n    worker: T3\n    orchestrator: T1\n    triage: T3\n')
    await writeFile(join(policyRoot, '.agents', 'factory', 'fleet.yaml'), 'models:\n  tiers:\n    T1:\n      - provider: google\n        id: gemini-pro\n    T3:\n      - provider: google\n        id: gemini-worker\n')
    await writeFile(join(policyRoot, '.agents', 'automation', 'worker-slot.md'), 'worker prompt')
    await writeFile(join(policyRoot, '.agents', 'automation', 'triage-slot.md'), 'triage prompt')
    await writeFile(join(policyRoot, '.agents', 'automation', 'orchestrator-tick.md'), 'orchestrator prompt')

    const entry = createFullAppAutomationPluginEntry(policyRoot)
    if (!('options' in entry)) throw new TypeError('expected package plugin entry')
    const automationOptions = entry.options as {
      seedProvider: (context: {
        listExistingSeedKeys: (prefix: string) => Promise<readonly string[]>
        removeSeededAutomationIfIdle: (key: string) => Promise<boolean>
        warn: (message: string) => void
      }) => Promise<readonly { key: string; promptRef: string; promptBody: string }[]>
      canUpdateAutomationModel: (automation: { promptRef: string }) => boolean
    }
    const provider = automationOptions.seedProvider
    const seeds = await provider({
      listExistingSeedKeys: async () => [],
      removeSeededAutomationIfIdle: async () => true,
      warn: vi.fn(),
    })

    expect(seeds.map(({ key }) => key)).toEqual([
      'orchestrator-tick',
      'worker-slot-1',
      'worker-slot-2',
      'worker-slot-3',
      'worker-slot-4',
      'worker-slot-5',
      'triage',
    ])
    expect(new Set(seeds.map(({ promptRef }) => promptRef)).size).toBe(seeds.length)
    expect(seeds[0]).toMatchObject({ promptBody: 'orchestrator prompt' })
    expect(seeds[1]).toMatchObject({ promptBody: 'worker prompt' })
    expect(automationOptions.canUpdateAutomationModel({ promptRef: '.agents/automation/orchestrator-tick.md' })).toBe(false)
    expect(automationOptions.canUpdateAutomationModel({ promptRef: '.agents/automation/worker-slot-5.md' })).toBe(false)
    expect(automationOptions.canUpdateAutomationModel({ promptRef: '.agents/automation/user-created.md' })).toBe(true)
    expect(resolveFullAppFactoryPolicyRoot({ BORING_FACTORY_POLICY_ROOT: policyRoot }, '/wrong')).toBe(policyRoot)
  })
})
