import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { loadConfiguredAgentFleet } from '../loadConfiguredAgentFleet'
import { ErrorCode } from '../../../shared/error-codes'

const FIXTURE_ROOT = resolve(import.meta.dirname, 'fixtures', 'fleet')
const PERSONAS_DIR = resolve(FIXTURE_ROOT, 'personas')
const FLEET_CONFIG_PATH = resolve(FIXTURE_ROOT, 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(FIXTURE_ROOT, 'factory', 'policy.yaml')
const UNSAFE_SEAT_ROOT = resolve(import.meta.dirname, 'fixtures', 'unsafe-seat')
const UNSAFE_SEAT_PERSONAS_DIR = resolve(UNSAFE_SEAT_ROOT, 'personas')
const UNSAFE_SEAT_FLEET_CONFIG_PATH = resolve(UNSAFE_SEAT_ROOT, 'factory', 'fleet.yaml')

describe('loadConfiguredAgentFleet', () => {
  test('composes valid seats and excludes an invalid seat with a stable diagnostic', async () => {
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: FIXTURE_ROOT,
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

  test('publishes the persona instructions ref from the SEAT, not the agent id', async () => {
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: FIXTURE_ROOT,
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    // seat "alpha" != agentTypeId "fixture-alpha": nothing downstream can
    // invert this mapping, which is why the loader publishes it. The personas
    // path is relative to the WORKSPACE root the caller names — not guessed
    // from personasDir — and `role` is a discriminator, not display words.
    expect(alpha.instructionFiles).toEqual([
      { filesystem: 'user', path: 'personas/alpha/instructions.md', role: 'persona' },
    ])
  })

  test('reports a stable diagnostic when a seat composes an unsafe workspace path', async () => {
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: UNSAFE_SEAT_ROOT,
      personasDir: UNSAFE_SEAT_PERSONAS_DIR,
      fleetConfigPath: UNSAFE_SEAT_FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    // A backslash cannot survive as a workspace-relative path, so the link is
    // withheld — but the seat still composes, and never silently. Only the
    // backslash and percent-encoded seats are fixtured here; ordinary seat
    // names (spaces included) take the publishing branch covered above.
    expect(result.agents).toHaveLength(2)
    const agent = result.agents.find((candidate) => candidate.agentTypeId === 'fixture-odd')
    if (!agent || 'legacyDefault' in agent) throw new Error('expected the odd configured agent')
    expect(agent.instructionFiles).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'odd\\seat',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    }))

    const encoded = result.agents.find((candidate) => candidate.agentTypeId === 'fixture-encoded')
    if (!encoded || 'legacyDefault' in encoded) throw new Error('expected the encoded configured agent')
    expect(encoded.instructionFiles).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'encoded%2eseat',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    }))
  })

  test('publishes nothing when the personas tree is outside the served workspace', async () => {
    // The common real deployment: the fleet is composed from a repository
    // root while the `user` filesystem serves a different workspace root. A
    // ref addressed against the wrong root is WELL-FORMED, so every path
    // guard downstream accepts it and the workbench silently opens nothing.
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: resolve(FIXTURE_ROOT, 'factory'),
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    // The seat still composes and can still chat; only the link is withheld.
    expect(result.agents).toHaveLength(1)
    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.instructionFiles).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'alpha',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    }))
  })

  test('publishes nothing when the host names no served workspace root', async () => {
    // The per-request shape: the caller composes the fleet without knowing
    // which workspace root will serve it. There is no root to make the
    // instructions path relative to, so publishing one would be a guess — and
    // a well-formed-but-dead link is exactly what this guard prevents.
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: null,
      personasDir: PERSONAS_DIR,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      env: {},
    })

    expect(result.agents).toHaveLength(1)
    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    expect(alpha.instructionFiles).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'alpha',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    }))
  })

  test('omits preferredModel when no candidate API key is present', async () => {
    const result = await loadConfiguredAgentFleet({
      workspaceRoot: FIXTURE_ROOT,
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
      workspaceRoot: FIXTURE_ROOT,
      personasDir: PERSONAS_DIR,
      fleetConfigPath: resolve(FIXTURE_ROOT, 'factory', 'does-not-exist.yaml'),
      policyPath: POLICY_PATH,
      env: {},
    })).rejects.toMatchObject({ name: 'FleetConfigError', code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID })
  })
})
