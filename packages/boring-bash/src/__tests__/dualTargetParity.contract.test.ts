import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AgentTool,
  ExecOptions,
  ExecResult,
  FileSearch,
  Sandbox,
  ToolExecContext,
  Workspace,
} from '@hachej/boring-agent/shared'

import { buildFilesystemAgentTools as buildAgentFilesystemTools } from '../../../agent/src/server/tools/filesystem'
import { buildHarnessAgentTools as buildAgentHarnessTools } from '../../../agent/src/server/tools/harness'
import { boundFs as agentBoundFs } from '../../../agent/src/server/tools/operations/bound'
import { remoteSandboxBashOps as agentRemoteSandboxBashOps } from '../../../agent/src/server/tools/operations/remoteSandbox'
import { buildUploadAgentTools as buildAgentUploadTools } from '../../../agent/src/server/tools/upload'
import { createNodeWorkspace } from '../../../agent/src/server/workspace/createNodeWorkspace'
import { fileRoutes as agentFileRoutes } from '../../../agent/src/server/http/routes/file'
import { fsEventsRoutes as agentFsEventsRoutes } from '../../../agent/src/server/http/routes/fsEvents'
import { gitRoutes as agentGitRoutes } from '../../../agent/src/server/http/routes/git'
import { searchRoutes as agentSearchRoutes } from '../../../agent/src/server/http/routes/search'
import { treeRoutes as agentTreeRoutes } from '../../../agent/src/server/http/routes/tree'
import {
  __gitTestUtils as agentGitTestUtils,
  resolveGitFileUrl as resolveAgentGitFileUrl,
} from '../../../agent/src/server/git/gitFileUrl'

import { buildFilesystemAgentTools as buildCopiedFilesystemTools } from '../agent/tools/filesystem'
import { buildHarnessAgentTools as buildCopiedHarnessTools } from '../agent/tools/harness'
import { boundFs as copiedBoundFs } from '../agent/tools/operations/bound'
import { remoteSandboxBashOps as copiedRemoteSandboxBashOps } from '../agent/tools/operations/remoteSandbox'
import { buildUploadAgentTools as buildCopiedUploadTools } from '../agent/tools/upload'
import { fileRoutes as copiedFileRoutes } from '../server/routes/file'
import { fsEventsRoutes as copiedFsEventsRoutes } from '../server/routes/fsEvents'
import { gitRoutes as copiedGitRoutes } from '../server/routes/git'
import { searchRoutes as copiedSearchRoutes } from '../server/routes/search'
import { treeRoutes as copiedTreeRoutes } from '../server/routes/tree'
import {
  __gitTestUtils as copiedGitTestUtils,
  resolveGitFileUrl as resolveCopiedGitFileUrl,
} from '../server/routes/gitFileUrl'

interface TestRuntimeBundle {
  storageRoot?: string
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
  getRuntimeEnv?: () => Promise<Record<string, string>>
  bash?: { kind: 'host'; preserveHostHome?: boolean } | { kind: 'local-sandbox'; sandboxRoot: string } | { kind: 'remote'; defaultPath?: string }
  filesystem?: { kind: 'host' } | { kind: 'remote-workspace' }
}

interface RouteDependencies {
  workspace: Workspace
  fsEventsWorkspace: Workspace
  fileSearch: FileSearch
  hostRoot: string
  filesystemBindings: Array<{
    filesystem: string
    access: 'readonly' | 'readwrite'
    operations: {
      read(descriptor: { filesystem: string; path: string }): Promise<{ content: string; mtimeMs?: number }>
      list(descriptor: { filesystem: string; path: string }): Promise<{ entries: string[] }>
      find(descriptor: { filesystem: string; path: string }, pattern: string): Promise<{ paths: string[] }>
      grep(descriptor: { filesystem: string; path: string }, pattern: string): Promise<{ matches: Array<{ path: string; line: number; text: string }> }>
      stat(descriptor: { filesystem: string; path: string }): Promise<{ isDirectory: boolean }>
      rejectMutation(operation: string, descriptor: { filesystem: string; path: string }): never
    }
  }>
}

interface ParityTarget {
  name: 'agent-original' | 'boring-bash-copy'
  buildFilesystemTools(bundle: TestRuntimeBundle): AgentTool[]
  buildHarnessTools(bundle: TestRuntimeBundle): AgentTool[]
  buildUploadTools(bundle: TestRuntimeBundle): AgentTool[]
  boundFs: typeof agentBoundFs
  remoteSandboxBashOps: typeof agentRemoteSandboxBashOps
  registerRoutes(app: FastifyInstance, deps: RouteDependencies): Promise<void>
  resolveGitFileUrl: typeof resolveAgentGitFileUrl
  gitTestUtils: { runGit(args: string[], cwd: string): Promise<string> }
}

