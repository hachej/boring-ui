import { isAbsolute, relative } from 'node:path'

import type {
  EditOperations,
  FindOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@mariozechner/pi-coding-agent'

import type { Sandbox } from '../../../shared/sandbox'
import type { Workspace } from '../../../shared/workspace'

export interface RemoteWorkspacePathOptions {
  rootAliases?: string[]
  toRemotePath?: (value: string) => string
  toRuntimePath?: (value: string) => string
  sanitizeErrorText?: (value: string) => string
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function rootsFor(workspace: Workspace, opts: RemoteWorkspacePathOptions = {}): string[] {
  return unique([workspace.root, ...(opts.rootAliases ?? [])])
}

function isOutsideWorkspaceRel(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
}

function toRelPath(workspace: Workspace, absolutePath: string, opts: RemoteWorkspacePathOptions = {}): string {
  for (const root of rootsFor(workspace, opts)) {
    const rel = relative(root, absolutePath)
    if (!isOutsideWorkspaceRel(rel)) return rel
  }

  const skillMarker = '/.agents/skills/'
  const skillIndex = absolutePath.indexOf(skillMarker)
  if (skillIndex >= 0) {
    const skillPath = absolutePath.slice(skillIndex + skillMarker.length)
    if (skillPath.includes('\0') || skillPath.split(/[\\/]+/).includes('..')) {
      throw new Error(`path "${absolutePath}" escapes the workspace skills directory`)
    }
    return `.agents/skills/${skillPath}`
  }

  throw new Error(
    `path "${absolutePath}" is outside workspace; use a path relative to the workspace root or under ${workspace.root}`,
  )
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function findPredicate(pattern: string): string {
  const isPathShaped = pattern.includes('/') || pattern.includes('**')
  if (!isPathShaped) return `-name ${shellEscape(pattern)}`

  let translated = pattern.replaceAll('**', '*').replace(/^\/+/, '')
  if (!translated.startsWith('*')) translated = `*${translated}`
  return `-path ${shellEscape(translated)}`
}

function findIgnoreArgs(cwd: string, ignore: string[]): string {
  return ignore
    .map((pattern) => `! -path ${shellEscape(`${cwd}/${pattern.replace(/^\/+/, '')}/*`)}`)
    .join(' ')
}

function fallbackFindCommand(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): string {
  return [
    'find',
    shellEscape(cwd),
    '-maxdepth 20',
    '-type f',
    findIgnoreArgs(cwd, options.ignore),
    findPredicate(pattern),
    `| head -n ${Math.max(1, Math.trunc(options.limit))}`,
  ].filter(Boolean).join(' ')
}

interface ExecResultLike {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
}

function isFdMissing(result: ExecResultLike): boolean {
  if (result.exitCode !== 127) return false
  const stderr = Buffer.from(result.stderr).toString('utf-8')
  return /\bfd: (?:not found|command not found)\b/i.test(stderr)
}

function remotePath(value: string, opts: RemoteWorkspacePathOptions): string {
  return opts.toRemotePath?.(value) ?? value
}

function runtimePath(value: string, opts: RemoteWorkspacePathOptions): string {
  return opts.toRuntimePath?.(value) ?? value
}

function sanitizeErrorText(value: string, opts: RemoteWorkspacePathOptions): string {
  return opts.sanitizeErrorText?.(value) ?? value
}

export function remoteWorkspaceReadOps(workspace: Workspace, opts: RemoteWorkspacePathOptions = {}): ReadOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const rel = toRelPath(workspace, absolutePath, opts)
      const content = await workspace.readFile(rel)
      return Buffer.from(content, 'utf-8')
    },
    async access(absolutePath: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath, opts)
      await workspace.stat(rel)
    },
  }
}

export function remoteWorkspaceWriteOps(workspace: Workspace, opts: RemoteWorkspacePathOptions = {}): WriteOperations {
  return {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath, opts)
      await workspace.writeFile(rel, content)
    },
    async mkdir(dir: string): Promise<void> {
      const rel = toRelPath(workspace, dir, opts)
      await workspace.mkdir(rel, { recursive: true })
    },
  }
}

export function remoteWorkspaceEditOps(workspace: Workspace, opts: RemoteWorkspacePathOptions = {}): EditOperations {
  return {
    async readFile(absolutePath: string): Promise<Buffer> {
      const rel = toRelPath(workspace, absolutePath, opts)
      const content = await workspace.readFile(rel)
      return Buffer.from(content, 'utf-8')
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath, opts)
      await workspace.writeFile(rel, content)
    },
    async access(absolutePath: string): Promise<void> {
      const rel = toRelPath(workspace, absolutePath, opts)
      await workspace.stat(rel)
    },
  }
}

export function remoteWorkspaceFindOps(
  sandbox: Sandbox,
  workspace?: Workspace,
  opts: RemoteWorkspacePathOptions = {},
): FindOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      if (workspace) {
        try {
          const rel = toRelPath(workspace, absolutePath, opts)
          await workspace.stat(rel)
          return true
        } catch {
          return false
        }
      }
      const result = await sandbox.exec(`test -e ${shellEscape(absolutePath)}`, {
        timeoutMs: 5_000,
      })
      return result.exitCode === 0
    },
    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      const remoteCwd = remotePath(cwd, opts)
      const args = ['fd', '--glob', '--no-require-git', '--max-results', String(options.limit)]
      for (const ig of options.ignore) args.push('--exclude', ig)
      args.push(pattern, remoteCwd)

      let result = await sandbox.exec(args.map(shellEscape).join(' '), {
        timeoutMs: 30_000,
        maxOutputBytes: 1_048_576,
      })

      if (isFdMissing(result)) {
        result = await sandbox.exec(fallbackFindCommand(pattern, remoteCwd, options), {
          timeoutMs: 30_000,
          maxOutputBytes: 1_048_576,
        })
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        const stderr = sanitizeErrorText(Buffer.from(result.stderr).toString('utf-8').trim(), opts)
        throw new Error(`file search failed (exit ${result.exitCode}): ${stderr}`)
      }

      const stdout = Buffer.from(result.stdout).toString('utf-8')
      return stdout.split('\n').filter(Boolean).map((value) => runtimePath(value, opts))
    },
  }
}

export function remoteWorkspaceLsOps(workspace: Workspace, opts: RemoteWorkspacePathOptions = {}): LsOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      try {
        const rel = toRelPath(workspace, absolutePath, opts)
        await workspace.stat(rel)
        return true
      } catch {
        return false
      }
    },
    async stat(absolutePath: string) {
      const rel = toRelPath(workspace, absolutePath, opts)
      const stat = await workspace.stat(rel)
      return { isDirectory: () => stat.kind === 'dir' }
    },
    async readdir(absolutePath: string) {
      const rel = toRelPath(workspace, absolutePath, opts)
      return (await workspace.readdir(rel)).map((entry) => entry.name)
    },
  }
}
