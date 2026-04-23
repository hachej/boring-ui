import type { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { Workspace } from '../../shared/workspace'
import { validatePath } from './paths'

const VERCEL_SANDBOX_ROOT = '/vercel/sandbox'

function toSandboxPath(relPath: string): string {
  return validatePath(VERCEL_SANDBOX_ROOT, relPath)
}

export function createVercelSandboxWorkspace(sandbox: VercelSandbox): Workspace {
  return {
    root: VERCEL_SANDBOX_ROOT,
    async readFile(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const content = await sandbox.fs.readFile(sandboxPath, 'utf8')
      if (typeof content === 'string') {
        return content
      }
      return Buffer.from(content).toString('utf-8')
    },
    async writeFile(relPath, data) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.writeFiles([
        {
          path: sandboxPath,
          content: Buffer.from(data, 'utf-8'),
        },
      ])
    },
    async unlink(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.fs.rm(sandboxPath, { recursive: false, force: false })
    },
    async readdir(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const entries = await sandbox.fs.readdir(sandboxPath, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : 'file',
      }))
    },
    async stat(relPath) {
      const sandboxPath = toSandboxPath(relPath)
      const fileStat = await sandbox.fs.stat(sandboxPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async mkdir(relPath, opts) {
      const sandboxPath = toSandboxPath(relPath)
      await sandbox.fs.mkdir(sandboxPath, { recursive: opts?.recursive ?? false })
    },
    async rename(fromRelPath, toRelPath) {
      const fromSandboxPath = toSandboxPath(fromRelPath)
      const toSandboxAbsolutePath = toSandboxPath(toRelPath)
      await sandbox.fs.rename(fromSandboxPath, toSandboxAbsolutePath)
    },
  }
}
