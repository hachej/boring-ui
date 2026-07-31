import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createFullAppAgentFleetComposition } from '../agentFleet.js'

describe('full-app Wave 1 agent fleet', () => {
  it('defaults the dummy agent to the smaller Infomaniak model', () => {
    const composition = createFullAppAgentFleetComposition({})

    expect(composition.agents).toMatchObject([
      { agentTypeId: 'default', model: { preferred: 'infomaniak:Qwen/Qwen3.5-122B-A10B-FP8' } },
      { agentTypeId: 'dummy', model: { preferred: 'infomaniak:nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8' } },
    ])
  })

  it('composes a default agent and a cheaper dummy agent on distinct models', async () => {
    const composition = createFullAppAgentFleetComposition({
      BORING_AGENT_DEFAULT_MODEL: 'test:deep-model',
      BORING_AGENT_DUMMY_MODEL: 'test:cheap-model',
    })

    expect(composition.defaultAgentTypeId).toBe('default')
    expect(composition.agents).toEqual([
      expect.objectContaining({
        agentTypeId: 'default',
        definition: expect.objectContaining({ label: 'Default' }),
        model: { preferred: 'test:deep-model' },
      }),
      expect.objectContaining({
        agentTypeId: 'dummy',
        definition: expect.objectContaining({ label: 'Dummy' }),
        model: { preferred: 'test:cheap-model' },
      }),
    ])
    expect(await composition.fleetCompiler.compile({ agents: composition.agents })).toBe(composition.agents)
  })

  it('rejects a deployment that collapses both agents onto the same model', () => {
    expect(() => createFullAppAgentFleetComposition({
      BORING_AGENT_DEFAULT_MODEL: 'test:same-model',
      BORING_AGENT_DUMMY_MODEL: 'test:same-model',
    })).toThrow('requires distinct default and dummy models')
  })

  it('honors the existing Infomaniak default-model configuration', () => {
    const composition = createFullAppAgentFleetComposition({
      BORING_AGENT_INFOMANIAK_PROVIDER: 'sovereign',
      BORING_AGENT_INFOMANIAK_MODEL: 'configured-deep-model',
    })

    expect(composition.agents[0]).toMatchObject({
      agentTypeId: 'default',
      model: { preferred: 'sovereign:configured-deep-model' },
    })
  })

  it.each(['main.ts', 'dev.ts'])('wires the shared fleet into the real %s server composition', (entrypoint) => {
    const source = readFileSync(new URL(`../${entrypoint}`, import.meta.url), 'utf8')
    expect(source).toMatch(/\.\.\.createFullAppAgentFleetComposition\(\)/)
  })
})
