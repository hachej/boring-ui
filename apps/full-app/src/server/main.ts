import { runCoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

runCoreWorkspaceAgentServer(import.meta.url).catch((error) => {
  console.error(error)
  process.exit(1)
})
