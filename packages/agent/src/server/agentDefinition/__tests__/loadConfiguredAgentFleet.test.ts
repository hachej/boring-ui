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

    expect(result.diagnostics).toHaveLength(2)
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

  test('publishes the persona instructions path from the SEAT, not the agent id', async () => {
    const result = await loadConfiguredAgentFleet({
      personasDir: PERSONAS_DIR,
      personasRelativeDir: '.agents/personas',
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    // seat "alpha" ≠ agentTypeId "fixture-alpha": nothing downstream can
    // invert this mapping, which is why the loader publishes it.
    expect(alpha.instructionFiles).toEqual([
      { path: '.agents/personas/alpha/instructions.md', name: 'Persona instructions' },
    ])
  })

  test('omits instructionFiles when no workspace-relative personas dir is supplied', async () => {
    const result = await loadConfiguredAgentFleet({
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.instructionFiles).toBeUndefined()
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
