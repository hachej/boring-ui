/**
 * Health, capabilities, and config HTTP routes.
 *
 * Phase 1: Python-compatible response shapes for smoke parity.
 * These endpoints are public (no auth required) and boot-critical.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import {
  buildPythonCompatCapabilities,
  buildEnabledFeatures,
} from '../services/pythonCompatCapabilities.js'
import { buildRuntimeConfigPayload } from '../services/runtimeConfig.js'

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  const config = app.config

  // --- GET /health ---
  // Python-compat: returns { status, workspace, features }
  app.get('/health', async () => {
    return {
      status: 'ok',
      workspace: config.workspaceRoot,
      features: buildEnabledFeatures(config),
    }
  })

  // --- GET /healthz ---
  // Operational health with correlation ID and component checks.
  app.get('/healthz', async (request: FastifyRequest) => {
    const requestId =
      (request.headers['x-request-id'] as string) || randomUUID()

    return {
      status: 'ok',
      request_id: requestId,
      checks: {
        api: 'ok',
        pi: 'disabled', // PI sidecar not yet ported
      },
      workspace: config.workspaceRoot,
    }
  })

  // --- GET /api/capabilities ---
  // Python-compat: legacy feature names (files, git, pty, chat_claude_code).
  app.get('/api/capabilities', async () => {
    return buildPythonCompatCapabilities(config)
  })

  // --- GET /__bui/config ---
  // Runtime config for frontend boot.
  app.get('/__bui/config', async () => {
    return buildRuntimeConfigPayload(config)
  })

  // --- GET /api/config ---
  // Workspace configuration for frontend.
  app.get('/api/config', async () => {
    return {
      workspace_root: config.workspaceRoot,
      pty_providers: ['shell'], // Default provider
      paths: {
        files: '.',
      },
    }
  })

  // --- GET /api/project ---
  // Project root for frontend.
  app.get('/api/project', async () => {
    return {
      root: config.workspaceRoot,
    }
  })
}
