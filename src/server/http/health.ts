/**
 * Health check HTTP routes.
 */
import type { FastifyInstance } from 'fastify'

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))
}
