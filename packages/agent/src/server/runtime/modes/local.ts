import { mkdir } from 'node:fs/promises'

import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { createBwrapSandbox } from '../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../../workspace/createNodeWorkspace'
import { copyTemplate } from '../../workspace/provision'
import { createLocalProvisioningAdapter } from './provisioningAdapter'

export const localModeAdapter: RuntimeModeAdapter = {
  id: 'local',
  workspaceFsCapability: 'strong',
  createProvisioningAdapter: (runtimeLayout) => createLocalProvisioningAdapter(runtimeLayout),
  async create(ctx) {
    if (process.platform !== 'linux') {
      throw new Error('local mode requires Linux with bubblewrap')
    }

    await mkdir(ctx.workspaceRoot, { recursive: true })
    await copyTemplate(ctx.templatePath, ctx.workspaceRoot)

    const runtimeContext = { runtimeCwd: '/workspace' }
    const workspace = createNodeWorkspace(ctx.workspaceRoot, { runtimeContext })
    const sandbox = createBwrapSandbox({
      hostWorkspaceRoot: ctx.workspaceRoot,
      runtimeContext,
    })
    await sandbox.init?.({ workspace, sessionId: ctx.sessionId })

    return {
      runtimeContext,
      storageRoot: ctx.workspaceRoot,
      bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
      filesystem: { kind: 'host' },
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
