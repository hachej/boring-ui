import { describe, expect, it } from 'vitest'
import type { WorkspaceProvisioner, ProvisionContext, ProvisionResult } from '../types.js'

function createMockProvisioner(): WorkspaceProvisioner {
  const provisioned = new Map<string, ProvisionResult>()

  return {
    async provision(ctx: ProvisionContext): Promise<ProvisionResult> {
      const result: ProvisionResult = {
        volumePath: `/data/workspaces/${ctx.workspaceId}`,
      }
      provisioned.set(ctx.workspaceId, result)
      return result
    },
    async destroy(workspaceId: string): Promise<void> {
      provisioned.delete(workspaceId)
    },
  }
}

describe('WorkspaceProvisioner SPI', () => {
  it('mock provisioner satisfies the interface', async () => {
    const provisioner = createMockProvisioner()

    const result = await provisioner.provision({
      workspaceId: 'ws-1',
      workspaceName: 'Test Workspace',
      ownerId: 'user-1',
      appId: 'app-1',
    })

    expect(result.volumePath).toBe('/data/workspaces/ws-1')
  })

  it('destroy is idempotent', async () => {
    const provisioner = createMockProvisioner()

    await provisioner.destroy('nonexistent')
    await provisioner.destroy('nonexistent')
  })
})
