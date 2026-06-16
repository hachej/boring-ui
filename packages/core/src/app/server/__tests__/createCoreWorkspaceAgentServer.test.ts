import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import {
  createCoreWorkspaceAgentServer,
  resolveCoreLoadConfigOptions,
} from '../createCoreWorkspaceAgentServer.js'

describe('resolveCoreLoadConfigOptions', () => {
  it('defaults to the app-root boring.app.toml when appRoot is provided', () => {
    const appRoot = '/tmp/test-app'

    expect(resolveCoreLoadConfigOptions({ appRoot }, 'development')).toEqual({
      allowMissingSecrets: true,
      tomlPath: resolve(appRoot, 'boring.app.toml'),
    })
  })

  it('does not override an explicit TOML path', () => {
    expect(resolveCoreLoadConfigOptions(
      {
        appRoot: '/tmp/test-app',
        loadConfigOptions: {
          tomlPath: '/tmp/custom.toml',
          allowMissingSecrets: false,
        },
      },
      'development',
    )).toEqual({
      allowMissingSecrets: false,
      tomlPath: '/tmp/custom.toml',
    })
  })
})

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
