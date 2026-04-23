import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createDirectSandbox } from '../../sandbox/direct/createDirectSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'

export const directModeAdapter: RuntimeModeAdapter = {
  id: 'direct',
  async create(ctx) {
    const workspace = createNodeWorkspace(ctx.workspaceRoot)
    const sandbox = createDirectSandbox()
    await sandbox.init({ workspace, sessionId: ctx.sessionId })

    return {
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
      uiBridge: ctx.uiBridge,
    }
  },
}