const targets: ParityTarget[] = [
  {
    name: 'agent-original',
    buildFilesystemTools: buildAgentFilesystemTools,
    buildHarnessTools: buildAgentHarnessTools,
    buildUploadTools: buildAgentUploadTools,
    boundFs: agentBoundFs,
    remoteSandboxBashOps: agentRemoteSandboxBashOps,
    async registerRoutes(app, deps) {
      await app.register(agentFileRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(agentTreeRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(agentSearchRoutes, { fileSearch: deps.fileSearch })
      await app.register(agentFsEventsRoutes, { workspace: deps.fsEventsWorkspace })
      await app.register(agentGitRoutes, { workspace: deps.workspace })
    },
    resolveGitFileUrl: resolveAgentGitFileUrl,
    gitTestUtils: agentGitTestUtils,
  },
  {
    name: 'boring-bash-copy',
    buildFilesystemTools: buildCopiedFilesystemTools,
    buildHarnessTools: buildCopiedHarnessTools,
    buildUploadTools: buildCopiedUploadTools,
    boundFs: copiedBoundFs,
    remoteSandboxBashOps: copiedRemoteSandboxBashOps,
    async registerRoutes(app, deps) {
      await app.register(copiedFileRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(copiedTreeRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(copiedSearchRoutes, { fileSearch: deps.fileSearch })
      await app.register(copiedFsEventsRoutes, { workspace: deps.fsEventsWorkspace })
      await app.register(copiedGitRoutes, {
        workspace: deps.workspace,
        getWorkspaceHostRoot: () => deps.hostRoot,
      })
    },
    resolveGitFileUrl: resolveCopiedGitFileUrl,
    gitTestUtils: copiedGitTestUtils,
  },
]

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-bash-parity-'))
  tempRoots.push(root)
  return root
}

function execResult(stdout = '', stderr = '', exitCode = 0): ExecResult {
  return {
    stdout: new TextEncoder().encode(stdout),
    stderr: new TextEncoder().encode(stderr),
    exitCode,
    durationMs: 1,
    truncated: false,
  }
}

function inMemoryWorkspace(root = '/workspace'): Workspace {
  const files = new Map<string, string>([
    ['hello.txt', 'hello parity'],
    ['records.json', '[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}]'],
  ])
  return {
    root,
    runtimeContext: { runtimeCwd: root },
    async readFile(path) {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    async readBinaryFile(path) {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return new TextEncoder().encode(value)
    },
    async writeFile(path, data) { files.set(path, data) },
    async writeBinaryFile(path, data) { files.set(path, new TextDecoder().decode(data)) },
    async unlink(path) { files.delete(path) },
    async readdir() {
      return [...files.keys()].map((name) => ({ name, kind: 'file' as const }))
    },
    async stat(path) {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { kind: 'file', size: new TextEncoder().encode(value).byteLength, mtimeMs: 42 }
    },
    async mkdir() {},
    async rename(from, to) {
      const value = files.get(from)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      files.set(to, value)
      files.delete(from)
    },
  }
}

function fakeSandbox(overrides: Partial<Sandbox> = {}): Sandbox {
  const runtimeContext = { runtimeCwd: '/workspace' }
  return {
    id: 'sandbox-parity',
    placement: 'remote',
    provider: 'parity',
    capabilities: ['exec', 'isolated-code'],
    runtimeContext,
    async exec(_command: string, opts?: ExecOptions) {
      const stdout = new TextEncoder().encode('sandbox parity\n')
      opts?.onStdout?.(stdout)
      return { ...execResult(), stdout }
    },
    async executeIsolatedCode() {
      return { sandboxId: 'isolated-parity', stdout: 'isolated parity', stderr: '', exitCode: 0 }
    },
    ...overrides,
  }
}

function toolContext(): ToolExecContext {
  return {
    abortSignal: new AbortController().signal,
    toolCallId: 'parity-call',
  }
}

function toolMetadata(tools: AgentTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    parameters: tool.parameters,
    readinessRequirements: tool.readinessRequirements,
  }))
}

async function observeTools(target: ParityTarget) {
  const workspace = inMemoryWorkspace()
  const sandbox = fakeSandbox()
  const bundle: TestRuntimeBundle = {
    storageRoot: '/workspace',
    workspace,
    sandbox,
    fileSearch: { async search() { return ['hello.txt'] } },
    filesystem: { kind: 'remote-workspace' },
    bash: { kind: 'remote' },
  }

  const filesystem = target.buildFilesystemTools(bundle)
  const harness = target.buildHarnessTools(bundle)
  const upload = target.buildUploadTools(bundle)
  const readResult = await filesystem.find((tool) => tool.name === 'read')!.execute(
    { path: 'hello.txt' },
    toolContext(),
  )
  const bashResult = await harness.find((tool) => tool.name === 'bash')!.execute(
    { command: 'printf parity' },
    toolContext(),
  )
  const isolatedResult = await harness.find((tool) => tool.name === 'execute_isolated_code')!.execute(
    { code: 'print("parity")', language: 'python' },
    toolContext(),
  )

  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
  vi.spyOn(Math, 'random').mockReturnValue(0.125)
  const uploadResult = await upload[0]!.execute({ path: 'hello.txt' }, toolContext())

  return {
    metadata: {
      filesystem: toolMetadata(filesystem),
      harness: toolMetadata(harness),
      upload: toolMetadata(upload),
    },
    results: { readResult, bashResult, isolatedResult, uploadResult },
  }
}

async function observeOperations(target: ParityTarget) {
  const root = await createTempRoot()
  await mkdir(join(root, 'nested'), { recursive: true })
  await writeFile(join(root, 'nested', 'seed.txt'), 'seed', 'utf8')
  const fs = target.boundFs(root)
  await fs.write.writeFile(join(root, 'created.txt'), 'created')
  const read = (await fs.read.readFile(join(root, 'created.txt'))).toString('utf8')
  const found = await fs.find.glob('*.txt', root, { ignore: [], limit: 10 })

  const calls: Array<{ command: string; cwd: string; env?: Record<string, string> }> = []
  const sandbox = fakeSandbox({
    async exec(command, opts) {
      calls.push({ command, cwd: opts?.cwd ?? '', env: opts?.env })
      opts?.onStdout?.(new TextEncoder().encode('stream'))
      return execResult('done')
    },
  })
  const chunks: string[] = []
  const remote = target.remoteSandboxBashOps(sandbox, {
    executionRuntimeEnv: { PARITY: '1' },
  })
  const remoteResult = await remote.exec('printf parity', '/workspace', {
    onData: (chunk) => chunks.push(chunk.toString('utf8')),
    timeout: 3,
  })

  return {
    read,
    found: found.map((path) => path.replace(root, '<root>')).sort(),
    calls,
    chunks,
    remoteResult,
  }
}

function readonlyBinding(): RouteDependencies['filesystemBindings'][number] {
  return {
    filesystem: 'company',
    access: 'readonly',
    operations: {
      async read({ path }) { return { content: `company:${path}`, mtimeMs: 7 } },
      async list() { return { entries: ['policy.md'] } },
      async find() { return { paths: ['policy.md'] } },
      async grep() { return { matches: [{ path: 'policy.md', line: 1, text: 'policy' }] } },
      async stat() { return { isDirectory: false } },
      rejectMutation(operation) { throw new Error(`readonly:${operation}`) },
    },
  }
}

function normalizeVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeVolatileFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === 'mtimeMs' && typeof child === 'number'
      ? '<mtime>'
      : normalizeVolatileFields(child),
  ]))
}

