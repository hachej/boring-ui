import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '@hachej/boring-agent/shared'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type { SandboxProviderV1 } from '../../shared/providerV1'
import { createBwrapSandboxProvider } from '../bwrap/createBwrapProvider'
import { createDirectSandboxProvider } from '../direct/createDirectProvider'
import { createVercelSandboxProvider } from '../vercel-sandbox/createVercelSandboxProvider'
import type { VercelSandboxClient } from '../vercel-sandbox/resolveSandboxHandle'
import { providerPairConformance } from './conformance/providerPair'
import { sandboxConformance } from './conformance/sandbox'
import { workspaceConformance } from './conformance/workspace'
import { createMockVercelSandboxHarness } from './mockVercelSandbox'

const TARGET = 'boring-sandbox-package'
type ProviderCase = 'direct' | 'bwrap' | 'vercel-sandbox'

interface TargetHarness {
  provider: SandboxProviderV1
  acquisitionCount?: () => number
  closeCount?: () => number
  cleanup(): Promise<void>
}

class MemoryHandleStore implements SandboxHandleStore {
  private readonly records = new Map<string, SandboxHandleRecord>()

  async get(workspaceId: string): Promise<SandboxHandleRecord | null> {
    return this.records.get(workspaceId) ?? null
  }

  async put(record: SandboxHandleRecord): Promise<void> {
    this.records.set(record.workspaceId, record)
  }

  async delete(workspaceId: string): Promise<void> {
    this.records.delete(workspaceId)
  }

  async list(): Promise<SandboxHandleRecord[]> {
    return [...this.records.values()]
  }
}

async function makeVercelHarness(): Promise<TargetHarness> {
  const mock = await createMockVercelSandboxHarness()
  const handle = Object.assign(mock.sandbox, {
    sandboxId: `sandbox-${TARGET}`,
    name: `workspace-${TARGET}`,
    persistent: true,
  })
  let acquisitions = 0
  const client: VercelSandboxClient = {
    async create() {
      acquisitions += 1
      return handle
    },
    async get() {
      acquisitions += 1
      return handle
    },
  }
  const store = new MemoryHandleStore()
  const shutdown = vi.fn(async () => {})
  const snapshotScheduler = {
    trackWorkspace() {},
    markDirty() {},
    stopWorkspace() {},
    shutdown,
  }

  return {
    provider: createVercelSandboxProvider({
      store,
      vercelClient: client,
      getEnvVar: (name) => ({
        VERCEL_OIDC_TOKEN: 'test-token',
        VERCEL_TEAM_ID: 'test-team',
      })[name],
      orphanGuardMaxIdleMs: null,
      snapshotScheduler,
    }),
    acquisitionCount: () => acquisitions,
    closeCount: () => shutdown.mock.calls.length,
    cleanup: mock.cleanup,
  }
}

async function makeHarness(providerCase: ProviderCase): Promise<TargetHarness> {
  if (providerCase === 'vercel-sandbox') return await makeVercelHarness()
  return {
    provider: providerCase === 'direct'
      ? createDirectSandboxProvider()
      : createBwrapSandboxProvider(),
    async cleanup() {},
  }
}

const bwrapAvailable = process.platform === 'linux'
  && (() => {
    const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
    return !result.error && result.status === 0
  })()

async function makeConformanceHarness(providerCase: ProviderCase) {
  const targetHarness = await makeHarness(providerCase)
  const workspaceRoot = await mkdtemp(join(
    tmpdir(),
    `boring-sandbox-conformance-${TARGET}-${providerCase}-`,
  ))
  const context = {
    workspaceRoot,
    workspaceId: `${providerCase}-${TARGET}-${workspaceRoot}`,
    sessionId: 'session-conformance',
  }
  const pair = await targetHarness.provider.create(context)
  return {
    provider: targetHarness.provider,
    context,
    pair,
    async cleanup() {
      await pair.dispose()
      await targetHarness.cleanup()
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

async function makeProviderConformanceHarness(providerCase: ProviderCase) {
  const targetHarness = await makeHarness(providerCase)
  const workspaceRoot = await mkdtemp(join(
    tmpdir(),
    `boring-sandbox-provider-${TARGET}-${providerCase}-`,
  ))
  return {
    provider: targetHarness.provider,
    context: {
      workspaceRoot,
      workspaceId: `${providerCase}-${TARGET}-${workspaceRoot}`,
      sessionId: 'session-provider-conformance',
    },
    async cleanup() {
      await targetHarness.cleanup()
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

for (const providerCase of ['direct', 'bwrap', 'vercel-sandbox'] as const) {
  const id = `${TARGET}:${providerCase}`
  const skip = providerCase === 'bwrap' && !bwrapAvailable
  const skipReason = skip ? 'bubblewrap is unavailable on this runner' : undefined

  providerPairConformance(id, async () => {
    return await makeProviderConformanceHarness(providerCase)
  }, {
    expectProvisioning: providerCase === 'vercel-sandbox',
    skip,
    skipReason,
  })

  if (!skip) {
    workspaceConformance(`${id}:pair`, async () => {
      const harness = await makeConformanceHarness(providerCase)
      return {
        workspace: harness.pair.workspace,
        cleanup: harness.cleanup,
      }
    })
  }

  if (providerCase !== 'vercel-sandbox') {
    sandboxConformance(`${id}:pair`, async () => {
      const harness = await makeConformanceHarness(providerCase)
      return {
        workspace: harness.pair.workspace,
        sandbox: harness.pair.sandbox,
        cleanup: harness.cleanup,
      }
    }, { skip, skipReason })
  }
}

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true })
  }))
})

