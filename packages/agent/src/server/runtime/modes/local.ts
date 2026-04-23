import type { FileSearch } from '../../../shared/file-search'
import type { RuntimeModeAdapter } from '../mode'
import { createBwrapSandbox } from '../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'

function createPendingFileSearch(modeId: RuntimeModeAdapter['id']): FileSearch {
  return {
    async search() {
      throw new Error(`FileSearch is not configured for mode "${modeId}" yet`)
    },
  }
}

export const localModeAdapter: RuntimeModeAdapter = {
  id: 'local',
  async create(ctx) {
    if (process.platform !== 'linux') {
      throw new Error('local mode requires Linux with bubblewrap')
    }

    const workspace = createNodeWorkspace(ctx.workspaceRoot)
    const sandbox = createBwrapSandbox()
    await sandbox.init({ workspace, sessionId: ctx.sessionId })

    return {
      workspace,
      sandbox,
      fileSearch: createPendingFileSearch('local'),
      uiBridge: ctx.uiBridge,
    }
  },
}
