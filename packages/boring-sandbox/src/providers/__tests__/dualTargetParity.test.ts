import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from '@hachej/boring-agent/shared'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createBwrapSandbox as createAgentBwrapSandbox } from '../../../../agent/src/server/sandbox/bwrap/createBwrapSandbox'
import { createDirectSandbox as createAgentDirectSandbox } from '../../../../agent/src/server/sandbox/direct/createDirectSandbox'
import { createVercelSandboxModeAdapter } from '../../../../agent/src/server/runtime/modes/vercel-sandbox'
import { createNodeWorkspace as createAgentNodeWorkspace } from '../../../../agent/src/server/workspace/createNodeWorkspace'
import { getBoringAgentRuntimePaths as getAgentRuntimePaths } from '../../../../boring-bash/src/agent/runtime/runtimeLayout'
import { PROVIDER_CAPABILITIES, PROVIDER_CONTRACT_VERSION } from '../../shared/providerMatrix'
import type {
  SandboxProviderV1,
  SandboxProvisioningOperationsV1,
  WorkspaceSandboxPairV1,
} from '../../shared/providerV1'
import { createBwrapSandboxProvider } from '../bwrap/createBwrapProvider'
import { createDirectSandboxProvider } from '../direct/createDirectProvider'
import { createVercelSandboxProvider } from '../vercel-sandbox/createVercelSandboxProvider'
import type { VercelSandboxClient } from '../vercel-sandbox/resolveSandboxHandle'
import { providerPairConformance } from './conformance/providerPair'
import { sandboxConformance } from './conformance/sandbox'
import { workspaceConformance } from './conformance/workspace'
import { createMockVercelSandboxHarness } from './mockVercelSandbox'

type Target = 'agent-original' | 'boring-sandbox-copy'
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

function wrapAgentLocalProvider(providerCase: 'direct' | 'bwrap'): SandboxProviderV1 {
  return {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: providerCase,
    capabilities: PROVIDER_CAPABILITIES[providerCase],
    resolveRuntimeRoot(context) {
      return providerCase === 'direct' ? context.workspaceRoot : '/workspace'
    },
    async create(context): Promise<WorkspaceSandboxPairV1> {
      await mkdir(context.workspaceRoot, { recursive: true })
      const runtimeContext = {
        runtimeCwd: providerCase === 'direct' ? context.workspaceRoot : '/workspace',
      }
      const workspace = createAgentNodeWorkspace(context.workspaceRoot, { runtimeContext })
      const sandbox = providerCase === 'direct'
        ? createAgentDirectSandbox({ runtimeContext })
        : createAgentBwrapSandbox({
            hostWorkspaceRoot: context.workspaceRoot,
            runtimeContext,
          })
      await sandbox.init?.({ workspace, sessionId: context.sessionId })

      let disposed = false
      return {
        workspace,
        sandbox,
        async dispose() {
          if (disposed) return
          disposed = true
          workspace.watch?.().close()
          await sandbox.dispose?.()
        },
      }
    },
  }
}

