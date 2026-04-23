import type { FileSearch } from '../../../shared/file-search'
import type { RuntimeModeAdapter } from '../mode'
import { createDirectSandbox } from '../../sandbox/direct/createDirectSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'

function createPendingFileSearch(modeId: RuntimeModeAdapter['id']): FileSearch {
  return {
    async search() {
      throw new Error(`FileSearch is not configured for mode "${modeId}" yet`)
    },
  }
}

export const directModeAdapter: RuntimeModeAdapter = {
  id: 'direct',
  async create(ctx) {
    const workspace = createNodeWorkspace(ctx.workspaceRoot)
    const sandbox = createDirectSandbox()
    await sandbox.init({ workspace, sessionId: ctx.sessionId })

    return {
      workspace,
      sandbox,
      fileSearch: createPendingFileSearch('direct'),
      uiBridge: ctx.uiBridge,
    }
  },
}
