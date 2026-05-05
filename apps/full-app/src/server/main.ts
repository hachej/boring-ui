import { runCoreWorkspaceAgentServer } from '@boring/core/app/server'

runCoreWorkspaceAgentServer(import.meta.url).catch((error) => {
  console.error(error)
  process.exit(1)
})