describe(`${TARGET} target`, () => {
  describe.each<ProviderCase>(['direct', 'bwrap', 'vercel-sandbox'])('%s provider', (providerCase) => {
    test.skipIf(providerCase === 'bwrap' && !bwrapAvailable)(
      'passes the shared pair/workspace/exec/lifecycle conformance',
      async () => {
        const harness = await makeHarness(providerCase)
        const workspaceRoot = await mkdtemp(join(tmpdir(), `boring-sandbox-parity-${TARGET}-`))
        tempDirs.push(workspaceRoot)
        const context = {
          workspaceRoot,
          workspaceId: `${providerCase}-${TARGET}-${Date.now()}`,
          sessionId: 'session-parity',
        }

        expect(harness.provider.contractVersion).toBe(PROVIDER_CONTRACT_VERSION)
        expect(harness.provider.providerId).toBe(providerCase)
        expect(harness.provider.resolveRuntimeRoot(context)).toBe(
          providerCase === 'direct' ? workspaceRoot : '/workspace',
        )

        const pair = await harness.provider.create(context)
        expect(pair.workspace.runtimeContext.runtimeCwd).toBe(
          pair.sandbox.runtimeContext.runtimeCwd,
        )

        await pair.workspace.writeFile('parity.txt', `${TARGET}:${providerCase}`)
        await expect(pair.workspace.readFile('parity.txt')).resolves.toBe(
          `${TARGET}:${providerCase}`,
        )
        const execResult = await pair.sandbox.exec('echo parity-ok')
        expect(Buffer.from(execResult.stdout).toString('utf8')).toContain('parity-ok')
        expect(execResult.exitCode).toBe(0)

        if (providerCase === 'vercel-sandbox') {
          expect(pair.provisioning).toBeDefined()
          await expect(pair.provisioning!.workspaceFs.exists('../escape'))
            .rejects.toThrow('Path escapes workspace root')
          const provisionResult = await pair.provisioning!.exec('echo', ['provisioning-ok'])
          expect(provisionResult?.stdout).toContain('provisioning-ok')
          expect(pair.provisioning!.getRuntimeCacheRoot()).toBe('/tmp/boring-agent-cache')
          const installSourceRoot = await mkdtemp(join(
            tmpdir(),
            `boring-sandbox-parity-source-${TARGET}-`,
          ))
          tempDirs.push(installSourceRoot)
          await writeFile(join(installSourceRoot, 'fixture.py'), 'VALUE = 1\n', 'utf8')
          const installSource = await pair.provisioning!.resolveInstallSource(
            installSourceRoot,
            {
              kind: 'python',
              id: 'parity-fixture',
              fingerprint: 'sha256:parity123',
            },
          )
          expect(installSource).toBe(
            '/workspace/.boring-agent/tmp/parity-fixture-v1-parity123.tar.gz',
          )
          await expect(pair.workspace.stat(
            '.boring-agent/tmp/parity-fixture-v1-parity123.tar.gz',
          )).resolves.toMatchObject({ kind: 'file' })
          await expect(pair.provisioning!.exec('exit', ['7']))
            .rejects.toThrow('Command failed (exit)')
          expect(harness.acquisitionCount?.()).toBe(1)
          await expect(pair.checkHealth?.()).resolves.toEqual({ state: 'ok' })
        }

        await pair.dispose()
        await pair.dispose()
        await harness.provider.close?.()
        await harness.provider.close?.()
        if (providerCase === 'vercel-sandbox') {
          expect(harness.closeCount?.()).toBe(2)
        }
        await harness.cleanup()
      },
      30_000,
    )
  })
})
