import { relative } from 'node:path'

import type {
  BashOperations,
  EditOperations,
  FindOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@mariozechner/pi-coding-agent'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'

function toRelPath(workspace: Workspace, absolutePath: string): string {
  const rel = relative(workspace.root, absolutePath)
  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw new Error(`path "${absolutePath}" is outside workspace`)
  }
  return rel
}

export function vercelBashOps(sandbox: Sandbox): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      const filteredEnv = env
        ? Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] != null))
        : undefined
      return sandbox.exec(command, {
        cwd,
        env: filteredEnv,
        signal,
        timeoutMs: timeout ? timeout * 1000 : undefined,
        onStdout: (chunk) => onData(Buffer.from(chunk)),
        onStderr: (chunk) => onData(Buffer.from(chunk)),
      }).then((result) => ({ exitCode: result.exitCode }))
    },
  }
}

export function vercelReadOps(workspace: Workspace): ReadOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const rel = toRelPath(workspace, absolutePath)
      const content = await workspace.readFile(rel)
      return Buffer.from(content, 'utf-8')
    },
    async access(absolutePath: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath)
      await workspace.stat(rel)
    },
  }
}

export function vercelWriteOps(workspace: Workspace): WriteOperations {
  return {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath)
      await workspace.writeFile(rel, content)
    },
    async mkdir(dir: string): Promise<void> {
      const rel = toRelPath(workspace, dir)
      await workspace.mkdir(rel, { recursive: true })
    },
  }
}

export function vercelEditOps(workspace: Workspace): EditOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const rel = toRelPath(workspace, absolutePath)
      const content = await workspace.readFile(rel)
      return Buffer.from(content, 'utf-8')
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath)
      await workspace.writeFile(rel, content)
    },
    async access(absolutePath: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath)
      await workspace.stat(rel)
    },
  }
}

export function vercelFindOps(sandbox: Sandbox): FindOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const result = await sandbox.exec(`test -e ${shellEscape(absolutePath)}`, {
        timeoutMs: 5_000,
      })
      return result.exitCode === 0
    },
    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      const args = ['fd', '--glob', '--no-require-git', '--max-results', String(options.limit)]
      for (const ig of options.ignore) {
        args.push('--exclude', ig)
      }
      args.push(pattern, cwd)

      const result = await sandbox.exec(args.map(shellEscape).join(' '), {
        timeoutMs: 30_000,
        maxOutputBytes: 1_048_576,
      })

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        const stderr = Buffer.from(result.stderr).toString('utf-8').trim()
        throw new Error(`fd failed (exit ${result.exitCode}): ${stderr}`)
      }

      const stdout = Buffer.from(result.stdout).toString('utf-8')
      return stdout.split('\n').filter(Boolean)
    },
  }
}

export function vercelLsOps(workspace: Workspace): LsOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      const rel = toRelPath(workspace, absolutePath)
      try {
        await workspace.stat(rel)
        return true
      } catch {
        return false
      }
    },
    async stat(absolutePath: string) {
      const rel = toRelPath(workspace, absolutePath)
      const s = await workspace.stat(rel)
      return { isDirectory: () => s.kind === 'dir' }
    },
    async readdir(absolutePath: string): Promise<string[]> {
      const rel = toRelPath(workspace, absolutePath)
      const entries = await workspace.readdir(rel)
      return entries.map((e) => e.name)
    },
  }
}

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}
