import type { IncomingMessage, ServerResponse } from 'node:http'

export interface VercelFastifyLikeServer {
  ready(): PromiseLike<void> | void
  server: {
    emit(event: 'request', req: IncomingMessage, res: ServerResponse): boolean
  }
}

export type VercelFastifyHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>

export interface CreateVercelFastifyHandlerOptions<TServer extends VercelFastifyLikeServer> {
  createServer: () => Promise<TServer> | TServer
}

/**
 * Adapt a Fastify server factory to Vercel's Node function signature.
 *
 * The Fastify instance is created once per warm function process and reused for
 * subsequent invocations. App-specific policy (runtime mode, workspace root,
 * appRoot, etc.) belongs in the caller's `createServer` factory.
 */
export function createVercelFastifyHandler<TServer extends VercelFastifyLikeServer>({
  createServer,
}: CreateVercelFastifyHandlerOptions<TServer>): VercelFastifyHandler {
  let serverPromise: Promise<TServer> | undefined

  async function getServer(): Promise<TServer> {
    serverPromise ??= Promise.resolve(createServer())
      .then(async (server) => {
        await server.ready()
        return server
      })
      .catch((error) => {
        serverPromise = undefined
        throw error
      })
    return serverPromise
  }

  return async function vercelFastifyHandler(req, res) {
    const server = await getServer()
    server.server.emit('request', req, res)
  }
}
