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

import { ErrorCode } from '@hachej/boring-agent/shared'

import { loadBoringFactoryAgents, type BoringFactoryRole } from './factoryAgents'
import { resolvePlaygroundDefaultAgentTypeId } from '../shared/playgroundAgents'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..')
// The ratified 3-seat roster (gh-1187 S0) plus the factory-smoke CI seat
// (owner ruling 2026-08-22), in fleet.yaml order.
const EXPECTED = [
  { role: 'triage', id: 'boring-triage', skills: ['triage', 'owner-gate', 'handoff'] },
  { role: 'orchestrator', id: 'boring-orchestrator', skills: ['plan', 'feedback', 'owner-gate', 'handoff'] },
  { role: 'worker', id: 'boring-worker', skills: ['exec', 'fresh-eyes', 'owner-gate', 'handoff'] },
  { role: 'factory-smoke', id: 'boring-factory-smoke', skills: [] },
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

// Migrated (gh-1106 slice 3): factoryAgents.ts is now a thin call to
// loadConfiguredAgentFleet(); these tests exercise that loader against the
// repository's real .agents/personas + .agents/factory/fleet.yaml tree
// instead of the deleted bespoke composition.
describe('loadBoringFactoryAgents (loader against the real .agents/ tree)', () => {
  test('composes exactly the independently expected canonical skills in deterministic order', async () => {
    const agents = await loadBoringFactoryAgents({ workspaceRoot: REPOSITORY_ROOT })
    const defaultAgentTypeId = resolvePlaygroundDefaultAgentTypeId(agents)

    expect(agents.map((agent) => agent.agentTypeId)).toEqual(EXPECTED.map(({ id }) => id))
    expect(defaultAgentTypeId).toBe(EXPECTED[0].id)
    expect(agents.some((agent) => agent.agentTypeId === defaultAgentTypeId)).toBe(true)
    for (const [index, expected] of EXPECTED.entries()) {
      const agent = agents[index]
      if (!agent || 'legacyDefault' in agent) throw new Error('factory agent must be configured')
      expect(agent.definition.instructions).toBe(await expectedInstructions(expected.role, expected.skills))
      // A zero-skill seat (factory-smoke) appends no skill blocks at all, so
      // `.match()` returns null rather than an empty array — assert absence
      // directly instead of feeding null into `.toHaveLength()`.
      expect(agent.definition.instructions.match(/boring-skill:start/g) ?? []).toHaveLength(expected.skills.length)
      expect(agent.definition.instructions.match(/boring-skill:end/g) ?? []).toHaveLength(expected.skills.length)
    }
  })

  // The defect this guards: the playground composed the fleet from the
  // repository root but served `apps/workspace-playground/workspace` as the
  // `user` filesystem, and published `.agents/personas/<seat>/instructions.md`
  // against the WRONG root. Every ref was well-formed and every ref 404'd.
  describe('instruction refs are addressed against the served workspace root', () => {
    test('publishes a ref that actually resolves when the personas are inside the served root', async () => {
      const agents = await loadBoringFactoryAgents({ workspaceRoot: REPOSITORY_ROOT, env: {} })

      for (const agent of agents) {
        if ('legacyDefault' in agent) throw new Error('factory agent must be configured')
        const refs = agent.instructionFiles ?? []
        expect(refs).toHaveLength(1)
        const ref = refs[0]!
        expect(ref).toMatchObject({ filesystem: 'user', role: 'persona' })
        // The whole point: read it back through the same root the client would.
        await expect(readFile(resolve(REPOSITORY_ROOT, ref.path), 'utf8')).resolves.toMatch(/\S/)
      }
    })

    test('publishes NO ref and fires the stable diagnostic when they are outside it', async () => {
      // What `dev.ts` serves by default: a workspace directory that does not
      // contain this repository's `.agents/` tree.
      const servedRoot = resolve(REPOSITORY_ROOT, 'apps/workspace-playground/workspace')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const agents = await loadBoringFactoryAgents({ workspaceRoot: servedRoot, env: {} })

        expect(agents.length).toBe(EXPECTED.length)
        for (const agent of agents) {
          if ('legacyDefault' in agent) throw new Error('factory agent must be configured')
          // A missing row, never a dead link.
          expect(agent.instructionFiles).toBeUndefined()
        }
        const reported = warn.mock.calls.map((call) => String(call[0]))
        for (const { role } of EXPECTED) {
          expect(reported.some((line) =>
            line.includes(`${role}: ${ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE}`),
          )).toBe(true)
        }
      } finally {
        warn.mockRestore()
      }
    })
  })

  test('applies preferred models only from trusted role policy', async () => {
    const preferredModels: Partial<Record<BoringFactoryRole, string>> = {
      orchestrator: 'test-provider:planning-model',
    }
    // m5 (fix round 1): inject an empty env so this doesn't read ambient
    // ANTHROPIC_API_KEY — on a keyed dev machine, tier-based model
    // resolution would otherwise give `worker` a real preferred model too,
    // breaking the "not.toHaveProperty('model')" assertion below.
    const agents = await loadBoringFactoryAgents({ workspaceRoot: REPOSITORY_ROOT, preferredModels, env: {} })

    expect(agents.find((agent) => agent.agentTypeId === 'boring-orchestrator')).toMatchObject({
      model: { preferred: 'test-provider:planning-model' },
    })
    expect(agents.find((agent) => agent.agentTypeId === 'boring-worker')).not.toHaveProperty('model')
  })

  test('fails boot with a stable, redacted diagnostic when a canonical skill is unavailable', async () => {
    fsFailure.skill = 'triage'
    try {
      const error = await loadBoringFactoryAgents({ workspaceRoot: REPOSITORY_ROOT }).catch((cause: unknown) => cause)
      expect(error).toMatchObject({
        name: 'TrustedAgentCompositionError',
        diagnostics: [
          { seat: 'triage', code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH },
        ],
      })
      expect(String(error)).not.toMatch(/private\/root|SKILL\.md missing/)
    } finally {
      fsFailure.skill = ''
    }
  })
})
