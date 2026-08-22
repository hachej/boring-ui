import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, onTestFinished, test } from 'vitest'

import { loadConfiguredAgentFleet } from '../loadConfiguredAgentFleet'
import { ErrorCode } from '../../../shared/error-codes'

// The REAL repository `.agents` tree of this worktree checkout — not the
// synthetic fixtures used elsewhere in this directory. These tests pin the
// contract that every live persona package under `.agents/personas/`
// discovers, compiles, and composes (or is honestly inert when unseated).
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../../..')
const PERSONAS_ROOT = resolve(REPOSITORY_ROOT, '.agents', 'personas')
const FLEET_CONFIG_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'fleet.yaml')
const POLICY_PATH = resolve(REPOSITORY_ROOT, '.agents', 'factory', 'policy.yaml')
const SKILLS_ROOT = resolve(REPOSITORY_ROOT, '.agents', 'skills')

// K7 vertical-agent packages (gh: weekend/k7-agent-packages). factory-smoke
// exists for CI/factory verification; creator-growth is the first vertical
// skeleton and stays unseated until the owner defines its commercial loop.
const NEW_PACKAGES = [
  { dir: 'factory-smoke', definitionId: 'boring-factory-smoke', marker: 'Factory Smoke persona' },
  { dir: 'creator-growth', definitionId: 'boring-creator-growth', marker: 'grow that creator' },
] as const

const RATIFIED_SEATS = ['boring-triage', 'boring-orchestrator', 'boring-worker'] as const

interface DiscoveredPersonaDescriptor {
  readonly rootDir: string
  readonly manifest: {
    readonly boring: {
      readonly agent: {
        readonly definitionId: string
        readonly version: string
        readonly label?: string
        readonly description?: string
        readonly instructionsRef: string
      }
    }
    readonly pi?: { readonly skills: readonly string[] }
  }
  readonly preflight: { readonly ok: boolean }
}

/** Mirrors the plugin-scan projection of `.agents/personas/*` (see
 * discoverAgentPackages in @hachej/boring-workspace): package.json's
 * `boring.agent` block plus an optional `pi.skills` list. */
async function discoverRepositoryPersonas(): Promise<DiscoveredPersonaDescriptor[]> {
  const entries = await readdir(PERSONAS_ROOT, { withFileTypes: true })
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  return Promise.all(names.map(async (name) => {
    const rootDir = join(PERSONAS_ROOT, name)
    const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as {
      boring?: { agent?: Record<string, unknown> }
      pi?: { skills?: readonly string[] }
    }
    if (!pkg.boring || !pkg.boring.agent) throw new Error(`persona "${name}" has no boring.agent block`)
    const agent = pkg.boring.agent
    return {
      rootDir,
      manifest: {
        boring: {
          agent: {
            definitionId: String(agent.definitionId),
            version: String(agent.version),
            ...(typeof agent.label === 'string' ? { label: agent.label } : {}),
            ...(typeof agent.description === 'string' ? { description: agent.description } : {}),
            instructionsRef: String(agent.instructionsRef),
          },
        },
        ...(pkg.pi?.skills ? { pi: { skills: [...pkg.pi.skills] } } : {}),
      },
      preflight: { ok: true },
    }
  }))
}

describe('loadConfiguredAgentFleet against the real .agents tree', () => {
  test('every repository persona package is discovered, and the two K7 packages compose end to end when seated', async () => {
    const discovered = await discoverRepositoryPersonas()
    const definitionIds = discovered.map((descriptor) => String(descriptor.manifest.boring.agent.definitionId))
    // Discovery sees the ratified roster AND both new packages (order is
    // the plugin scan's business, not ours).
    expect([...definitionIds].sort()).toEqual([
      ...RATIFIED_SEATS,
      ...NEW_PACKAGES.map((pkg) => pkg.definitionId),
    ].sort())

    // Seat the new packages in a THROWAWAY copy of fleet.yaml so this test
    // can prove full composition without mutating the class-B roster.
    const fleetYaml = await readFile(FLEET_CONFIG_PATH, 'utf8')
    const root = await mkdtemp(join(tmpdir(), 'k7-persona-fleet-'))
    onTestFinished(() => rm(root, { recursive: true, force: true }))
    const factoryDir = join(root, 'factory')
    await mkdir(factoryDir, { recursive: true })
    const extendedFleetPath = join(factoryDir, 'fleet.yaml')
    await writeFile(extendedFleetPath, [
      fleetYaml.trimEnd(),
      '',
      '  # Test-only extension: seat the K7 packages (no skills declared, none pinned).',
      ...NEW_PACKAGES.map((pkg) => [
        `  - seat: ${pkg.dir}`,
        `    agentTypeId: ${pkg.definitionId}`,
        '    skills: []',
      ].join('\n')),
      '',
    ].join('\n'))

    const result = await loadConfiguredAgentFleet({
      discoveredPackages: discovered,
      workspaceRoot: null,
      fleetConfigPath: extendedFleetPath,
      policyPath: POLICY_PATH,
      skillsRoot: SKILLS_ROOT,
      env: {},
    })

    // Full composition: every definition compiled. With `workspaceRoot:
    // null` each seat legitimately reports the stable "instructions not
    // linkable" diagnostic — the only codes allowed here are exactly that
    // one; no digest mismatches, conflicts, or unseated packages.
    expect(result.diagnostics.length).toBe(RATIFIED_SEATS.length + NEW_PACKAGES.length)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      result.diagnostics.map(() => ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE),
    )
    expect(result.agents.map((agent) => agent.agentTypeId)).toEqual([
      ...RATIFIED_SEATS,
      ...NEW_PACKAGES.map((pkg) => pkg.definitionId),
    ])
    for (const [index, pkg] of NEW_PACKAGES.entries()) {
      const agent = result.agents[RATIFIED_SEATS.length + index]
      if (!agent || 'legacyDefault' in agent) throw new Error(`expected the composed ${pkg.definitionId} spec`)
      // Compilation read THIS package's instructions.md.
      expect(agent.definition.instructions).toContain(pkg.marker)
      // The digest is computed identity, not the version string.
      expect(agent.definition.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
      // The optional knowledge/ folder rides the spec for binding.
      expect(agent.knowledge?.rootDir).toBe(resolve(PERSONAS_ROOT, pkg.dir, 'knowledge'))
    }
  })

  test('against the real fleet.yaml the K7 packages stay discovered-but-inert (AGENT_DEFINITION_UNSEATED)', async () => {
    const result = await loadConfiguredAgentFleet({
      discoveredPackages: await discoverRepositoryPersonas(),
      workspaceRoot: null,
      fleetConfigPath: FLEET_CONFIG_PATH,
      policyPath: POLICY_PATH,
      skillsRoot: SKILLS_ROOT,
      env: {},
    })

    // Only the ratified three-seat roster composes (gh-1187 S0).
    expect(result.agents.map((agent) => agent.agentTypeId)).toEqual([...RATIFIED_SEATS])
    // The new packages are visible as inert, never silently dropped.
    for (const pkg of NEW_PACKAGES) {
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        agentTypeId: pkg.definitionId,
        code: ErrorCode.enum.AGENT_DEFINITION_UNSEATED,
      }))
    }
  })
})
