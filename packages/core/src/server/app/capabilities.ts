import type { FastifyInstance } from 'fastify'
import type { CapabilitiesResponse, CoreCapabilities } from '../../shared/types.js'
import type { CapabilitiesContributor } from './types.js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let cachedVersion: string | undefined

function getCoreVersion(): string {
  if (cachedVersion) return cachedVersion
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(
      readFileSync(resolve(dir, '../../../../package.json'), 'utf-8'),
    ) as { version: string }
    cachedVersion = pkg.version
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

  const hasMail = !!app.config.auth.mail

  app.registerCapabilitiesContributor('core', () => {
    const core: CoreCapabilities = {
      version: getCoreVersion(),
      features: {
        invitesEnabled: app.config.features.invitesEnabled,
        githubOauth: app.config.features.githubOauth,
        emailFlows: hasMail,
      },
      auth: {
        emailPassword: true,
        github: false,
        emailVerification: hasMail,
        passwordReset: hasMail,
        magicLink: hasMail,
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
