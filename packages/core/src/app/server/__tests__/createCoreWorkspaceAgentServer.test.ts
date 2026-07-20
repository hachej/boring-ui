import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { noopTelemetry } from '../../../shared/telemetry.js'
import { ERROR_CODES } from '../../../shared/errors.js'
import {
  createCoreWorkspaceAgentServer,
  registerFrontendFallback,
  resolveCoreLoadConfigOptions,
  type CoreFrontendRootHandler,
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
  it('rejects typed declarations plus requestScopeResolver before loading runtime state', async () => {
    await expect(createCoreWorkspaceAgentServer({
      staticProductDeclarations: {
        domains: [{ hostname: 'legal.example', workspaceTypeId: 'contract-review' }],
        workspaceTypes: [{ workspaceTypeId: 'contract-review', agentTypeId: 'legal-reviewer' }],
        agentTypes: [{ agentTypeId: 'legal-reviewer', behavior: {} }],
      },
      requestScopeResolver: async () => undefined,
    })).rejects.toMatchObject({
      code: ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT,
    })
  })

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

  it('preserves root SPA bytes when the optional root handler is absent or declines', async () => {
    const appRoot = await mkdtemp(`${tmpdir()}/boring-core-root-`)
    await mkdir(resolve(appRoot, 'dist/front'), { recursive: true })
    await writeFile(resolve(appRoot, 'dist/front/index.html'), '<!doctype html><p>spa shell</p>')

    const requestPath = async (rootHandler?: CoreFrontendRootHandler, url = '/') => {
      const app = Fastify()
      await registerFrontendFallback(app, appRoot, noopTelemetry, rootHandler)
      const response = await app.inject({ method: 'GET', url })
      await app.close()
      return { body: response.body, contentType: response.headers['content-type'], cache: response.headers['cache-control'] }
    }
    const baseline = await requestPath()
    const declining = vi.fn<CoreFrontendRootHandler>(async () => false)
    expect(await requestPath(declining)).toEqual(baseline)
    expect(declining).toHaveBeenCalledOnce()
    const handling = vi.fn<CoreFrontendRootHandler>(async (_request, reply) => { reply.send('landing'); return true })
    expect((await requestPath(handling)).body).toBe('landing')
    const rootOnly = vi.fn<CoreFrontendRootHandler>(async () => false)
    expect(await requestPath(rootOnly, '/workspace')).toEqual(baseline)
    expect(rootOnly).not.toHaveBeenCalled()
    expect(baseline).toEqual({ body: '<!doctype html><p>spa shell</p>', contentType: 'text/html; charset=utf-8', cache: 'no-store' })
  })
})
