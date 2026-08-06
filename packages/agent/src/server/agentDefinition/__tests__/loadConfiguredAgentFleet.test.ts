import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { loadConfiguredAgentFleet } from '../loadConfiguredAgentFleet'
import { ErrorCode } from '../../../shared/error-codes'

const FIXTURE_ROOT = resolve(import.meta.dirname, 'fixtures', 'fleet')
const PERSONAS_DIR = resolve(FIXTURE_ROOT, 'personas')
const FLEET_CONFIG_PATH = resolve(FIXTURE_ROOT, 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(FIXTURE_ROOT, 'factory', 'policy.yaml')

describe('loadConfiguredAgentFleet', () => {
  test('composes valid seats and excludes an invalid seat with a stable diagnostic', async () => {
    const result = await loadConfiguredAgentFleet({
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: { ANTHROPIC_API_KEY: 'test-key' },
    })

    expect(result.agents).toHaveLength(1)
    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.agentTypeId).toBe('fixture-alpha')
    expect(alpha.definition.instructions).toContain('You are Alpha.')
    expect(alpha.definition.instructions).toContain('boring-skill:start name=greet')
    expect(alpha.model).toEqual({ preferred: 'anthropic:claude-sonnet-4-6' })

    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      seat: 'broken',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH,
    })
  })

  test('omits preferredModel when no candidate API key is present', async () => {
    const result = await loadConfiguredAgentFleet({
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.model).toBeUndefined()
  })

  test('throws FleetConfigError for a missing fleet.yaml (not a per-seat diagnostic)', async () => {
    await expect(loadConfiguredAgentFleet({
      personasDir: PERSONAS_DIR,
      fleetConfigPath: resolve(FIXTURE_ROOT, 'factory', 'does-not-exist.yaml'),
      policyPath: POLICY_PATH,
      env: {},
    })).rejects.toMatchObject({ name: 'FleetConfigError', code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID })
  })
})
