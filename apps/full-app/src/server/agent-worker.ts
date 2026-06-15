import Fastify from 'fastify'

import { loadWorkerConfig } from './worker/config.js'
import { registerWorkerRoutes } from './worker/routes.js'

export async function createAgentWorkerApp() {
  const config = loadWorkerConfig()
  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 })
  await registerWorkerRoutes(app, config)
  return { app, config }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAgentWorkerApp()
    .then(({ app, config }) => app.listen({ host: config.host, port: config.port }))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
