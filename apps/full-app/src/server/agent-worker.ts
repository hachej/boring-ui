import { createWorkerServer, loadWorkerConfig } from '@hachej/boring-agent/server/worker'
import { createBwrapSandboxProvider } from '@hachej/boring-sandbox/providers/bwrap'

export async function createAgentWorkerApp() {
  const config = loadWorkerConfig()
  return createWorkerServer({
    config,
    runtimeProvider: createBwrapSandboxProvider({
      sandbox: {
        network: config.bwrapNetwork,
        dropAllCapabilities: true,
        resourceLimits: config.resourceLimits,
      },
    }),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createAgentWorkerApp()
    .then(({ app, config }) => app.listen({ host: config.host, port: config.port }))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