async function responseShape(response: Awaited<ReturnType<FastifyInstance['inject']>>) {
  const contentType = response.headers['content-type'] ?? ''
  return {
    statusCode: response.statusCode,
    contentType,
    payload: contentType.includes('application/json')
      ? normalizeVolatileFields(response.json())
      : response.body,
  }
}

async function observeRoutes(target: ParityTarget) {
  const root = await createTempRoot()
  await writeFile(join(root, 'hello.txt'), 'hello parity', 'utf8')
  await writeFile(join(root, 'records.json'), '[{"id":1,"name":"Ada"},{"id":2,"name":"Lin"}]', 'utf8')
  const workspace = createNodeWorkspace(root)
  const fsEventsWorkspace = inMemoryWorkspace()
  const fileSearch = {
    search: vi.fn(async (glob: string, limit?: number) => [`${glob}:${limit}`]),
  }
  const readSpy = vi.spyOn(workspace, 'readFile')
  const readWithStatSpy = vi.spyOn(workspace, 'readFileWithStat')
  const app = Fastify()
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer parity') {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'unauthorized' } })
    }
  })
  await target.registerRoutes(app, {
    workspace,
    fsEventsWorkspace,
    fileSearch,
    hostRoot: root,
    filesystemBindings: [readonlyBinding()],
  })
  await app.ready()

  const routes = app.printRoutes()
  const denied = await responseShape(await app.inject({
    method: 'GET',
    url: '/api/v1/files?path=hello.txt',
  }))
  const effectsAfterDenied = readSpy.mock.calls.length + (readWithStatSpy?.mock.calls.length ?? 0)
  const headers = { authorization: 'Bearer parity' }
  const responses = {
    file: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files?path=hello.txt', headers })),
    records: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files/records?path=records.json&q=ada', headers })),
    traversal: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files?path=../secret.txt', headers })),
    readonly: await responseShape(await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers,
      payload: { filesystem: 'company', path: 'policy.md', content: 'changed' },
    })),
    spoof: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files?filesystem=missing&path=policy.md', headers })),
    tree: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/tree?path=.&recursive=true', headers })),
    search: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files/search?q=*.ts&limit=3', headers })),
    searchValidation: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/files/search', headers })),
    git: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=hello.txt', headers })),
    fsEventsUnsupported: await responseShape(await app.inject({ method: 'GET', url: '/api/v1/fs/events', headers })),
  }
  await app.close()
  return { routes, denied, effectsAfterDenied, responses }
}

