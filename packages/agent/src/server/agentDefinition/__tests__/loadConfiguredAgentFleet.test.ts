import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
const UNSAFE_SEAT_ROOT = resolve(import.meta.dirname, 'fixtures', 'unsafe-seat')
const UNSAFE_SEAT_PERSONAS_DIR = resolve(UNSAFE_SEAT_ROOT, 'personas')
const UNSAFE_SEAT_FLEET_CONFIG_PATH = resolve(UNSAFE_SEAT_ROOT, 'factory', 'fleet.yaml')

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
    workspaceRoot: FIXTURE_ROOT,
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

  test('publishes the persona instructions ref from the discovered package root', async () => {
    const result = await loadConfiguredAgentFleet({ ...options(), env: {} })

    const [alpha] = result.agents
    if (!alpha || 'legacyDefault' in alpha) throw new Error('expected a configured agent')
    // The path is the discovered package root relative to the WORKSPACE root
    // the caller names — nothing downstream can invert seat → directory,
    // which is why the loader publishes it. `role` is a discriminator, not
    // display words.
    expect(alpha.instructionFiles).toEqual([
      { filesystem: 'user', path: 'personas/alpha/instructions.md', role: 'persona' },
    ])
  })

  test('reports a stable diagnostic when a seat composes an unsafe workspace path', async () => {
    const result = await loadConfiguredAgentFleet({
      discoveredPackages: [
        descriptor(resolve(UNSAFE_SEAT_PERSONAS_DIR, 'odd\\seat'), 'fixture-odd', []),
        descriptor(resolve(UNSAFE_SEAT_PERSONAS_DIR, 'encoded%2eseat'), 'fixture-encoded', []),
      ],
      workspaceRoot: UNSAFE_SEAT_ROOT,
      fleetConfigPath: UNSAFE_SEAT_FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      skillsRoot: SKILLS_ROOT,
      env: {},
    })

    // A backslash cannot survive as a workspace-relative path, so the link is
    // withheld — but the seat still composes, and never silently. Only the
    // backslash and percent-encoded package roots are fixtured here; ordinary
    // directory names (spaces included) take the publishing branch above.
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

  test('publishes nothing when the discovered packages are outside the served workspace', async () => {
    // The common real deployment: the fleet is composed from a repository
    // root while the `user` filesystem serves a different workspace root. A
    // ref addressed against the wrong root is WELL-FORMED, so every path
    // guard downstream accepts it and the workbench silently opens nothing.
    const result = await loadConfiguredAgentFleet({
      ...options(),
      workspaceRoot: resolve(FIXTURE_ROOT, 'factory'),
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
      ...options(),
      workspaceRoot: null,
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

  test('withholds the link when a package root symlink escapes the workspace', async () => {
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
      workspaceRoot,
      fleetConfigPath,
      policyPath: POLICY_PATH,
      skillsRoot: SKILLS_ROOT,
      env: {},
    })

    // The canonical package root resolves OUTSIDE the served workspace, so a
    // published ref would be well-formed but dead. The seat still composes
    // (the package content itself is fine); only the link is withheld.
    expect(result.agents).toHaveLength(1)
    const [linked] = result.agents
    if (!linked || 'legacyDefault' in linked) throw new Error('expected a configured agent')
    expect(linked.instructionFiles).toBeUndefined()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      seat: 'linked',
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
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
