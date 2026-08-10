import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { ErrorCode } from '../../../shared/error-codes'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { LEGACY_DEFAULT_AGENT_FLEET, resolveDefaultAgentFleet } from '../resolveDefaultAgentFleet'
import type { DiscoveredAgentPackageDescriptor } from '../loadConfiguredAgentFleet'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../../..')
const FACTORY_PACKAGES: readonly DiscoveredAgentPackageDescriptor[] = [
  ['concierge', 'boring-concierge', ['feedback', 'triage', 'handoff']],
  ['triage', 'boring-triage', ['triage', 'handoff']],
  ['steward', 'boring-steward', ['plan', 'handoff']],
  ['worker', 'boring-worker', ['exec', 'handoff']],
  ['reviewer', 'boring-reviewer', ['fresh-eyes', 'handoff']],
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
    const agents = await resolveDefaultAgentFleet({ repositoryRoot: REPOSITORY_ROOT, workspaceRoot: REPOSITORY_ROOT, env: {} })
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
      workspaceRoot: REPOSITORY_ROOT,
      env: { BORING_AGENT_FLEET: '1', ANTHROPIC_API_KEY: 'test-key' },
    })
    expect(agents[0]).toEqual({ agentTypeId: 'default', legacyDefault: true })
    expect(agents.slice(1).map((agent) => agent.agentTypeId)).toEqual([
      'boring-concierge',
      'boring-triage',
      'boring-steward',
      'boring-worker',
      'boring-reviewer',
    ])
  })

  test('links persona instructions only when the served workspace IS the fleet repository', async () => {
    const env = { BORING_AGENT_FLEET: '1', ANTHROPIC_API_KEY: 'test-key' }
    const sameRoot = await resolveDefaultAgentFleet({
      repositoryRoot: REPOSITORY_ROOT,
      discoveredPackages: FACTORY_PACKAGES,
      workspaceRoot: REPOSITORY_ROOT,
      env,
    })
    const concierge = sameRoot.find((agent) => agent.agentTypeId === 'boring-concierge')
    if (!concierge || 'legacyDefault' in concierge) throw new Error('expected the concierge seat')
    expect(concierge.instructionFiles).toEqual([
      { filesystem: 'user', path: '.agents/personas/concierge/instructions.md', role: 'persona' },
    ])

    // The multi-workspace shape: personas come from the repository, the
    // `user` filesystem serves somewhere else entirely. Publishing a
    // repository-relative path here would render a live "Open" button that
    // opens nothing, so nothing is published.
    const otherRoot = await resolveDefaultAgentFleet({
      repositoryRoot: REPOSITORY_ROOT,
      discoveredPackages: FACTORY_PACKAGES,
      workspaceRoot: tmpdir(),
      env,
    })
    const detached = otherRoot.find((agent) => agent.agentTypeId === 'boring-concierge')
    if (!detached || 'legacyDefault' in detached) throw new Error('expected the concierge seat')
    expect(detached.instructionFiles).toBeUndefined()
    // Reported as a missing LINK, not an excluded seat: the seat is right
    // there in the fleet above.
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'fleet seat instructions not linkable',
      expect.objectContaining({ code: ErrorCode.enum.AGENT_FLEET_SEAT_INSTRUCTIONS_PATH_UNPUBLISHABLE }),
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
        workspaceRoot: root,
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
        workspaceRoot: root,
        env: { BORING_AGENT_FLEET: '1' },
      })
      expect(agents).toEqual(LEGACY_DEFAULT_AGENT_FLEET)
      expect(loggerMocks.error).toHaveBeenCalledTimes(1)
    })
  })
})
