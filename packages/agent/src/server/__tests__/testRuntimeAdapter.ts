import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance } from 'fastify'

import type { FileSearch, Sandbox } from '../../shared'
import type { ExecOptions, ExecResult } from '../../shared/sandbox'
import { createAgentApp, type CreateAgentAppOptions } from '../createAgentApp'
import { registerAgentRoutes, type RegisterAgentRoutesOptions } from '../registerAgentRoutes'
import type { RuntimeModeAdapter, RuntimeModeId } from '../runtime/mode'
import type { WorkspaceProvisioningAdapter } from '../workspace/provisioning'
import type { BoringAgentRuntimePaths } from '../workspace/runtimeLayout'
import { createTestNodeWorkspace } from '../../__tests__/helpers/testNodeWorkspace'

const encoder = new TextEncoder()
const execFileAsync = promisify(execFile)

export interface TestRuntimeAdapterOptions {
  id?: string
  workspaceFsCapability?: RuntimeModeAdapter['workspaceFsCapability']
}

function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

async function listFiles(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(join(root, dir), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, rel))
    } else {
      files.push(rel)
    }
  }
  return files
}

function createTestFileSearch(root: string): FileSearch {
  return {
    async search(glob, limit = 500) {
      const files = await listFiles(root)
      const matcher = globToRegExp(glob.includes('/') ? glob : basename(glob))
      const matches = files.filter((file) => matcher.test(glob.includes('/') ? file : basename(file)))
      return matches.slice(0, Math.max(0, limit))
    },
  }
}

function createTestSandbox(root: string): Sandbox {
  return {
    id: 'test-direct',
    placement: 'server',
    provider: 'test-direct',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: root },
    async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
      const cwd = opts.cwd ? (isAbsolute(opts.cwd) ? opts.cwd : join(root, opts.cwd)) : root
      const startedAt = Date.now()
      return await new Promise((resolve) => {
        const child = spawn(cmd, {
          cwd,
          env: { ...process.env, ...(opts.env ?? {}) },
          shell: true,
          signal: opts.signal,
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let timedOut = false
        const timeout = opts.timeoutMs
          ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
          }, opts.timeoutMs)
          : null
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout.push(chunk)
          opts.onStdout?.(new Uint8Array(chunk))
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr.push(chunk)
          opts.onStderr?.(new Uint8Array(chunk))
        })
        child.on('close', (code) => {
          if (timeout) clearTimeout(timeout)
          resolve({
            stdout: new Uint8Array(Buffer.concat(stdout, opts.maxOutputBytes)),
            stderr: timedOut
              ? encoder.encode('command timed out')
              : new Uint8Array(Buffer.concat(stderr, opts.maxOutputBytes)),
            exitCode: code ?? (timedOut ? 124 : 1),
            durationMs: Date.now() - startedAt,
            truncated: false,
          })
        })
        child.on('error', (error) => {
          if (timeout) clearTimeout(timeout)
          resolve({
            stdout: new Uint8Array(),
            stderr: encoder.encode(error.message),
            exitCode: 1,
            durationMs: Date.now() - startedAt,
            truncated: false,
          })
        })
      })
    },
  }
}

function createTestProvisioningAdapter(runtimeLayout: BoringAgentRuntimePaths): WorkspaceProvisioningAdapter {
  const root = runtimeLayout.workspaceRoot
  const abs = (rel: string) => join(root, rel)
  return {
    mode: 'direct',
    async exec(command, args, opts) {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: opts?.cwd ?? root,
        env: { ...process.env, ...(opts?.env ?? {}) },
        timeout: opts?.timeoutMs,
        maxBuffer: 1024 * 1024 * 20,
      })
      return { stdout, stderr }
    },
    async resolveInstallSource(source) {
      return source instanceof URL ? source.pathname : source
    },
    workspaceFs: {
      async exists(rel) {
        try {
          await stat(abs(rel))
          return true
        } catch (error) {
          const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
          if (code === 'ENOENT') return false
          throw error
        }
      },
      async rm(rel) {
        await rm(abs(rel), { recursive: true, force: true })
      },
      async mkdir(rel) {
        await mkdir(abs(rel), { recursive: true })
      },
      async writeText(rel, content) {
        await mkdir(dirname(abs(rel)), { recursive: true })
        await writeFile(abs(rel), content, 'utf8')
      },
      async readText(rel) {
        try {
          return await readFile(abs(rel), 'utf8')
        } catch (error) {
          const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : undefined
          if (code === 'ENOENT') return null
          throw error
        }
      },
      async copyFromHost(source, target) {
        await mkdir(dirname(abs(target)), { recursive: true })
        await cp(source, abs(target), {
          recursive: true,
          errorOnExist: false,
          force: false,
        })
      },
    },
    getRuntimeCacheRoot() {
      return runtimeLayout.cache
    },
  }
}

export function createTestRuntimeModeAdapter(opts: TestRuntimeAdapterOptions = {}): RuntimeModeAdapter {
  return {
    id: opts.id ?? 'direct',
    workspaceFsCapability: opts.workspaceFsCapability ?? 'strong',
    createProvisioningAdapter: (runtimeLayout) => createTestProvisioningAdapter(runtimeLayout),
    async create(ctx) {
      await mkdir(ctx.workspaceRoot, { recursive: true })
      if (ctx.templatePath) {
        try {
          await cp(ctx.templatePath, ctx.workspaceRoot, {
            recursive: true,
            errorOnExist: false,
            force: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Failed to copy template from "${ctx.templatePath}" into workspace "${ctx.workspaceRoot}": ${message}`,
            { cause: error },
          )
        }
      }
      const workspace = createTestNodeWorkspace(ctx.workspaceRoot)
      const sandbox = createTestSandbox(ctx.workspaceRoot)
      return {
        runtimeContext: { runtimeCwd: ctx.workspaceRoot },
        storageRoot: ctx.workspaceRoot,
        bash: { kind: 'host', preserveHostHome: true },
        filesystem: { kind: 'host' },
        workspace,
        sandbox,
        fileSearch: createTestFileSearch(ctx.workspaceRoot),
      }
    },
  }
}

type TestAgentAppOptions = Partial<CreateAgentAppOptions> & { mode?: RuntimeModeId }
type TestAgentRoutesOptions = Partial<RegisterAgentRoutesOptions> & { mode?: RuntimeModeId }

export function createTestAgentApp(opts: TestAgentAppOptions = {}) {
  return createAgentApp({
    ...opts,
    runtimeModeAdapter: opts.runtimeModeAdapter ?? createTestRuntimeModeAdapter({ id: opts.mode ?? 'direct' }),
  })
}

export function registerTestAgentRoutes(app: FastifyInstance, opts: TestAgentRoutesOptions = {}) {
  return app.register(registerAgentRoutes, {
    ...opts,
    runtimeModeAdapter: opts.runtimeModeAdapter ?? createTestRuntimeModeAdapter({ id: opts.mode ?? 'direct' }),
  })
}
