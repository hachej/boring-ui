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
import {
  boundFs,
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
  remoteSandboxBashOps,
} from '@hachej/boring-bash/agent'
import {
  __gitTestUtils,
  fileRoutes,
  fsEventsRoutes,
  gitRoutes,
  resolveGitFileUrl,
  searchRoutes,
  treeRoutes,
} from '@hachej/boring-bash/server'

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
  name: 'boring-bash-package'
  buildFilesystemTools(bundle: TestRuntimeBundle): AgentTool[]
  buildHarnessTools(bundle: TestRuntimeBundle): AgentTool[]
  buildUploadTools(bundle: TestRuntimeBundle): AgentTool[]
  boundFs: typeof boundFs
  remoteSandboxBashOps: typeof remoteSandboxBashOps
  registerRoutes(app: FastifyInstance, deps: RouteDependencies): Promise<void>
  resolveGitFileUrl: typeof resolveGitFileUrl
  gitTestUtils: { runGit(args: string[], cwd: string): Promise<string> }
}

const targets: ParityTarget[] = [
  {
    name: 'boring-bash-package',
    buildFilesystemTools: buildFilesystemAgentTools,
    buildHarnessTools: buildHarnessAgentTools,
    buildUploadTools: buildUploadAgentTools,
    boundFs,
    remoteSandboxBashOps,
    async registerRoutes(app, deps) {
      await app.register(fileRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(treeRoutes, {
        workspace: deps.workspace,
        filesystemBindings: deps.filesystemBindings,
      })
      await app.register(searchRoutes, { fileSearch: deps.fileSearch })
      await app.register(fsEventsRoutes, { workspace: deps.fsEventsWorkspace })
      await app.register(gitRoutes, {
        workspace: deps.workspace,
        getWorkspaceHostRoot: () => deps.hostRoot,
      })
    },
    resolveGitFileUrl,
    gitTestUtils: __gitTestUtils,
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
  const remote = target.remoteSandboxBashOps(sandbox, undefined, {
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
  const workspace = inMemoryWorkspace(root)
  const fsEventsWorkspace = inMemoryWorkspace()
  const fileSearch = {
    search: vi.fn(async (glob: string, limit?: number) => [`${glob}:${limit}`]),
  }
  const readSpy = vi.spyOn(workspace, 'readFile')
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
  const effectsAfterDenied = readSpy.mock.calls.length
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

test('upload_file falls back to the host storage root when binary reads are unavailable', async () => {
  const storageRoot = await createTempRoot()
  await writeFile(join(storageRoot, 'plot.png'), new Uint8Array([1, 2, 3]))
  const workspace: Workspace = {
    ...inMemoryWorkspace(),
    readBinaryFile: undefined,
    writeBinaryFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
  }
  const bundle: TestRuntimeBundle = {
    storageRoot,
    workspace,
    sandbox: fakeSandbox(),
    fileSearch: { async search() { return [] } },
  }
  const [upload] = buildUploadAgentTools(bundle)

  const result = await upload!.execute({ path: 'plot.png' }, toolContext())

  expect(result.isError).toBe(false)
  expect(workspace.mkdir).toHaveBeenCalledWith('assets/images', { recursive: true })
  expect(workspace.writeBinaryFile).toHaveBeenCalledWith(
    expect.stringMatching(/^assets\/images\/plot-[a-z0-9]+-[a-z0-9]+\.png$/),
    expect.objectContaining({ byteLength: 3 }),
  )
})

test('package git helper preserves the frozen URL contract', async () => {
  expect(await observeGitHelper(targets[0]!)).toEqual({
    enabled: true,
    url: 'https://github.com/example/parity/blob/main/src/a%20b.ts',
  })
})
