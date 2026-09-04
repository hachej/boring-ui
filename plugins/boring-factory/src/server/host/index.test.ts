import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFactoryHost } from './index'

const repositoryRoot = resolve(import.meta.dirname, '../../../../..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

describe('factory host composition', () => {
  it('keeps sandbox provider selection separate from seat model preferences', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'factory-host-models-'))
    temporaryRoots.push(stateRoot)
    const env = {
      BORING_FACTORY_ORCHESTRATOR_MODEL: 'orchestrator-from-env',
      BORING_FACTORY_WORKER_MODEL: 'worker-from-env',
      BORING_FACTORY_REVIEWER_MODEL: 'reviewer-from-env',
    } as NodeJS.ProcessEnv

    const host = await createFactoryHost({
      repositoryRoot,
      workspaceRoot: repositoryRoot,
      epicKey: 'seat-model-proof',
      featureName: 'Seat Model Proof',
      stateRoot,
      env,
      provider: 'local-simulation',
    })

    try {
      const preferredModels = host.agents.map((agent) => agent.model?.preferred)
      expect(preferredModels).toEqual([
        env.BORING_FACTORY_ORCHESTRATOR_MODEL,
        env.BORING_FACTORY_WORKER_MODEL,
        env.BORING_FACTORY_REVIEWER_MODEL,
      ])
      expect(preferredModels).not.toContain('local-simulation')
    } finally {
      host.close()
    }
  })
})
