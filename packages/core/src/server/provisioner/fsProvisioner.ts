import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { WorkspaceProvisioner } from './types.js'

export interface FsProvisionerOptions {
  rootDir: string
}

function assertValidWorkspaceId(workspaceId: string): void {
  if (
    workspaceId.length === 0 ||
    workspaceId === '.' ||
    workspaceId === '..' ||
    workspaceId.includes('\0') ||
    workspaceId.includes('/') ||
    workspaceId.includes('\\')
  ) {
    throw new Error(`Invalid workspaceId for filesystem provisioning: ${workspaceId}`)
  }
}

function resolveWorkspaceDir(root: string, workspaceId: string): string {
  assertValidWorkspaceId(workspaceId)
  const resolved = path.resolve(root, workspaceId)
  const relative = path.relative(root, resolved)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected: ${workspaceId} resolves outside rootDir`)
  }
  return resolved
}

export function createFsProvisioner(opts: FsProvisionerOptions): WorkspaceProvisioner {
  if (!path.isAbsolute(opts.rootDir)) {
    throw new Error(`FsProvisioner rootDir must be absolute, got: ${opts.rootDir}`)
  }
  const root = path.resolve(opts.rootDir)

  return {
    async provision(ctx) {
      const resolved = resolveWorkspaceDir(root, ctx.workspaceId)
      await fs.mkdir(resolved, { recursive: true, mode: 0o700 })
      return { volumePath: resolved }
    },
    async destroy(workspaceId) {
      const resolved = resolveWorkspaceDir(root, workspaceId)
      await fs.rm(resolved, { recursive: true, force: true })
    },
  }
}
