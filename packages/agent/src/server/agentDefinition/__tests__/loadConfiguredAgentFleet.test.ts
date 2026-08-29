import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, onTestFinished, test } from 'vitest'

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
  rootDir: string,
  definitionId: string,
  skills: readonly string[],
): DiscoveredAgentPackageDescriptor {
  return {
    rootDir,
    manifest: {
      boring: { agent: { definitionId, version: '1.0.0', instructionsRef: 'instructions.md' } },
      pi: { skills },
    },
    preflight: { ok: true },
  }
}

const DISCOVERED_PACKAGES = [
  descriptor(resolve(PERSONAS_DIR, 'alpha'), 'fixture-alpha', ['greet', 'skills/local']),
  descriptor(resolve(PERSONAS_DIR, 'broken'), 'fixture-broken', ['greet']),
  descriptor(resolve(PERSONAS_DIR, 'mismatched'), 'fixture-mismatched-actual', []),
]

function options(discoveredPackages = DISCOVERED_PACKAGES) {
  return {
    discoveredPackages,
    fleetConfigPath: FLEET_CONFIG_PATH,
    policyPath: POLICY_PATH,
    skillsRoot: SKILLS_ROOT,
  }
}

async function temporaryFleetRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'configured-agent-fleet-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

async function writeSingleSeatFleet(path: string, seat: string): Promise<void> {
  await writeFile(path, [
    'models:',
    '  tiers:',
    '    T3:',
    '      - provider: anthropic',
    '        id: claude-sonnet-4-6',
    '        envVar: ANTHROPIC_API_KEY',
    'seats:',
    `  - seat: ${JSON.stringify(seat)}`,
    '    agentTypeId: fixture-alpha',
    '    skills: []',
    '',
  ].join('\n'))
}

async function validAlphaOptions() {
  const root = await temporaryFleetRoot()
  const fleetConfigPath = join(root, 'fleet.yaml')
  await writeFile(fleetConfigPath, [
    'models:',
    '  tiers:',
    '    T3:',
    '      - provider: anthropic',
    '        id: claude-sonnet-4-6',
    '        envVar: ANTHROPIC_API_KEY',
    'seats:',
    '  - seat: alpha',
    '    agentTypeId: fixture-alpha',
    '    skills:',
    '      - name: greet',
    '        digest: sha256:830555b295458756d3c94bce4cc763d7e666e47b59a9718015de3d237818d116',
    '      - name: skills/local',
    '        digest: sha256:97e420f7713ef2c4be618078f12936196c39790accea4c03e174ee981e9e2b37',
    '',
  ].join('\n'))
  return {
    discoveredPackages: [DISCOVERED_PACKAGES[0]!],
    fleetConfigPath,
    policyPath: POLICY_PATH,
    skillsRoot: SKILLS_ROOT,
  }
}

