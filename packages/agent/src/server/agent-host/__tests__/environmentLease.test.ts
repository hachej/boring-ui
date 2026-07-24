import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGatewayErrorCode } from '../../../shared/index'
import { createTestRuntimeModeAdapter } from '@agent-test-host'
import { EnvironmentLeaseManager } from '../environmentLease'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function makeRoot() {
  const value = await mkdtemp(join(tmpdir(), 'environment-lease-'))
  roots.push(value)
  return value
}

function deferred<T>() {
  let resolve!: (value?: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = (value) => resolvePromise(value as T | PromiseLike<T>)
  })
  return { promise, resolve }
}

describe('EnvironmentLeaseManager', () => {
  it.each(['direct', 'local', 'vercel-sandbox'] as const)(
    'shares writes and one immutable provisioning snapshot in %s shape without cloud access',
    async (mode) => {
      const workspaceRoot = await makeRoot()
      // The Vercel case intentionally qualifies the provider shape while using
      // direct in-memory/local bytes: this is a Host lease test, not a cloud SDK test.
      const backingMode = mode === 'vercel-sandbox' ? 'direct' : mode
      const baseAdapter = createTestRuntimeModeAdapter(backingMode)
      const create = vi.fn(baseAdapter.create.bind(baseAdapter))
      const mutableResult = {
        changed: true,
        env: { GENERATION: 'a' },
        pathEntries: ['/generation-a/bin'],
        skillPaths: ['/generation-a/SKILL.md'],
      }
      const provisionRuntime = vi.fn(async () => mutableResult)
      const manager = new EnvironmentLeaseManager({ ...baseAdapter, id: mode, create })
      const environment = {
        placementIdentity: mode === 'vercel-sandbox'
          ? 'vercel:deployment-a:revision-a:workspace'
          : `${mode}:workspace`,
        workspaceRoot,
        provisioningFingerprint: 'provider:generation-a',
        provisionRuntime,
      }

      const [alpha, beta] = await Promise.all([
        manager.acquire('workspace-a', environment),
        manager.acquire('workspace-a', environment),
      ])
      expect(alpha.bundle).toBe(beta.bundle)
      expect(alpha.provisioning).toBe(beta.provisioning)
      expect(create).toHaveBeenCalledOnce()
      expect(provisionRuntime).toHaveBeenCalledOnce()
      await alpha.bundle.workspace.writeFile('shared.txt', `shared:${mode}`)
      expect(await beta.bundle.workspace.readFile('shared.txt')).toBe(`shared:${mode}`)
      mutableResult.env.GENERATION = 'mutated'
      mutableResult.pathEntries.push('/mutated')
      expect(alpha.provisioning).toEqual({
        changed: true,
        env: { GENERATION: 'a' },
        pathEntries: ['/generation-a/bin'],
        skillPaths: ['/generation-a/SKILL.md'],
      })
      expect(Object.isFrozen(alpha.provisioning)).toBe(true)
      expect(Object.isFrozen(alpha.provisioning?.env)).toBe(true)
      expect(Object.isFrozen(alpha.provisioning?.pathEntries)).toBe(true)
      alpha.release()
      beta.release()
      await manager.close()
    },
  )

  it('reloads only after the final old-generation lease retires', async () => {
    const workspaceRoot = await makeRoot()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const disposeRuntime = vi.fn(async () => {})
    const create = vi.fn(async (ctx) => ({ ...await baseAdapter.create(ctx), disposeRuntime }))
    const provisionRuntime = vi.fn(async () => ({ changed: false, env: {}, pathEntries: [], skillPaths: [] }))
    const manager = new EnvironmentLeaseManager({ ...baseAdapter, create })
    const generation = (fingerprint: string) => ({
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: fingerprint,
      provisionRuntime,
    })
    const [alpha, beta] = await Promise.all([
      manager.acquire('workspace-a', generation('generation-a')),
      manager.acquire('workspace-a', generation('generation-a')),
    ])

    await alpha.retire()
    expect(disposeRuntime).not.toHaveBeenCalled()
    await expect(manager.acquire('workspace-a', generation('generation-b'))).rejects.toMatchObject({
      code: AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE,
    })
    await beta.retire()
    expect(disposeRuntime).toHaveBeenCalledOnce()

    const reloaded = await manager.acquire('workspace-a', generation('generation-b'))
    expect(create).toHaveBeenCalledTimes(2)
    expect(provisionRuntime).toHaveBeenCalledTimes(2)
    reloaded.release()
    await manager.close()
    expect(disposeRuntime).toHaveBeenCalledTimes(2)
  })

  it('bounds close while adapter creation is pending and owns late teardown exactly once', async () => {
    const workspaceRoot = await makeRoot()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const createStarted = deferred<void>()
    const releaseCreate = deferred<void>()
    const disposeRuntime = vi.fn(async () => {})
    const manager = new EnvironmentLeaseManager({
      ...baseAdapter,
      async create(ctx) {
        createStarted.resolve()
        await releaseCreate.promise
        const bundle = await baseAdapter.create(ctx)
        return { ...bundle, disposeRuntime }
      },
    })
    const acquisition = manager.acquire('workspace-a', {
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: 'generation-a',
    })
    acquisition.catch(() => {})
    await createStarted.promise

    const before = Date.now()
    await Promise.all([manager.close(10), manager.close(10)])
    expect(Date.now() - before).toBeLessThan(250)

    releaseCreate.resolve()
    await expect(acquisition).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
    await vi.waitFor(() => expect(disposeRuntime).toHaveBeenCalledOnce())
    await manager.close(10)
    expect(disposeRuntime).toHaveBeenCalledOnce()
  })

  it('aborts and detaches pending provisioning, then disposes its late bundle once', async () => {
    const workspaceRoot = await makeRoot()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const provisionStarted = deferred<AbortSignal>()
    const releaseProvision = deferred<void>()
    const disposeRuntime = vi.fn(async () => {})
    const manager = new EnvironmentLeaseManager({
      ...baseAdapter,
      async create(ctx) {
        const bundle = await baseAdapter.create(ctx)
        return { ...bundle, disposeRuntime }
      },
    })
    const acquisition = manager.acquire('workspace-a', {
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: 'generation-a',
      async provisionRuntime({ signal }) {
        provisionStarted.resolve(signal)
        await releaseProvision.promise
      },
    })
    acquisition.catch(() => {})
    const signal = await provisionStarted.promise

    const before = Date.now()
    await manager.close(10)
    expect(Date.now() - before).toBeLessThan(250)
    expect(signal.aborted).toBe(true)

    releaseProvision.resolve()
    await expect(acquisition).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED })
    await vi.waitFor(() => expect(disposeRuntime).toHaveBeenCalledOnce())
    await manager.close(10)
    expect(disposeRuntime).toHaveBeenCalledOnce()
  })

  it('rejects an incompatible fingerprint without creating or mutating a second provider', async () => {
    const workspaceRoot = await makeRoot()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const create = vi.fn(baseAdapter.create.bind(baseAdapter))
    const manager = new EnvironmentLeaseManager({ ...baseAdapter, create })
    const alpha = await manager.acquire('workspace-a', {
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: 'generation-a',
    })
    await expect(manager.acquire('workspace-a', {
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: 'generation-b',
    })).rejects.toMatchObject({ code: AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE })
    expect(create).toHaveBeenCalledOnce()
    alpha.release()
    await manager.close()
  })
})
