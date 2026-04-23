import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createNodeWorkspace } from '../../server/workspace/createNodeWorkspace'
import type { Workspace } from '../../shared/workspace'

export interface TempWorkspaceHandle {
  root: string
  workspace: Workspace
  cleanup(): Promise<void>
}

export async function createTempWorkspace(
  prefix = 'boring-ui-agent-test-',
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