async function makeVercelHarness(target: Target): Promise<TargetHarness> {
  const mock = await createMockVercelSandboxHarness()
  const handle = Object.assign(mock.sandbox, {
    sandboxId: `sandbox-${target}`,
    name: `workspace-${target}`,
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
  const getEnvVar = (name: string): string | undefined => ({
    VERCEL_OIDC_TOKEN: 'test-token',
    VERCEL_TEAM_ID: 'test-team',
  })[name]
  const shutdown = vi.fn(async () => {})
  const snapshotScheduler = {
    trackWorkspace() {},
    markDirty() {},
    stopWorkspace() {},
    shutdown,
  }

  if (target === 'boring-sandbox-copy') {
    return {
      provider: createVercelSandboxProvider({
        store,
        vercelClient: client,
        getEnvVar,
        orphanGuardMaxIdleMs: null,
        snapshotScheduler,
      }),
      acquisitionCount: () => acquisitions,
      closeCount: () => shutdown.mock.calls.length,
      cleanup: mock.cleanup,
    }
  }

  const adapter = createVercelSandboxModeAdapter({
    store,
    vercelClient: client,
    getEnvVar,
    orphanGuardMaxIdleMs: null,
    snapshotScheduler,
  })
  const provider: SandboxProviderV1 = {
    contractVersion: PROVIDER_CONTRACT_VERSION,
    providerId: 'vercel-sandbox',
    capabilities: PROVIDER_CAPABILITIES['vercel-sandbox'],
    resolveRuntimeRoot() { return '/workspace' },
    invalidate({ workspaceId }) { adapter.evictCachedRuntime?.({ workspaceId }) },
    async close() { await adapter.dispose?.() },
    async create(context) {
      const bundle = await adapter.create(context)
      const provisioning: SandboxProvisioningOperationsV1 | undefined =
        adapter.createProvisioningAdapter?.(
        getAgentRuntimePaths('/workspace'),
        context,
      )
      let disposed = false
      return {
        workspace: bundle.workspace,
        sandbox: bundle.sandbox,
        provisioning,
        async checkHealth() {
          return await adapter.cachedBindingHealthCheck!.check({
            runtimeBundle: bundle,
            workspaceId: context.workspaceId ?? context.workspaceRoot,
          })
        },
        async dispose() {
          if (disposed) return
          disposed = true
          bundle.workspace.watch?.().close()
          await bundle.sandbox.dispose?.()
        },
      }
    },
  }

  return {
    provider,
    acquisitionCount: () => acquisitions,
    closeCount: () => shutdown.mock.calls.length,
    cleanup: mock.cleanup,
  }
}

async function makeHarness(
  target: Target,
  providerCase: ProviderCase,
): Promise<TargetHarness> {
  if (providerCase === 'vercel-sandbox') return await makeVercelHarness(target)
  return {
    provider: target === 'agent-original'
      ? wrapAgentLocalProvider(providerCase)
      : providerCase === 'direct'
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

async function makeConformanceHarness(
  target: Target,
  providerCase: ProviderCase,
) {
  const targetHarness = await makeHarness(target, providerCase)
  const workspaceRoot = await mkdtemp(join(
    tmpdir(),
    `boring-sandbox-conformance-${target}-${providerCase}-`,
  ))
  const context = {
    workspaceRoot,
    workspaceId: `${providerCase}-${target}-${workspaceRoot}`,
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

async function makeProviderConformanceHarness(
  target: Target,
  providerCase: ProviderCase,
) {
  const targetHarness = await makeHarness(target, providerCase)
  const workspaceRoot = await mkdtemp(join(
    tmpdir(),
    `boring-sandbox-provider-${target}-${providerCase}-`,
  ))
  return {
    provider: targetHarness.provider,
    context: {
      workspaceRoot,
      workspaceId: `${providerCase}-${target}-${workspaceRoot}`,
      sessionId: 'session-provider-conformance',
    },
    async cleanup() {
      await targetHarness.cleanup()
      await rm(workspaceRoot, { recursive: true, force: true })
    },
  }
}

for (const target of ['agent-original', 'boring-sandbox-copy'] as const) {
  for (const providerCase of ['direct', 'bwrap', 'vercel-sandbox'] as const) {
    const id = `${target}:${providerCase}`
    const skip = providerCase === 'bwrap' && !bwrapAvailable
    const skipReason = skip ? 'bubblewrap is unavailable on this runner' : undefined

    providerPairConformance(id, async () => {
      return await makeProviderConformanceHarness(target, providerCase)
    }, {
      expectProvisioning: providerCase === 'vercel-sandbox',
      skip,
      skipReason,
    })

    if (!skip) {
      workspaceConformance(`${id}:pair`, async () => {
        const harness = await makeConformanceHarness(target, providerCase)
        return {
          workspace: harness.pair.workspace,
          cleanup: harness.cleanup,
        }
      })
    }

    if (providerCase !== 'vercel-sandbox') {
      sandboxConformance(`${id}:pair`, async () => {
        const harness = await makeConformanceHarness(target, providerCase)
        return {
          workspace: harness.pair.workspace,
          sandbox: harness.pair.sandbox,
          cleanup: harness.cleanup,
        }
      }, { skip, skipReason })
    }
  }
}

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true })
  }))
})

describe.each<Target>(['agent-original', 'boring-sandbox-copy'])('%s target', (target) => {
  describe.each<ProviderCase>(['direct', 'bwrap', 'vercel-sandbox'])('%s provider', (providerCase) => {
    test.skipIf(providerCase === 'bwrap' && !bwrapAvailable)(
      'passes the shared pair/workspace/exec/lifecycle conformance',
      async () => {
        const harness = await makeHarness(target, providerCase)
        const workspaceRoot = await mkdtemp(join(tmpdir(), `boring-sandbox-parity-${target}-`))
        tempDirs.push(workspaceRoot)
        const context = {
          workspaceRoot,
          workspaceId: `${providerCase}-${target}-${Date.now()}`,
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

        await pair.workspace.writeFile('parity.txt', `${target}:${providerCase}`)
        await expect(pair.workspace.readFile('parity.txt')).resolves.toBe(
          `${target}:${providerCase}`,
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
          expect(pair.provisioning!.getRuntimeCacheRoot()).toBe(
            '/tmp/boring-agent-cache',
          )
          const installSourceRoot = await mkdtemp(join(
            tmpdir(),
            `boring-sandbox-parity-source-${target}-`,
          ))
          tempDirs.push(installSourceRoot)
          await writeFile(
            join(installSourceRoot, 'fixture.py'),
            'VALUE = 1\n',
            'utf8',
          )
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
