import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createSandboxRuntimeModeAdapter,
  type RuntimeBundle,
} from '@hachej/boring-agent/server'

export async function workspaceFixture(
  prefix: string,
  workspaceRoot?: string,
): Promise<RuntimeBundle> {
  const root = workspaceRoot ?? (await mkdtemp(path.join(os.tmpdir(), prefix)))
  return await createSandboxRuntimeModeAdapter('direct').create({
    workspaceRoot: root,
    workspaceId: prefix,
    sessionId: prefix,
  })
}
