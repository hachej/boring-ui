import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { ErrorCode } from '../../../shared/error-codes'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { resolveAgentInstructionFileRefs } from '../instructionFileRefs'
import { LEGACY_DEFAULT_AGENT_FLEET, resolveDefaultAgentFleet } from '../resolveDefaultAgentFleet'
import type { DiscoveredAgentPackageDescriptor } from '../loadConfiguredAgentFleet'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../../..')
const FACTORY_PACKAGES: readonly DiscoveredAgentPackageDescriptor[] = [
  // Ratified roster (gh-1187 S0) plus a discovered-but-deferred seat
  // (concierge) that holds no fleet.yaml entry and must not compose.
  ['concierge', 'boring-concierge', ['feedback', 'triage', 'owner-gate', 'handoff']],
  ['triage', 'boring-triage', ['triage', 'owner-gate', 'handoff']],
  ['orchestrator', 'boring-orchestrator', ['plan', 'feedback', 'owner-gate', 'handoff']],
  ['worker', 'boring-worker', ['exec', 'fresh-eyes', 'owner-gate', 'handoff']],
].map(([seat, definitionId, skills]) => ({
  rootDir: resolve(REPOSITORY_ROOT, '.agents', 'personas', seat as string),
  manifest: {
    boring: { agent: { definitionId: definitionId as string, version: '2026.08.04', instructionsRef: 'instructions.md' } },
    pi: { skills: skills as string[] },
  },
  preflight: { ok: true },
}))

const loggerMocks = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }))
vi.mock('@hachej/boring-bash/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hachej/boring-bash/server')>()
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: loggerMocks.warn, error: loggerMocks.error }),
  }
})

describe('resolveDefaultAgentFleet (BORING_AGENT_FLEET gate, gh-1106 slice 3)', () => {
  afterEach(() => {
    loggerMocks.warn.mockClear()
    loggerMocks.error.mockClear()
  })

  test('flag absent: byte-identical legacy single-default-agent boot', async () => {
    const agents = await resolveDefaultAgentFleet({ repositoryRoot: REPOSITORY_ROOT, env: {} })
    expect(agents).toEqual(LEGACY_DEFAULT_AGENT_FLEET)
    expect(Object.isFrozen(agents)).toBe(true)
  })

  test('flag absent does not access injected discovery descriptors', async () => {
    const options = new Proxy({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: REPOSITORY_ROOT, env: {} }, {
      get(target, property, receiver) {
        if (property === 'discoveredPackages') throw new Error('flag-off must not inspect discovery')
        return Reflect.get(target, property, receiver)
      },
    })
    await expect(resolveDefaultAgentFleet(options)).resolves.toBe(LEGACY_DEFAULT_AGENT_FLEET)
  })

  test('flag=1: composes the default agent plus the repository factory seats', async () => {
    const agents = await resolveDefaultAgentFleet({
      repositoryRoot: REPOSITORY_ROOT,
      discoveredPackages: FACTORY_PACKAGES,
      env: { BORING_AGENT_FLEET: '1', ANTHROPIC_API_KEY: 'test-key' },
    })
    expect(agents[0]).toEqual({ agentTypeId: 'default', legacyDefault: true })
    // The ratified 3-seat roster (gh-1187 S0). Deferred grow-on-demand seats
    // (concierge, reviewer, ...) may still be discovered as packages but hold
    // no fleet.yaml entry, so they must NOT compose.
    expect(agents.slice(1).map((agent) => agent.agentTypeId)).toEqual([
      'boring-triage',
      'boring-orchestrator',
      'boring-worker',
    ])
  })

  test('records absolute persona instruction sources, addressable from any served root', async () => {
    const env = { BORING_AGENT_FLEET: '1', ANTHROPIC_API_KEY: 'test-key' }
    const fleet = await resolveDefaultAgentFleet({
      repositoryRoot: REPOSITORY_ROOT,
      discoveredPackages: FACTORY_PACKAGES,
      env,
    })
    const orchestrator = fleet.find((agent) => agent.agentTypeId === 'boring-orchestrator')
    if (!orchestrator || 'legacyDefault' in orchestrator) throw new Error('expected the orchestrator seat')
    expect(orchestrator.instructionSources).toEqual([{
      absolutePath: resolve(REPOSITORY_ROOT, '.agents', 'personas', 'orchestrator', 'instructions.md'),
      role: 'persona',
    }])

    // gh-1189: composition no longer decides linkability, so the CLI hub — one
    // fleet, a different root per registered workspace — is no longer
    // structurally linkless. The real repository personas address cleanly
    // against a request served from the repository...
    await expect(resolveAgentInstructionFileRefs({
      sources: orchestrator.instructionSources,
      workspaceRoot: REPOSITORY_ROOT,
    })).resolves.toMatchObject({
      refs: [{ filesystem: 'user', path: '.agents/personas/orchestrator/instructions.md', role: 'persona' }],
    })

    // ...and are withheld, not guessed, for a request served from elsewhere.
    const detached = await resolveAgentInstructionFileRefs({
      sources: orchestrator.instructionSources,
      workspaceRoot: tmpdir(),
    })
    expect(detached.refs).toEqual([])
    expect(detached.withheld).toEqual([expect.objectContaining({
      code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE,
    })])

    // Composition itself stays quiet about links: nothing is unlinkable yet.
    expect(loggerMocks.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('instructions'),
      expect.anything(),
    )
  })

  describe('flag=1 with a missing/malformed .agents tree (M4: degrade, do not crash boot)', () => {
    let root: string

    afterEach(async () => {
      if (root) await rm(root, { recursive: true, force: true })
    })

    test('degrades to the legacy default agent and logs a diagnostic', async () => {
      root = await mkdtemp(join(tmpdir(), 'fleet-boot-degrade-'))
      // No .agents/ tree at all under this root.
      const agents = await resolveDefaultAgentFleet({
        repositoryRoot: root,
        discoveredPackages: [],
        env: { BORING_AGENT_FLEET: '1' },
      })
      expect(agents).toEqual(LEGACY_DEFAULT_AGENT_FLEET)
      expect(loggerMocks.error).toHaveBeenCalledTimes(1)
      expect(loggerMocks.error.mock.calls[0]?.[0]).toMatch(/degrading to the legacy default agent/)
    })

    test('degrades on a malformed fleet.yaml too', async () => {
      root = await mkdtemp(join(tmpdir(), 'fleet-boot-degrade-'))
      await mkdir(join(root, '.agents', 'factory'), { recursive: true })
      await writeFile(join(root, '.agents', 'factory', 'fleet.yaml'), 'not: [valid, seats, shape')
      const agents = await resolveDefaultAgentFleet({
        repositoryRoot: root,
        discoveredPackages: [],
        env: { BORING_AGENT_FLEET: '1' },
      })
      expect(agents).toEqual(LEGACY_DEFAULT_AGENT_FLEET)
      expect(loggerMocks.error).toHaveBeenCalledTimes(1)
    })
  })
})
