import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Workspace } from '../contracts'
import { createNodeWorkspace } from '../node-workspace/createNodeWorkspace'

export interface TempWorkspaceHandle {
  root: string
  workspace: Workspace
  cleanup(): Promise<void>
}

export async function createTempWorkspace(
  prefix = 'boring-ui-sandbox-test-',
): Promise<TempWorkspaceHandle> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return {
    root,
    workspace: createNodeWorkspace(root),
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
