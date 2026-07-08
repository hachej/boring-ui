import { mkdir } from 'node:fs/promises'

import { buildBwrapArgs, createBwrapSandbox, createNodeWorkspace } from '@hachej/boring-sandbox/providers'

import type { RuntimeModeAdapter } from '@hachej/boring-agent/server'
import { createServerFileSearch } from './createServerFileSearch'
import { copyTemplate } from './copyTemplate'
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
      bash: { kind: 'local-sandbox', sandboxRoot: '/workspace', bwrapArgs: buildBwrapArgs(ctx.workspaceRoot) },
      filesystem: { kind: 'host' },
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
