import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { WorkspaceProvisioner } from './types.js'

export interface FsProvisionerOptions {
  rootDir: string
}

export function createFsProvisioner(opts: FsProvisionerOptions): WorkspaceProvisioner {
  if (!path.isAbsolute(opts.rootDir)) {
    throw new Error(`FsProvisioner rootDir must be absolute, got: ${opts.rootDir}`)
  }
  const root = path.resolve(opts.rootDir)

  return {
    async provision(ctx) {
      const dir = path.join(root, ctx.workspaceId)
      const resolved = path.resolve(dir)
      if (!resolved.startsWith(root + path.sep)) {
        throw new Error(`Path traversal detected: ${ctx.workspaceId} resolves outside rootDir`)
      }
      await fs.mkdir(resolved, { recursive: true, mode: 0o700 })
      return { volumePath: resolved }
    },
    async destroy(workspaceId) {
      const dir = path.join(root, workspaceId)
      const resolved = path.resolve(dir)
      if (!resolved.startsWith(root + path.sep)) {
        throw new Error(`Path traversal detected: ${workspaceId} resolves outside rootDir`)
      }
      await fs.rm(resolved, { recursive: true, force: true })
    },
  }
}
