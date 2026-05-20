import { mkdir } from 'node:fs/promises'

import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createDirectSandbox } from '../../sandbox/direct/createDirectSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'
import { copyTemplate } from '../../workspace/provision'

export const directModeAdapter: RuntimeModeAdapter = {
  id: 'direct',
  workspaceFsCapability: 'strong',
  async create(ctx) {
    await mkdir(ctx.workspaceRoot, { recursive: true })
    await copyTemplate(ctx.templatePath, ctx.workspaceRoot)

    const runtimeContext = { runtimeCwd: ctx.workspaceRoot }
    const workspace = createNodeWorkspace(ctx.workspaceRoot, { runtimeContext })
    const sandbox = createDirectSandbox({ runtimeContext })
    await sandbox.init?.({ workspace, sessionId: ctx.sessionId })

    return {
      runtimeContext,
      storageRoot: ctx.workspaceRoot,
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
