import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

const fsFailure = vi.hoisted(() => ({ skill: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (fsFailure.skill && String(args[0]).includes(`/${fsFailure.skill}/SKILL.md`)) {
        throw Object.assign(new Error(`/private/root/${fsFailure.skill}/SKILL.md missing`), { code: 'ENOENT' })
      }
      return actual.readFile(...args)
    },
  }
})

import { loadBoringFactoryAgents, type BoringFactoryRole } from './factoryAgents'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
const EXPECTED = [
  { role: 'concierge', id: 'boring-concierge', skills: ['feedback', 'triage', 'handoff'] },
  { role: 'triage', id: 'boring-triage', skills: ['triage', 'handoff'] },
  { role: 'steward', id: 'boring-steward', skills: ['plan', 'handoff'] },
  { role: 'worker', id: 'boring-worker', skills: ['exec', 'handoff'] },
  { role: 'reviewer', id: 'boring-reviewer', skills: ['fresh-eyes', 'handoff'] },
] as const

async function expectedInstructions(role: string, skills: readonly string[]): Promise<string> {
  const base = await readFile(resolve(REPOSITORY_ROOT, '.agents', 'personas', role, 'instructions.md'), 'utf8')
  const blocks: string[] = []
  for (const skill of skills) {
    const content = await readFile(resolve(REPOSITORY_ROOT, '.agents', 'skills', skill, 'SKILL.md'), 'utf8')
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    const digest = `sha256:${Buffer.from(hash).toString('hex')}`
    blocks.push([
      `<!-- boring-skill:start name=${skill} digest=${digest} -->`,
      content,
      `<!-- boring-skill:end name=${skill} -->`,
    ].join('\n'))
  }
  return [base, ...blocks].join('\n\n')
}

describe('loadBoringFactoryAgents', () => {
  test('composes exactly the independently expected canonical skills in deterministic order', async () => {
    const agents = await loadBoringFactoryAgents()

    expect(agents.map((agent) => agent.agentTypeId)).toEqual(EXPECTED.map(({ id }) => id))
    for (const [index, expected] of EXPECTED.entries()) {
      const agent = agents[index]
      if ('legacyDefault' in agent) throw new Error('factory agent must be configured')
      expect(agent.definition.instructions).toBe(await expectedInstructions(expected.role, expected.skills))
      expect(agent.definition.instructions.match(/boring-skill:start/g)).toHaveLength(expected.skills.length)
      expect(agent.definition.instructions.match(/boring-skill:end/g)).toHaveLength(expected.skills.length)
    }
  })

  test('applies preferred models only from trusted role policy', async () => {
    const preferredModels: Partial<Record<BoringFactoryRole, string>> = {
      steward: 'test-provider:planning-model',
    }
    const agents = await loadBoringFactoryAgents({ preferredModels })

    expect(agents.find((agent) => agent.agentTypeId === 'boring-steward')).toMatchObject({
      model: { preferred: 'test-provider:planning-model' },
    })
    expect(agents.find((agent) => agent.agentTypeId === 'boring-worker')).not.toHaveProperty('model')
  })

  test('fails boot with a stable redacted error when a canonical skill is unavailable', async () => {
    fsFailure.skill = 'triage'
    try {
      const error = await loadBoringFactoryAgents().catch((cause: unknown) => cause)
      expect(error).toMatchObject({
        name: 'TrustedAgentCompositionError',
        code: 'CONFIG_INVALID',
        field: 'skills.triage',
        message: 'canonical skill is unavailable',
      })
      expect(String(error)).not.toMatch(/private\/root|SKILL\.md missing/)
    } finally {
      fsFailure.skill = ''
    }
  })
})
