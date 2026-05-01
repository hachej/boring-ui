import { startCoreWorkspaceAgentDevServer } from '@boring/core/app/server'
import { buildServer, defaultAppRoot } from './index.js'

async function main() {
  await startCoreWorkspaceAgentDevServer({
    appRoot: defaultAppRoot(),
    buildServer,
    eventPrefix: 'full-app',
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
