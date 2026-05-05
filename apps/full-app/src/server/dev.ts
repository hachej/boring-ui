import { startCoreWorkspaceAgentDevServerFromMeta } from '@boring/core/app/server'

startCoreWorkspaceAgentDevServerFromMeta(import.meta.url).catch((error) => {
  console.error(error)
  process.exit(1)
})
