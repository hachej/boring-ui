import type { FastifyInstance } from 'fastify'
import {
  createAgentApp,
  type CreateAgentAppOptions,
} from '@boring/agent/server'

export interface StandaloneServerOptions
  extends Pick<
    CreateAgentAppOptions,
    'workspaceRoot' | 'sessionId' | 'mode' | 'authToken' | 'version' | 'logger'
  > {
  port?: number
  host?: string
}

export async function startStandaloneServer(
  opts: StandaloneServerOptions = {},
): Promise<{ app: FastifyInstance; address: string }> {
  const app = await createAgentApp({
    workspaceRoot: opts.workspaceRoot,
    sessionId: opts.sessionId,
    mode: opts.mode,
    authToken: opts.authToken,
    version: opts.version,
    logger: opts.logger,
  })

  const address = await app.listen({
    port: opts.port ?? 0,
    host: opts.host ?? '0.0.0.0',
  })

  return { app, address }
}
