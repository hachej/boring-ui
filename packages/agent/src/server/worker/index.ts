// @hachej/boring-agent — remote bwrap worker runtime (Node-only) public API.
//
// This is the self-contained Fastify server that a tenant deployment runs as
// its internal worker process. Host apps only need to supply configuration
// (usually via environment) and start the returned Fastify instance.
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'

import { loadWorkerConfig, type WorkerConfig } from '../config/workerConfig'
import { registerWorkerRoutes } from './routes'

export { loadWorkerConfig, type WorkerConfig } from '../config/workerConfig'
export { registerWorkerRoutes } from './routes'
export { WORKER_ERROR_CODES, type WorkerErrorCode } from './error-codes'
export {
  assertSafeWorkspaceId,
  createWorkerRuntime,
  runWorkspaceOp,
  type WorkerRuntime,
} from './workspace'
export { ExecSemaphore, buildExecEnv } from './exec'
export { verifyInternalToken } from './auth'

const DEFAULT_BODY_LIMIT = 20 * 1024 * 1024

export interface CreateWorkerServerOptions {
  /** Worker configuration. Defaults to {@link loadWorkerConfig} (reads env). */
  config?: WorkerConfig
  /** Extra Fastify server options merged over the worker defaults. */
  fastify?: FastifyServerOptions
}

export interface WorkerServer {
  app: FastifyInstance
  config: WorkerConfig
}

/**
 * Build the internal worker Fastify server with worker routes registered.
 * Callers own listening/lifecycle.
 */
export async function createWorkerServer(options: CreateWorkerServerOptions = {}): Promise<WorkerServer> {
  const config = options.config ?? loadWorkerConfig()
  const app = Fastify({ logger: true, bodyLimit: DEFAULT_BODY_LIMIT, ...options.fastify })
  await registerWorkerRoutes(app, config)
  return { app, config }
}
