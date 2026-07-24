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
