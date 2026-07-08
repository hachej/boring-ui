import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Workspace } from '../../shared/workspace'
import { createTestNodeWorkspace } from './testNodeWorkspace'

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
    workspace: createTestNodeWorkspace(root),
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
