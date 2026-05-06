import { startCoreWorkspaceAgentDevServerFromMeta } from '@hachej/boring-core/app/server'

startCoreWorkspaceAgentDevServerFromMeta(import.meta.url).catch((error) => {
  console.error(error)
  process.exit(1)
})
