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
  it('shares one provider and one provisioning generation for compatible Agents', async () => {
    const workspaceRoot = await makeRoot()
    const baseAdapter = createTestRuntimeModeAdapter('direct')
    const create = vi.fn(baseAdapter.create.bind(baseAdapter))
    const provisionRuntime = vi.fn(async () => undefined)
    const manager = new EnvironmentLeaseManager({ ...baseAdapter, create })
    const environment = {
      placementIdentity: 'direct:workspace',
      workspaceRoot,
      provisioningFingerprint: 'provider:generation-a',
      provisionRuntime,
    }

    const [alpha, beta] = await Promise.all([
      manager.acquire('workspace-a', environment),
      manager.acquire('workspace-a', environment),
    ])
    expect(alpha.bundle).toBe(beta.bundle)
    expect(create).toHaveBeenCalledOnce()
    expect(provisionRuntime).toHaveBeenCalledOnce()
    alpha.release()
    beta.release()
    await manager.close()
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