describe('loadConfiguredAgentFleet', () => {
  test('fails the whole configured fleet when any seated Agent is invalid', async () => {
    await expect(loadConfiguredAgentFleet({
      ...options(),
      env: { ANTHROPIC_API_KEY: 'test-key' },
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'seats',
    })
  })

  test('composes a fully valid configured seat', async () => {
    const result = await loadConfiguredAgentFleet({
      ...await validAlphaOptions(),
      env: { ANTHROPIC_API_KEY: 'test-key' },
    })
    const [alpha] = result.agents
    if (!alpha) throw new Error('expected a configured agent')
    expect(alpha.agentTypeId).toBe('fixture-alpha')
    expect(alpha.definition.instructions).toContain('You are Alpha.')
    expect(alpha.definition.instructions).toContain('boring-skill:start name=greet')
    expect(alpha.definition.instructions).toContain('boring-skill:start name=package-2-97e420f7713e')
    expect(alpha.model).toEqual({ preferred: 'anthropic:claude-sonnet-4-6' })
    expect(alpha.definition.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(alpha.knowledge?.rootDir).toBe(resolve(PERSONAS_DIR, 'alpha', 'knowledge'))
    expect(result.diagnostics).toEqual([])
  })

  test('records the persona instructions source as a canonical host absolute path', async () => {
    const result = await loadConfiguredAgentFleet({ ...await validAlphaOptions(), env: {} })

    const [alpha] = result.agents
    if (!alpha) throw new Error('expected a configured agent')
    // Nothing downstream can invert seat -> directory, which is why the loader
    // records it. It records an ABSOLUTE host path and NOT a workspace-relative
    // ref: which workspace root serves this seat is only known per request
    // (gh-1189), so addressing happens in `describe`. `role` is a
    // discriminator, not display words.
    expect(alpha.instructionSources).toEqual([
      { absolutePath: resolve(PERSONAS_DIR, 'alpha', 'instructions.md'), role: 'persona' },
    ])
    // No composition-time link decision is taken any more, so no seat carries
    // an unpublishable diagnostic here.
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain(ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE)
  })

  test('canonicalizes a symlinked package root before recording its instructions source', async () => {
    const root = await temporaryFleetRoot()
    const workspaceRoot = join(root, 'workspace')
    const personasDir = join(workspaceRoot, 'personas')
    const outsidePersona = join(root, 'outside')
    const fleetConfigPath = join(workspaceRoot, 'fleet.yaml')
    await mkdir(personasDir, { recursive: true })
    await cp(join(PERSONAS_DIR, 'alpha'), outsidePersona, { recursive: true })
    await symlink(outsidePersona, join(personasDir, 'linked'), 'dir')
    await writeSingleSeatFleet(fleetConfigPath, 'linked')

    const result = await loadConfiguredAgentFleet({
      discoveredPackages: [descriptor(join(personasDir, 'linked'), 'fixture-alpha', [])],
      fleetConfigPath,
      policyPath: POLICY_PATH,
      skillsRoot: SKILLS_ROOT,
      env: {},
    })

    // The recorded source is the REALPATH, not the symlink route: a dotfiles
    // manager can make `.agents` a symlink, and a lexical path would later be
    // judged "inside the workspace" and published as a dead link. Whether that
    // canonical location is reachable is decided per request, against the root
    // actually being served (see resolveAgentInstructionFileRefs).
    expect(result.agents).toHaveLength(1)
    const [linked] = result.agents
    if (!linked) throw new Error('expected a configured agent')
    expect(linked.instructionSources).toEqual([
      { absolutePath: join(await realpath(outsidePersona), 'instructions.md'), role: 'persona' },
    ])
  })

  test('omits preferredModel when no candidate API key is present', async () => {
    const result = await loadConfiguredAgentFleet({ ...await validAlphaOptions(), env: {} })

    const [alpha] = result.agents
    if (!alpha) throw new Error('expected a configured agent')
    expect(alpha.model).toBeUndefined()
  })

  test('throws FleetConfigError for a missing fleet.yaml (not a per-seat diagnostic)', async () => {
    await expect(loadConfiguredAgentFleet({
      ...options(),
      fleetConfigPath: resolve(FIXTURE_ROOT, 'factory', 'does-not-exist.yaml'),
      env: {},
    })).rejects.toMatchObject({ name: 'FleetConfigError', code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID })
  })

  test('throws FleetConfigError when fleet.yaml omits the model tier table', async () => {
    const root = await temporaryFleetRoot()
    const fleetConfigPath = join(root, 'fleet.yaml')
    await writeFile(fleetConfigPath, 'seats: []\n')

    await expect(loadConfiguredAgentFleet({
      ...options(),
      fleetConfigPath,
      env: {},
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'models.tiers',
    })
  })

  test('throws FleetConfigError when a configured model candidate is malformed', async () => {
    const root = await temporaryFleetRoot()
    const fleetConfigPath = join(root, 'fleet.yaml')
    await writeFile(fleetConfigPath, [
      'models:',
      '  tiers:',
      '    T3:',
      "      - provider: '   '",
      '        id: claude-sonnet-4-6',
      '        envVar: ANTHROPIC_API_KEY',
      'seats: []',
      '',
    ].join('\n'))

    await expect(loadConfiguredAgentFleet({
      ...options(),
      fleetConfigPath,
      env: {},
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'models.tiers.T3[0]',
    })
  })

  test('throws FleetConfigError when policy.yaml is missing', async () => {
    await expect(loadConfiguredAgentFleet({
      ...await validAlphaOptions(),
      policyPath: resolve(FIXTURE_ROOT, 'factory', 'does-not-exist-policy.yaml'),
      env: {},
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'policyPath',
    })
  })

  test('throws FleetConfigError when a policy seat tier is not a string', async () => {
    const root = await temporaryFleetRoot()
    const policyPath = join(root, 'policy.yaml')
    await writeFile(policyPath, 'models:\n  seats:\n    alpha: 42\n')

    await expect(loadConfiguredAgentFleet({
      ...await validAlphaOptions(),
      policyPath,
      env: {},
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'models.seats.alpha',
    })
  })

  test('throws FleetConfigError when policy references a missing model tier', async () => {
    const root = await temporaryFleetRoot()
    const policyPath = join(root, 'policy.yaml')
    await writeFile(policyPath, 'models:\n  seats:\n    alpha: T9\n')

    await expect(loadConfiguredAgentFleet({
      ...options(),
      policyPath,
      env: {},
    })).rejects.toMatchObject({
      name: 'FleetConfigError',
      code: ErrorCode.enum.AGENT_FLEET_CONFIG_FILE_INVALID,
      field: 'models.tiers.T9',
    })
  })

  test('keeps discovered but unseated packages inert and visible in diagnostics', async () => {
    const result = await loadConfiguredAgentFleet({
      ...await validAlphaOptions(),
      discoveredPackages: [
        DISCOVERED_PACKAGES[0]!,
        descriptor(resolve(PERSONAS_DIR, 'alpha'), 'fixture-unseated', []),
      ],
      env: {},
    })
    expect(result.agents.map((agent) => agent.agentTypeId)).not.toContain('fixture-unseated')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      agentTypeId: 'fixture-unseated',
      code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
    }))
  })

  test('fails startup when packages conflict for a seated definitionId', async () => {
    const alpha = descriptor(resolve(PERSONAS_DIR, 'alpha'), 'fixture-alpha', ['greet', 'skills/local'])
    await expect(loadConfiguredAgentFleet({
      ...await validAlphaOptions(),
      discoveredPackages: [alpha, {
        ...alpha,
        rootDir: resolve(PERSONAS_DIR, 'broken'),
        preflight: { ok: false, errors: [{ code: PREFLIGHT_INVALID_PLUGIN_METADATA, message: 'fixture preflight failure' }] },
      }],
      env: {},
    })).rejects.toMatchObject({ name: 'FleetConfigError', field: 'seats' })
  })
})
