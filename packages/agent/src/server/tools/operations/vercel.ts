import { isAbsolute, relative } from 'node:path'

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
import { mergeRuntimeProvisioningEnv, type RuntimeProvisioningOptions } from '../../runtime/env'
import {
  VERCEL_SANDBOX_REMOTE_ROOT,
  VERCEL_SANDBOX_WORKSPACE_ROOT,
} from '../../workspace/createVercelSandboxWorkspace'

const VERCEL_SANDBOX_LEGACY_ROOT = '/vercel/sandbox'
const VERCEL_SAFE_DEFAULT_PATH = '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin'

function mergeVercelBashRuntimeEnv(
  runtime: RuntimeProvisioningOptions | undefined,
  executionRuntimeEnv: Record<string, string> | undefined,
): Record<string, string | undefined> | undefined {
  const { PATH: executionPath, ...executionEnv } = executionRuntimeEnv ?? {}
  return mergeRuntimeProvisioningEnv(runtime, {
    ...executionEnv,
    PATH: executionPath ? `${executionPath}:${VERCEL_SAFE_DEFAULT_PATH}` : VERCEL_SAFE_DEFAULT_PATH,
  })
}

function rootAliases(workspace: Workspace): string[] {
  const aliases = [workspace.root]
  // Accept the Vercel SDK's former internal root as a backwards-compatible
  // input alias, but never display it back to the model/user.
  if (workspace.root === VERCEL_SANDBOX_WORKSPACE_ROOT) aliases.push(VERCEL_SANDBOX_LEGACY_ROOT)
  if (workspace.root === VERCEL_SANDBOX_LEGACY_ROOT) aliases.push(VERCEL_SANDBOX_WORKSPACE_ROOT)
  return Array.from(new Set(aliases))
}

function isOutsideWorkspaceRel(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
}

function toRelPath(workspace: Workspace, absolutePath: string): string {
  for (const root of rootAliases(workspace)) {
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

export function vercelBashOps(sandbox: Sandbox, opts: {
  mergeEnv?: (env: Record<string, string | undefined> | undefined) => Record<string, string | undefined> | undefined
  runtime?: RuntimeProvisioningOptions
  executionRuntimeEnv?: Record<string, string>
} = {}): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      const effectiveEnv = opts.mergeEnv
        ? opts.mergeEnv(env)
        : opts.runtime || opts.executionRuntimeEnv
          ? mergeVercelBashRuntimeEnv(opts.runtime, opts.executionRuntimeEnv)
          : env
      const filteredEnv = effectiveEnv
        ? Object.fromEntries(Object.entries(effectiveEnv).filter((e): e is [string, string] => e[1] != null))
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

function toRemotePath(value: string): string {
  if (value === VERCEL_SANDBOX_LEGACY_ROOT) return VERCEL_SANDBOX_REMOTE_ROOT
  if (value.startsWith(`${VERCEL_SANDBOX_LEGACY_ROOT}/`)) {
    return `${VERCEL_SANDBOX_REMOTE_ROOT}${value.slice(VERCEL_SANDBOX_LEGACY_ROOT.length)}`
  }
  return value
}

function toRuntimePath(value: string): string {
  if (value === VERCEL_SANDBOX_LEGACY_ROOT) return VERCEL_SANDBOX_WORKSPACE_ROOT
  if (value.startsWith(`${VERCEL_SANDBOX_LEGACY_ROOT}/`)) {
    return `${VERCEL_SANDBOX_WORKSPACE_ROOT}${value.slice(VERCEL_SANDBOX_LEGACY_ROOT.length)}`
  }
  return value
}

function sanitizeRuntimeText(value: string): string {
  return value.replaceAll(VERCEL_SANDBOX_LEGACY_ROOT, VERCEL_SANDBOX_WORKSPACE_ROOT)
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

function isFdMissing(result: ExecResultLike): boolean {
  if (result.exitCode !== 127) return false
  const stderr = Buffer.from(result.stderr).toString('utf-8')
  return /\bfd: (?:not found|command not found)\b/i.test(stderr)
}

interface ExecResultLike {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
}

export function vercelFindOps(sandbox: Sandbox, workspace?: Workspace): FindOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      if (workspace) {
        try {
          const rel = toRelPath(workspace, absolutePath)
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
      const remoteCwd = toRemotePath(cwd)
      const args = ['fd', '--glob', '--no-require-git', '--max-results', String(options.limit)]
      for (const ig of options.ignore) {
        args.push('--exclude', ig)
      }
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
        const stderr = sanitizeRuntimeText(Buffer.from(result.stderr).toString('utf-8').trim())
        throw new Error(`file search failed (exit ${result.exitCode}): ${stderr}`)
      }

      const stdout = Buffer.from(result.stdout).toString('utf-8')
      return stdout.split('\n').filter(Boolean).map(toRuntimePath)
    },
  }
}

export function vercelLsOps(workspace: Workspace): LsOperations {
  return {
    async exists(absolutePath: string): Promise<boolean> {
      try {
        const rel = toRelPath(workspace, absolutePath)
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
