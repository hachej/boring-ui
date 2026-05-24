import { mkdir } from 'node:fs/promises'

import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createDirectSandbox } from '../../sandbox/direct/createDirectSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'
import { copyTemplate } from '../../workspace/provision'
import { createDirectProvisioningAdapter } from './provisioningAdapter'

export const directModeAdapter: RuntimeModeAdapter = {
  id: 'direct',
  workspaceFsCapability: 'strong',
  createProvisioningAdapter: (runtimeLayout) => createDirectProvisioningAdapter(runtimeLayout),
  async create(ctx) {
    await mkdir(ctx.workspaceRoot, { recursive: true })
    await copyTemplate(ctx.templatePath, ctx.workspaceRoot)

    const workspace = createNodeWorkspace(ctx.workspaceRoot)
    const sandbox = createDirectSandbox()
    await sandbox.init?.({ workspace, sessionId: ctx.sessionId })

    return {
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
