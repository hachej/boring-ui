import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createBwrapSandbox } from '../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'

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
      fileSearch: createServerFileSearch(workspace, sandbox),
      uiBridge: ctx.uiBridge,
    }
  },
}
