import { mkdir } from 'node:fs/promises'

import { createDirectSandbox, createNodeWorkspace } from '@hachej/boring-sandbox/providers'

import type { RuntimeModeAdapter } from '../mode'
import { createServerFileSearch } from '../createServerFileSearch'
import { copyTemplate } from '../../workspace/provision'
import { createDirectProvisioningAdapter } from './provisioningAdapter'

export const directModeAdapter: RuntimeModeAdapter = {
  id: 'direct',
  workspaceFsCapability: 'strong',
  createProvisioningAdapter: (runtimeLayout) => createDirectProvisioningAdapter(runtimeLayout),
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
      bash: { kind: 'host', preserveHostHome: true },
      filesystem: { kind: 'host' },
      workspace,
      sandbox,
      fileSearch: createServerFileSearch(workspace, sandbox),
    }
  },
}