async function observeGitHelper(target: ParityTarget) {
  const original = target.gitTestUtils.runGit
  target.gitTestUtils.runGit = vi.fn(async (args) => {
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo'
    if (args[0] === 'remote') return 'git@github.com:example/parity.git'
    if (args[0] === 'symbolic-ref') return 'main'
    throw new Error(`unexpected git args: ${args.join(' ')}`)
  })
  try {
    return await target.resolveGitFileUrl('/repo', 'src/a b.ts')
  } finally {
    target.gitTestUtils.runGit = original
  }
}

describe.each(targets)('$name frozen contract', (target) => {
  test('runs the shared tool catalog and execution contract', async () => {
    const observation = await observeTools(target)
    expect(observation.metadata.filesystem.map((tool) => tool.name)).toEqual([
      'read', 'write', 'edit', 'find', 'grep', 'ls',
    ])
    expect(observation.metadata.harness.map((tool) => tool.name)).toEqual([
      'bash', 'execute_isolated_code',
    ])
    expect(observation.metadata.upload.map((tool) => tool.name)).toEqual(['upload_file'])
    expect(observation.results.readResult.isError).toBe(false)
    expect(observation.results.bashResult.isError).toBe(false)
    expect(observation.results.isolatedResult.isError).toBe(false)
    expect(observation.results.uploadResult.isError).toBe(false)
  })

  test('runs the shared Operations-adapter contract', async () => {
    const observation = await observeOperations(target)
    expect(observation).toMatchObject({
      read: 'created',
      found: ['<root>/created.txt', '<root>/nested/seed.txt'],
      remoteResult: { exitCode: 0 },
    })
  })

  test('runs the shared route/auth/readonly/spoof/error contract', async () => {
    const observation = await observeRoutes(target)
    expect(observation.effectsAfterDenied).toBe(0)
    expect(observation.denied).toMatchObject({ statusCode: 401 })
    expect(observation.responses.file).toMatchObject({ statusCode: 200 })
    expect(observation.responses.records).toMatchObject({ statusCode: 200 })
    expect(observation.responses.readonly).toMatchObject({
      statusCode: 403,
      payload: { error: { code: 'readonly' } },
    })
    expect(observation.responses.spoof).toMatchObject({
      statusCode: 404,
      payload: { error: { code: 'not_found_or_denied' } },
    })
    expect(observation.responses.searchValidation).toMatchObject({
      statusCode: 400,
      payload: { error: { code: 'validation_error' } },
    })
    expect(observation.responses.fsEventsUnsupported).toMatchObject({
      statusCode: 200,
      payload: expect.stringContaining('event: unsupported'),
    })
  })
})

test('Agent originals and boring-bash copies have identical observable behavior', async () => {
  const [agent, copied] = targets
  expect(await observeTools(copied!)).toEqual(await observeTools(agent!))
  expect(await observeOperations(copied!)).toEqual(await observeOperations(agent!))
  expect(await observeRoutes(copied!)).toEqual(await observeRoutes(agent!))
  expect(await observeGitHelper(copied!)).toEqual(await observeGitHelper(agent!))
})
