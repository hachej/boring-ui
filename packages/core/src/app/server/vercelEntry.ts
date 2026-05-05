import { appRootFromImportMeta } from './appRootFromImportMeta.js'
import { createCoreWorkspaceAgentServer } from './createCoreWorkspaceAgentServer.js'
import { createVercelFastifyHandler, type VercelFastifyHandler } from './vercelFastifyHandler.js'

export interface CreateCoreVercelEntryOptions {
  workspaceRoot?: string
  /** How many directory levels up from the entry file is the app root. Default: 2 (src/server → app). */
  levelsUp?: number
}

/**
 * Creates a Vercel Function handler from a server entry file.
 * Sets BORING_AGENT_MODE and BORING_AGENT_WORKSPACE_ROOT defaults for Vercel.
 *
 * Usage in vercel-entry.ts:
 *   export default createCoreVercelEntry(import.meta.url)
 */
export function createCoreVercelEntry(
  importMetaUrl: string,
  opts: CreateCoreVercelEntryOptions = {},
): VercelFastifyHandler {
  process.env.BORING_AGENT_MODE ??= 'vercel-sandbox'
  process.env.BORING_AGENT_WORKSPACE_ROOT ??= opts.workspaceRoot ?? '/tmp/boring-workspaces'

  const appRoot = appRootFromImportMeta(importMetaUrl, opts.levelsUp ?? 2)
  const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT

  return createVercelFastifyHandler({
    createServer: () => createCoreWorkspaceAgentServer({ appRoot, workspaceRoot, serveFrontend: true }),
  })
}
