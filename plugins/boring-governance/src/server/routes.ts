import type { FastifyPluginAsync } from 'fastify'
import type { GovernanceService } from './governanceService.js'

export function governanceRoutes(service: GovernanceService): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/v1/governance/me', async (request) => {
      return service.me(request.user ?? null)
    })
  }
}
