import Fastify, { type FastifyInstance } from 'fastify'

export interface SpawnBackendOptions {
  register?(app: FastifyInstance): Promise<void> | void
}

export interface SpawnedBackend {
  app: FastifyInstance
  baseUrl: string
  close(): Promise<void>
}

export async function spawnBackend(
  options: SpawnBackendOptions = {},
): Promise<SpawnedBackend> {
  const app = Fastify({ logger: false })
  try {
    await options.register?.(app)
    await app.ready()
    const address = await app.listen({ host: '127.0.0.1', port: 0 })
    return {
      app,
      baseUrl: address,
      async close() {
        await app.close()
      },
    }
  } catch (error) {
    await app.close()
    throw error
  }
}
