import type { FastifyPluginAsync } from 'fastify'
import type { GovernanceService, GovernanceUsageSpendReader } from './governanceService.js'

export interface GovernanceRoutesOptions {
  /**
   * Lazily resolves a read-only spend reader (backed by the budget reservation
   * store). Returns undefined when no database is wired, in which case the
   * usage route responds with an empty summary rather than erroring.
   */
  getUsageReader?: () => GovernanceUsageSpendReader | undefined
}

export function governanceRoutes(service: GovernanceService, options: GovernanceRoutesOptions = {}): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/v1/governance/me', async (request) => {
      return service.me(request.user ?? null)
    })

    app.get('/api/v1/governance/usage-summary', async (request) => {
      const user = request.user ?? null
      const reader = options.getUsageReader?.()
      if (!user || !reader) {
        return { enabled: service.isEnabled(), currency: 'EUR' as const, models: [], aggregate: null }
      }
      return service.getUsageSummary({ id: user.id, email: user.email, emailVerified: user.emailVerified }, reader)
    })
  }
}
