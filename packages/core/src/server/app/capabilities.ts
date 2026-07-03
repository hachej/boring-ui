import type { FastifyInstance } from 'fastify'
import type { CapabilitiesResponse, CoreCapabilities } from '../../shared/types.js'
import type { CapabilitiesContributor } from './types.js'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCoreEmailVerificationEnabled } from '../../shared/authPolicy.js'
import { isGoogleOauthUsable } from '../config/loadConfig.js'

let cachedVersion: string | undefined

function readCorePackageVersion(startDir: string): string | undefined {
  let dir = startDir

  while (true) {
    const pkgPath = resolve(dir, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
        name?: string
        version?: string
      }
      if (pkg.name === '@hachej/boring-core' && typeof pkg.version === 'string') {
        return pkg.version
      }
    }

    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function getCoreVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    cachedVersion = readCorePackageVersion(dir) ?? '0.0.0'
  } catch {
    cachedVersion = '0.0.0'
  }
  return cachedVersion
}

export function registerCapabilities(app: FastifyInstance) {
  const contributors = new Map<string, CapabilitiesContributor>()

  app.decorate('capabilitiesCache', null)

  app.decorate(
    'registerCapabilitiesContributor',
    function (name: string, fn: CapabilitiesContributor) {
      contributors.set(name, fn)
    },
  )

  const emailVerificationEnabled = isCoreEmailVerificationEnabled(app.config)

  app.registerCapabilitiesContributor('core', () => {
    const googleOauth = isGoogleOauthUsable(app.config)
    const core: CoreCapabilities = {
      version: getCoreVersion(),
      features: {
        invitesEnabled: app.config.features.invitesEnabled,
        githubOauth: app.config.features.githubOauth,
        googleOauth,
        emailFlows: emailVerificationEnabled,
      },
      auth: {
        emailPassword: true,
        github: false,
        google: googleOauth,
        emailVerification: emailVerificationEnabled,
        passwordReset: emailVerificationEnabled,
        magicLink: emailVerificationEnabled,
      },
    }
    return { core }
  })

  app.addHook('onReady', async () => {
    const result: Record<string, unknown> = {}
    for (const [name, fn] of contributors) {
      const partial = await fn({ config: app.config })
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) {
          result[key] = value
        }
      }
    }
    app.capabilitiesCache = result as CapabilitiesResponse
  })

  app.get('/api/v1/capabilities', async () => {
    return app.capabilitiesCache
  })
}
