import { mkdir } from 'node:fs/promises'

import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createBwrapSandbox } from '../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'
import { copyTemplate } from '../../workspace/provision'

export const localModeAdapter: RuntimeModeAdapter = {
  id: 'local',
  workspaceFsCapability: 'strong',
  async create(ctx) {
    if (process.platform !== 'linux') {
      throw new Error('local mode requires Linux with bubblewrap')
    }

    await mkdir(ctx.workspaceRoot, { recursive: true })
    await copyTemplate(ctx.templatePath, ctx.workspaceRoot)

    const workspace = createNodeWorkspace(ctx.workspaceRoot)
    const sandbox = createBwrapSandbox()
    await sandbox.init?.({ workspace, sessionId: ctx.sessionId })

    return {
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
