import { createWorkerServer } from '@hachej/boring-agent/server/worker'

export async function createAgentWorkerApp() {
  return createWorkerServer()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAgentWorkerApp()
    .then(({ app, config }) => app.listen({ host: config.host, port: config.port }))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
