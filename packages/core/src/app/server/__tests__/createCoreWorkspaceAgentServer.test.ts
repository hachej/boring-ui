import { describe, expect, it } from 'vitest'
import { createCoreWorkspaceAgentServer } from '../createCoreWorkspaceAgentServer.js'

describe('createCoreWorkspaceAgentServer', () => {
  it('fails fast when core app hot reload is requested', async () => {
    await expect(createCoreWorkspaceAgentServer({ hotReload: true as false })).rejects.toThrow(
      /does not support hotReload/,
    )
  })

  it('fails fast when a core directory plugin requests hot reload', async () => {
    await expect(createCoreWorkspaceAgentServer({
      plugins: [{ dir: '/tmp/core-plugin', hotReload: true as false }],
    })).rejects.toThrow(/directory plugin entries must omit hotReload or set hotReload: false/)
  })
})
