import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { noopTelemetry } from '../../../shared/telemetry.js'
import { ERROR_CODES } from '../../../shared/errors.js'
import type { CoreConfig } from '../../../shared/types.js'
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
  const typedConfig: CoreConfig = {
    appId: 'test-app', appName: 'Test App', appLogo: null, port: 0, host: '127.0.0.1',
    staticDir: null, databaseUrl: 'postgres://not-opened.invalid/test', stores: 'postgres',
    cors: { origins: ['https://legal.products.example', 'https://research.products.example'], credentials: true },
    bodyLimit: 1024, logLevel: 'fatal', encryption: { workspaceSettingsKey: 'a'.repeat(64) },
    auth: {
      secret: 's'.repeat(64), url: 'https://legal.products.example',
      sessionTtlSeconds: 3600, sessionCookieSecure: true,
    },
    features: {
      githubOauth: false, googleOauth: false, invitesEnabled: true,
      sendWelcomeEmail: false, inviteTtlDays: 7,
    },
  }
  const coreProductRouting = {
    domains: [
      { hostname: 'legal.products.example', workspaceTypeId: 'contract-review' },
      { hostname: 'research.products.example', workspaceTypeId: 'research' },
    ],
    workspaceProducts: [
      { workspaceTypeId: 'contract-review', label: 'Legal', allowWorkspaceCreation: true },
      { workspaceTypeId: 'research', label: 'Research', allowWorkspaceCreation: false },
    ],
  } as const

  it('rejects typed routing plus requestScopeResolver before loading runtime state', async () => {
    await expect(createCoreWorkspaceAgentServer({
      coreProductRouting,
      requestScopeResolver: async () => undefined,
    })).rejects.toMatchObject({
      code: ERROR_CODES.TYPED_DOMAIN_LEGACY_SCOPE_CONFLICT,
    })
  })

  it('requires Workspace policy IDs and rejects orphan typed-domain companions before loading runtime state', async () => {
    await expect(createCoreWorkspaceAgentServer({
      coreProductRouting,
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_WORKSPACE_POLICY_TYPE_IDS })

    await expect(createCoreWorkspaceAgentServer({
      workspacePolicyWorkspaceTypeIds: ['contract-review'],
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG })

    await expect(createCoreWorkspaceAgentServer({
      sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.INVALID_PRODUCT_ROUTING_CONFIG })

    await expect(createCoreWorkspaceAgentServer({
      config: typedConfig,
      coreProductRouting,
      workspacePolicyWorkspaceTypeIds: ['contract-review'],
      sharedAuthCookieDomain: 'products.example',
    })).rejects.toMatchObject({ code: ERROR_CODES.PRODUCT_WORKSPACE_POLICY_MISMATCH })
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
