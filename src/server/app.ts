/**
 * Fastify application factory — mirrors Python's create_app() pattern.
 *
 * All dependencies are injectable for testing and customization.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { loadConfig, type ServerConfig } from './config.js'

export interface CreateAppOptions {
  config?: ServerConfig
  logger?: boolean
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig()

  const app = Fastify({
    logger: options.logger ?? false,
  })

  // --- Plugins ---
  app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  })

  app.register(cookie)

  // --- Health endpoint ---
  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  })

  // --- Stub capabilities endpoint ---
  // Full implementation in bd-1wkce.1; this is the minimal contract
  app.get('/api/capabilities', async () => {
    return {
      version: '1.0.0',
      features: {},
      routers: [],
      auth: {
        provider: config.controlPlaneProvider,
      },
    }
  })

  return app
}
