import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { loadConfiguredAgentFleet, type DiscoveredAgentPackageDescriptor } from '../loadConfiguredAgentFleet'
import { ErrorCode } from '../../../shared/error-codes'

const FIXTURE_ROOT = resolve(import.meta.dirname, 'fixtures', 'fleet')
const PERSONAS_DIR = resolve(FIXTURE_ROOT, 'personas')
const FLEET_CONFIG_PATH = resolve(FIXTURE_ROOT, 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(FIXTURE_ROOT, 'factory', 'policy.yaml')
const SKILLS_ROOT = resolve(FIXTURE_ROOT, 'skills')

// Plugin preflight issue codes are workspace-owned string literals (see
// packages/workspace/src/server/agentPlugins/scan.ts), not agent ErrorCode
// enum members; hoisted so the fixture uses a named constant.
const PREFLIGHT_INVALID_PLUGIN_METADATA = 'INVALID_PLUGIN_METADATA'

function descriptor(
  directory: string,
  definitionId: string,
  skills: readonly string[],
): DiscoveredAgentPackageDescriptor {
  return {
    rootDir: resolve(PERSONAS_DIR, directory),
    manifest: {
      boring: { agent: { definitionId, version: '1.0.0', instructionsRef: 'instructions.md' } },
      pi: { skills },
    },
    preflight: { ok: true },
  }
}

const DISCOVERED_PACKAGES = [
  descriptor('alpha', 'fixture-alpha', ['greet', 'skills/local']),
  descriptor('broken', 'fixture-broken', ['greet']),
  descriptor('mismatched', 'fixture-mismatched-actual', []),
]

function options(discoveredPackages = DISCOVERED_PACKAGES) {
  return {
    discoveredPackages,
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    skillsRoot: SKILLS_ROOT,
  }
}

describe('loadConfiguredAgentFleet', () => {
  test('composes valid seats and excludes an invalid seat with a stable diagnostic', async () => {
    const result = await loadConfiguredAgentFleet({
      ...options(),
      env: { ANTHROPIC_API_KEY: 'test-key' },
    })

    expect(result.agents).toHaveLength(1)
    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.agentTypeId).toBe('fixture-alpha')
    expect(alpha.definition.instructions).toContain('You are Alpha.')
    expect(alpha.definition.instructions).toContain('boring-skill:start name=greet')
    expect(alpha.definition.instructions).toContain('boring-skill:start name=package-2-97e420f7713e')
    expect(alpha.model).toEqual({ preferred: 'anthropic:claude-sonnet-4-6' })
    // gh-1107 slice 2: the compiled definition digest is the identity and
    // the package's knowledge/ folder rides the spec for composition to
    // mount as an agent-scoped readonly binding.
    expect(alpha.definition.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(alpha.knowledge?.rootDir).toBe(resolve(PERSONAS_DIR, 'alpha', 'knowledge'))

    expect(result.diagnostics).toHaveLength(3)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'broken',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
    }))
    // m7 (fix round 1): pin the persona-level exclusion path too — a
    // definitionId/agentTypeId mismatch is a persona defect, not a skill
    // digest problem, and must land on the distinct diagnostic code.
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'mismatched',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_PERSONA_INVALID,
    }))
  })

  test('omits preferredModel when no candidate API key is present', async () => {
    const result = await loadConfiguredAgentFleet({ ...options(), env: {} })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.model).toBeUndefined()
  })

  test('throws FleetConfigError for a missing fleet.yaml (not a per-seat diagnostic)', async () => {
    await expect(loadConfiguredAgentFleet({
      ...options(),
      fleetConfigPath: resolve(FIXTURE_ROOT, 'factory', 'does-not-exist.yaml'),
      env: {},
    })).rejects.toMatchObject({ name: 'FleetConfigError', code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID })
  })

  test('keeps discovered but unseated packages inert and visible in diagnostics', async () => {
    const result = await loadConfiguredAgentFleet({
      ...options([...DISCOVERED_PACKAGES, descriptor('alpha', 'fixture-unseated', [])]),
      env: {},
    })
    expect(result.agents.map((agent) => agent.agentTypeId)).not.toContain('fixture-unseated')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      agentTypeId: 'fixture-unseated',
      code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
    }))
  })

  test('fails closed every package claiming a conflicting definitionId', async () => {
    const alpha = descriptor('alpha', 'fixture-alpha', ['greet', 'skills/local'])
    const result = await loadConfiguredAgentFleet({
      ...options([alpha, {
        ...alpha,
        rootDir: resolve(PERSONAS_DIR, 'broken'),
        preflight: { ok: false, errors: [{ code: PREFLIGHT_INVALID_PLUGIN_METADATA, message: 'fixture preflight failure' }] },
      }]),
      env: {},
    })
    expect(result.agents).toHaveLength(0)
    expect(result.diagnostics.filter((item) => item.code === ErrorCode.enum.AGENT_DEFINITION_ID_CONFLICT)).toHaveLength(2)
  })
})
