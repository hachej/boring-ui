import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { noopTelemetry } from '../../../shared/telemetry.js'
import {
  createCoreWorkspaceAgentServer,
  registerFrontendAuthPages,
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

  it('fails fast when dynamic auth config is null', async () => {
    await expect(createCoreWorkspaceAgentServer({
      authBaseURL: null as never,
    })).rejects.toThrow(/authBaseURL must be an object/)
  })

  it('fails fast when dynamic auth is configured with a wildcard host', async () => {
    await expect(createCoreWorkspaceAgentServer({
      authBaseURL: {
        allowedHosts: ['*.example.test'],
        protocol: 'https',
      },
    })).rejects.toThrow(/authBaseURL\.allowedHosts/)
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

  it('redirects the legacy /auth/reset-password/:token shape to the SPA query-string route', async () => {
    const appRoot = await mkdtemp(`${tmpdir()}/boring-core-reset-redirect-`)
    await mkdir(resolve(appRoot, 'dist/front'), { recursive: true })
    await writeFile(resolve(appRoot, 'dist/front/index.html'), '<!doctype html><p>spa shell</p>')

    const app = Fastify()
    await registerFrontendAuthPages(app, appRoot, noopTelemetry)

    const response = await app.inject({ method: 'GET', url: '/auth/reset-password/abc123' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/auth/reset-password?token=abc123')
  })

  it('URL-encodes the token when redirecting the legacy reset-password shape', async () => {
    const appRoot = await mkdtemp(`${tmpdir()}/boring-core-reset-redirect-`)
    await mkdir(resolve(appRoot, 'dist/front'), { recursive: true })
    await writeFile(resolve(appRoot, 'dist/front/index.html'), '<!doctype html><p>spa shell</p>')

    const app = Fastify()
    await registerFrontendAuthPages(app, appRoot, noopTelemetry)

    const response = await app.inject({ method: 'GET', url: '/auth/reset-password/a%20b%26c' })
    await app.close()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/auth/reset-password?token=a%20b%26c')
  })
})
