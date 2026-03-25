/**
 * Fastify application factory — mirrors Python's create_app() pattern.
 *
 * All dependencies are injectable for testing and customization.
 */
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { loadConfig, type ServerConfig } from './config.js'
import { registerWorkspaceRoutes } from './http/workspaceRoutes.js'
import { registerFileRoutes } from './http/fileRoutes.js'
import { registerGitRoutes } from './http/gitRoutes.js'
import { registerExecRoutes } from './http/execRoutes.js'
import { registerMeRoutes } from './http/meRoutes.js'
import { buildCapabilitiesResponse } from './services/capabilitiesImpl.js'

// Extend Fastify types to include our custom properties
declare module 'fastify' {
  interface FastifyRequest {
    sessionUserId?: string
    sessionEmail?: string
  }
  interface FastifyInstance {
    config: ServerConfig
  }
}

export interface CreateAppOptions {
  config?: ServerConfig
  logger?: boolean
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig()

  const app = Fastify({
    logger: options.logger ?? false,
  })

  // Store config on app instance for route access
  app.decorate('config', config)

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

  // --- Capabilities endpoint (abstract vocabulary) ---
  app.get('/api/capabilities', async () => {
    return buildCapabilitiesResponse(config)
  })

  // --- File routes ---
  app.register(registerFileRoutes, { prefix: '/api/v1' })

  // --- Git routes ---
  app.register(registerGitRoutes, { prefix: '/api/v1' })

  // --- Exec routes ---
  app.register(registerExecRoutes, { prefix: '/api/v1' })

  // --- User identity routes (require auth) ---
  app.register(registerMeRoutes, { prefix: '/api/v1' })

  // --- Workspace routes (require auth) ---
  app.register(registerWorkspaceRoutes, { prefix: '/api/v1' })

  return app
}
