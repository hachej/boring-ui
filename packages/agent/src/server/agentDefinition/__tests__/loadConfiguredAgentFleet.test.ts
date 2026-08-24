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

  test('records the persona instructions source as a canonical host absolute path', async () => {
    const result = await loadConfiguredAgentFleet({ ...options(), env: {} })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
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
    if (!linked || 'legacyDefault' in linked) throw new Error('expected a configured agent')
    expect(linked.instructionSources).toEqual([
      { absolutePath: join(await realpath(outsidePersona), 'instructions.md'), role: 'persona' },
    ])
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
      ...options([...DISCOVERED_PACKAGES, descriptor(resolve(PERSONAS_DIR, 'alpha'), 'fixture-unseated', [])]),
      env: {},
    })
    expect(result.agents.map((agent) => agent.agentTypeId)).not.toContain('fixture-unseated')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      agentTypeId: 'fixture-unseated',
      code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
    }))
  })

  test('fails closed every package claiming a conflicting definitionId', async () => {
    const alpha = descriptor(resolve(PERSONAS_DIR, 'alpha'), 'fixture-alpha', ['greet', 'skills/local'])
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
