import { createCoreWorkspaceAgentServer } from './createCoreWorkspaceAgentServer.js'
import { createVercelFastifyHandler, type VercelFastifyHandler } from './vercelFastifyHandler.js'

export interface CreateCoreVercelEntryOptions {
  workspaceRoot?: string
}

/**
 * Creates a Vercel Function handler.
 * Sets BORING_AGENT_MODE and BORING_AGENT_WORKSPACE_ROOT defaults for Vercel.
 *
 * Usage in vercel-entry.ts:
 *   export default createCoreVercelEntry(import.meta.url)
 */
export function createCoreVercelEntry(
  _importMetaUrl: string,
  opts: CreateCoreVercelEntryOptions = {},
): VercelFastifyHandler {
  process.env.BORING_AGENT_MODE ??= 'vercel-sandbox'
  process.env.BORING_AGENT_WORKSPACE_ROOT ??= opts.workspaceRoot ?? '/tmp/boring-workspaces'

  // After bundling, import.meta.url points at api/generated-index.ts, so
  // appRootFromImportMeta resolves to the wrong directory. process.cwd() is
  // always the Vercel project root where dist/front is located.
  const appRoot = process.cwd()
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT

  return createVercelFastifyHandler({
    createServer: () => createCoreWorkspaceAgentServer({ appRoot, workspaceRoot, serveFrontend: true }),
  })
}
