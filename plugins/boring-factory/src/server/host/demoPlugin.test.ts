import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFactoryDemoPlugin,
  type DemoSandboxFactory,
  type DemoSandboxHandle,
  type LocalDemoProcessRuntime,
} from './demoPlugin'
import type { FactoryEpicEntry, FactoryEpicRegistry } from './epicRegistry'
import { nodeLocalProcessRuntime } from './localDemoRuntime'
import type { FactorySessionBindings } from './sessionBindings'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

async function createGitWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'factory-demo-workspace-'))
  temporaryRoots.push(root)
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.test/org/repo.git'], { cwd: root })
  await writeFile(resolve(root, 'tracked.txt'), 'tracked-content')
  await writeFile(resolve(root, 'server.mjs'), [
    "import { createServer } from 'node:http'",
    "createServer((request, response) => { response.statusCode = request.url === '/ready' ? 200 : 404; response.end('ready') })",
    "  .listen(Number(process.env.PORT), '127.0.0.1')",
    '',
  ].join('\n'))
  await execFileAsync('git', ['add', 'tracked.txt', 'server.mjs'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })
  return root
}

async function makeStateRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'factory-demo-state-'))
  temporaryRoots.push(root)
  return root
}

function vercelEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    BORING_FACTORY_SANDBOX_PROVIDER: 'vercel',
    BORING_FACTORY_VERCEL_SNAPSHOT_ID: 'snap_123',
    ...overrides,
  } as NodeJS.ProcessEnv
}

function localEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { BORING_FACTORY_SANDBOX_PROVIDER: 'local-simulation', ...overrides } as NodeJS.ProcessEnv
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') return rejectPort(new Error('failed to allocate a test port'))
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

const loopbackSupported = await getFreePort().then(() => true, () => false)

interface FakeSandbox extends DemoSandboxHandle {
  writtenFiles?: { path: string; content: string }[]
  commands: { cmd: string; args?: string[]; detached?: boolean }[]
  stopped: boolean
}

function createFakeFactory(options: {
  bootstrapExitCode?: number
  installExitCode?: number
  domain?: string
} = {}): { factory: DemoSandboxFactory; sandboxes: Map<string, FakeSandbox> } {
  const sandboxes = new Map<string, FakeSandbox>()
  const factory: DemoSandboxFactory = {
    async create(params) {
      const sandbox: FakeSandbox = {
        name: params.name,
        commands: [],
        stopped: false,
        async writeFiles(files) {
          sandbox.writtenFiles = files
        },
        async runCommand(cmd) {
          sandbox.commands.push(cmd)
          if (cmd.args?.[1] === undefined) return { exitCode: 0 }
          const script = cmd.args[1]
          if (script.includes('factory-bootstrap ok')) {
            return { exitCode: options.bootstrapExitCode ?? 0 }
          }
          if (!cmd.detached && sandbox.commands.length === 2 && options.installExitCode !== undefined) {
            return { exitCode: options.installExitCode }
          }
          return { exitCode: 0 }
        },
        domain() {
          return options.domain ?? 'https://fake-sandbox.vercel.run'
        },
        async stop() {
          sandbox.stopped = true
          return {}
        },
      }
      sandboxes.set(params.name, sandbox)
      return sandbox
    },
    async get(params) {
      const sandbox = sandboxes.get(params.name)
      if (!sandbox) throw new Error(`no fake sandbox named ${params.name}`)
      return sandbox
    },
  }
  return { factory, sandboxes }
}

function fakeFetch(status: number): typeof fetch {
  return vi.fn(async () => new Response('', { status })) as unknown as typeof fetch
}

function createFakeLocalRuntime(): LocalDemoProcessRuntime & { readonly alive: Set<number> } {
  const alive = new Set<number>()
  let nextProcessId = 10_000
  return {
    alive,
    async start() {
      const processId = nextProcessId++
      alive.add(processId)
      return processId
    },
    isAlive(processId) {
      return processId !== undefined && alive.has(processId)
    },
    async stop(processId) {
      if (processId !== undefined) alive.delete(processId)
    },
  }
}

function epicDeps(worktree: string): {
  registry: FactoryEpicRegistry
  sessionBindings: FactorySessionBindings
} {
  const entry: FactoryEpicEntry = {
    epicKey: 'epic-1',
    featureName: 'Epic One',
    worktree,
    branch: 'main',
    repositoryRoot: worktree,
    createdAt: '2026-09-05T00:00:00.000Z',
    status: 'active',
  }
  const bindings: Record<string, string> = {
    s1: entry.epicKey,
    'session-orch-1': entry.epicKey,
  }
  return {
    registry: {
      load: async () => [entry],
      list: async () => [entry],
      get: async (epicKey) => epicKey === entry.epicKey ? entry : undefined,
      register: async () => entry,
      setOrchestratorSession: async () => entry,
      markClosed: async () => ({ ...entry, status: 'closed' }),
    },
    sessionBindings: {
      load: async () => ({ ...bindings }),
      get: async (sessionId) => bindings[sessionId],
      bind: async (sessionId, epicKey) => { bindings[sessionId] = epicKey },
      unbind: async (sessionId) => { delete bindings[sessionId] },
      inherit: async (parentSessionId, childSessionId) => {
        const epicKey = bindings[parentSessionId]!
        bindings[childSessionId] = epicKey
        return epicKey
      },
      reconcile: async () => ({ droppedSessionIds: [], restoredOrchestratorSessionIds: [] }),
    },
  }
}

describe('factory demo plugin', () => {
  it('terminates the complete detached local process group', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'factory-demo-process-'))
    temporaryRoots.push(root)
    const processId = await nodeLocalProcessRuntime.start(
      `${process.execPath} -e "setInterval(() => {}, 1000)"`,
      root,
      4300,
    )
    expect(nodeLocalProcessRuntime.isAlive(processId, root)).toBe(true)
    await nodeLocalProcessRuntime.stop(processId, root)
    expect(nodeLocalProcessRuntime.isAlive(processId, root)).toBe(false)
  })

  it('grants `demo_sandbox` only to boring-orchestrator', () => {
    const { plugin } = createFactoryDemoPlugin({
      stateRoot: '/tmp/does-not-matter',
      ...epicDeps('/tmp/does-not-matter'),
      env: vercelEnv(),
      workspaceScopeId: 'factory-hub',
    })
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }).map((tool) => tool.name)).toEqual(['demo_sandbox'])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-worker' })).toEqual([])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-reviewer' })).toEqual([])
  })

  it('supports status with the local provider configured', async () => {
    const stateRoot = await makeStateRoot()
    const { plugin } = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps('/tmp/does-not-matter'),
      env: localEnv(),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute({ op: 'status' }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' })
    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({ demos: [] })
  })

  it('start writes fetch-bootstrap files, runs bootstrap + command, polls ready, and persists demos.json', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const result = await tool!.execute(
      { op: 'start', command: 'node server.js', port: 3000 },
      { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 'session-orch-1' },
    )
    expect(result.isError).toBeFalsy()
    const started = JSON.parse(result.content[0]!.text) as { id: string; url: string; sha: string; port: number; ready: boolean }
    expect(started.ready).toBe(true)
    expect(started.url).toBe('https://fake-sandbox.vercel.run')
    expect(started.port).toBe(3000)
    expect(started.sha).toMatch(/^[0-9a-f]{40}$/)

    const sandbox = [...sandboxes.values()][0]!
    expect(sandbox.writtenFiles?.map((f) => f.path)).toEqual(
      expect.arrayContaining(['.factory-sha', '.factory-remote', 'factory-bootstrap.sh']),
    )
    expect(sandbox.commands.some((c) => c.detached === true && c.args?.[1] === 'node server.js')).toBe(true)

    const onDisk = JSON.parse(await readFile(resolve(stateRoot, 'demos.json'), 'utf8')) as { demos: Record<string, { sandboxId: string; sessionId?: string }> }
    const entry = onDisk.demos[started.id]!
    expect(entry.sandboxId).toBe(sandbox.name)
    expect(entry.sessionId).toBe('session-orch-1')
  })

  it('starts, reports, and stops a local exact-SHA demo lease', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const requestedSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })).stdout.trim()
    await writeFile(resolve(workspaceRoot, 'tracked.txt'), 'newer-content')
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: workspaceRoot })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'newer'], { cwd: workspaceRoot })
    const stateRoot = await makeStateRoot()
    const requestedPort = 4317
    const localProcessRuntime = createFakeLocalRuntime()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv({ BORING_FACTORY_DEMO_HOST: '100.64.0.10' }),
      fetchImpl: fakeFetch(200),
      localProcessRuntime,
      localPortAvailable: async () => true,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const startResult = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: requestedPort, readyPath: '/ready', sha: requestedSha },
      { abortSignal: new AbortController().signal, toolCallId: 'local-start', sessionId: 's1' },
    )
    expect(startResult.isError).toBeFalsy()
    const started = startResult.details as { id: string; leaseId: string; url: string; provider: string; sha: string; port: number }
    expect(started).toMatchObject({
      id: started.leaseId,
      url: `http://100.64.0.10:${requestedPort}`,
      provider: 'local',
      port: requestedPort,
    })
    expect(started.sha).toBe(requestedSha)

    const entry = (await handle.control.listDemos())[started.leaseId]!
    expect(entry).toMatchObject({ provider: 'local', leaseId: started.leaseId, processId: expect.any(Number) })
    await expect(readFile(resolve(entry.leaseRoot!, '.factory-sha'), 'utf8')).resolves.toBe(started.sha)
    await expect(readFile(resolve(entry.leaseRoot!, 'tracked.txt'), 'utf8')).resolves.toBe('tracked-content')
    expect(localProcessRuntime.alive.has(entry.processId!)).toBe(true)

    const status = await tool!.execute(
      { op: 'status' },
      { abortSignal: new AbortController().signal, toolCallId: 'local-status', sessionId: 's1' },
    )
    expect(status.details).toMatchObject({ demos: [expect.objectContaining({ id: started.leaseId, provider: 'local', running: true })] })

    const duplicate = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: requestedPort, readyPath: '/ready' },
      { abortSignal: new AbortController().signal, toolCallId: 'local-duplicate', sessionId: 's1' },
    )
    expect(duplicate.details).toMatchObject({ code: 'DEMO_ALREADY_RUNNING', id: started.leaseId })

    const stopResult = await tool!.execute(
      { op: 'stop', id: started.leaseId },
      { abortSignal: new AbortController().signal, toolCallId: 'local-stop', sessionId: 's1' },
    )
    expect(stopResult.details).toEqual({ id: started.leaseId, stopped: true })
    expect(localProcessRuntime.alive.has(entry.processId!)).toBe(false)
    await expect(access(entry.leaseRoot!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await handle.control.listDemos()).toEqual({})
    handle.close()
  })

  it.runIf(loopbackSupported)('runs the local lifecycle against a tiny real HTTP server', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const port = await getFreePort()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv(),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const started = (await tool!.execute(
      { op: 'start', command: 'node server.mjs', port, readyPath: '/ready' },
      { abortSignal: new AbortController().signal, toolCallId: 'real-local-start', sessionId: 's1' },
    )).details as { id: string; url: string }
    try {
      expect(started.url).toBe(`http://127.0.0.1:${port}`)
      await expect(fetch(`${started.url}/ready`).then((response) => response.status)).resolves.toBe(200)
    } finally {
      await handle.control.stopDemo(started.id)
      handle.close()
    }
  })

  it('falls back to a free port in 4300-4399 when the requested local port is busy', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const occupiedPort = 4400
    const localProcessRuntime = createFakeLocalRuntime()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv(),
      fetchImpl: fakeFetch(200),
      localProcessRuntime,
      localPortAvailable: async (port) => port === 4300,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    try {
      const result = await tool!.execute(
        { op: 'start', command: 'node server.mjs', port: occupiedPort, readyPath: '/ready' },
        { abortSignal: new AbortController().signal, toolCallId: 'port-fallback', sessionId: 's1' },
      )
      expect(result.isError).toBeFalsy()
      const started = result.details as { id: string; port: number }
      expect(started.port).toBeGreaterThanOrEqual(4300)
      expect(started.port).toBeLessThanOrEqual(4399)
      expect(started.port).not.toBe(occupiedPort)
      await tool!.execute(
        { op: 'stop', id: started.id },
        { abortSignal: new AbortController().signal, toolCallId: 'port-fallback-stop', sessionId: 's1' },
      )
    } finally {
      handle.close()
    }
  })

  it('falls back from a failed Vercel lease creation and reports the provider and reason', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const port = 4321
    const { factory } = createFakeFactory()
    const localProcessRuntime = createFakeLocalRuntime()
    vi.spyOn(factory, 'create').mockRejectedValueOnce(new Error('HTTP 402: quota exceeded'))
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      localProcessRuntime,
      localPortAvailable: async () => true,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port, readyPath: '/ready' },
      { abortSignal: new AbortController().signal, toolCallId: 'provider-fallback', sessionId: 's1' },
    )
    expect(result.isError).toBeFalsy()
    expect(result.details).toMatchObject({
      provider: 'local',
      fallbackFrom: 'vercel',
      reason: 'HTTP 402: quota exceeded',
    })
    const started = result.details as { id: string }
    await handle.control.stopDemo(started.id)
    handle.close()
  })

  it('rejects an out-of-range port and an unconfigured command before touching the sandbox factory', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory } = createFakeFactory()
    const createSpy = vi.spyOn(factory, 'create')
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const badPort = await tool!.execute(
      { op: 'start', command: 'node server.js', port: 80 },
      { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' },
    )
    expect(badPort.isError).toBe(true)

    const badCommand = await tool!.execute(
      { op: 'start', command: '', port: 3000 },
      { abortSignal: new AbortController().signal, toolCallId: 'c2', sessionId: 's1' },
    )
    expect(badCommand.isError).toBe(true)

    const badTtl = await tool!.execute(
      { op: 'start', command: 'node server.js', port: 3000, ttlMinutes: 999 },
      { abortSignal: new AbortController().signal, toolCallId: 'c3', sessionId: 's1' },
    )
    expect(badTtl.isError).toBe(true)

    expect(createSpy).not.toHaveBeenCalled()
  })

  it('start fails the whole op and stops the sandbox when bootstrap exits non-zero', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory({ bootstrapExitCode: 1 })
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const result = await tool!.execute(
      { op: 'start', command: 'node server.js', port: 3000 },
      { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' },
    )
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: 'BOOTSTRAP_FAILED' })
    const sandbox = [...sandboxes.values()][0]!
    expect(sandbox.stopped).toBe(true)

    const statusResult = await tool!.execute({ op: 'status' }, { abortSignal: new AbortController().signal, toolCallId: 'c2', sessionId: 's1' })
    expect(JSON.parse(statusResult.content[0]!.text)).toEqual({ demos: [] })
  })

  it('stop calls sandbox.stop() and removes the persisted entry; status/list report it correctly beforehand', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const started = JSON.parse((await tool!.execute(
      { op: 'start', command: 'node server.js', port: 3000 },
      { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' },
    )).content[0]!.text) as { id: string }

    const statusResult = await tool!.execute({ op: 'status' }, { abortSignal: new AbortController().signal, toolCallId: 'c2', sessionId: 's1' })
    const status = JSON.parse(statusResult.content[0]!.text) as { demos: { id: string; expired: boolean }[] }
    expect(status.demos).toHaveLength(1)
    expect(status.demos[0]!.id).toBe(started.id)
    expect(status.demos[0]!.expired).toBe(false)

    const listResult = await tool!.execute({ op: 'list' }, { abortSignal: new AbortController().signal, toolCallId: 'c2b', sessionId: 's1' })
    expect(JSON.parse(listResult.content[0]!.text)).toEqual(JSON.parse(statusResult.content[0]!.text))

    const stopResult = await tool!.execute(
      { op: 'stop', id: started.id },
      { abortSignal: new AbortController().signal, toolCallId: 'c3', sessionId: 's1' },
    )
    expect(stopResult.isError).toBeFalsy()
    const sandbox = [...sandboxes.values()][0]!
    expect(sandbox.stopped).toBe(true)

    const afterStop = await tool!.execute({ op: 'status' }, { abortSignal: new AbortController().signal, toolCallId: 'c4', sessionId: 's1' })
    expect(JSON.parse(afterStop.content[0]!.text)).toEqual({ demos: [] })
  })

  it('stop on an unknown id returns NOT_FOUND', async () => {
    const stateRoot = await makeStateRoot()
    const { factory } = createFakeFactory()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps('/tmp/does-not-matter'),
      env: vercelEnv(),
      sandboxFactory: factory,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute({ op: 'stop', id: 'nope' }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' })
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rearm() stops entries already past expiresAt and keeps entries that are still live', async () => {
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory()
    // Pre-seed two sandboxes the fake factory can `get()` back by name.
    await factory.create({ name: 'factory-demo-expired', snapshotId: 'snap', port: 3000, timeoutMs: 1000 })
    await factory.create({ name: 'factory-demo-live', snapshotId: 'snap', port: 3000, timeoutMs: 1000 })

    await writeFile(resolve(stateRoot, 'demos.json'), JSON.stringify({
      demos: {
        'demo-expired': {
          epicKey: 'epic-1',
          sandboxId: 'factory-demo-expired',
          url: 'https://expired.vercel.run',
          sha: 'a'.repeat(40),
          port: 3000,
          command: 'node server.js',
          startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        'demo-live': {
          epicKey: 'epic-1',
          sandboxId: 'factory-demo-live',
          url: 'https://live.vercel.run',
          sha: 'b'.repeat(40),
          port: 3000,
          command: 'node server.js',
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
      },
    }, null, 2), 'utf8')

    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps('/tmp/does-not-matter'),
      env: vercelEnv(),
      sandboxFactory: factory,
      workspaceScopeId: 'factory-hub',
    })
    const removed = await handle.rearm()
    expect(removed).toBe(1)
    expect(sandboxes.get('factory-demo-expired')!.stopped).toBe(true)
    expect(sandboxes.get('factory-demo-live')!.stopped).toBe(false)

    const onDisk = JSON.parse(await readFile(resolve(stateRoot, 'demos.json'), 'utf8')) as { demos: Record<string, unknown> }
    expect(Object.keys(onDisk.demos)).toEqual(['demo-live'])

    handle.close()
  })

  it('rearm() drops a persisted local demo whose process is dead and releases its lease directory', async () => {
    const stateRoot = await makeStateRoot()
    const leaseRoot = resolve(stateRoot, 'demo-leases', 'epic-1', 'dead-local')
    await mkdir(leaseRoot, { recursive: true })
    await writeFile(resolve(leaseRoot, '.factory-sha'), 'a'.repeat(40))
    await writeFile(resolve(stateRoot, 'demos.json'), JSON.stringify({
      demos: {
        'dead-local': {
          epicKey: 'epic-1',
          sandboxId: 'dead-local',
          provider: 'local',
          leaseId: 'dead-local',
          leaseRoot,
          processId: 2_000_000_000,
          url: 'http://127.0.0.1:4300',
          sha: 'a'.repeat(40),
          port: 4300,
          command: 'node server.mjs',
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        },
      },
    }, null, 2))

    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps('/tmp/does-not-matter'),
      env: localEnv(),
      workspaceScopeId: 'factory-hub',
    })
    await expect(handle.rearm()).resolves.toBe(1)
    await expect(handle.control.listDemos()).resolves.toEqual({})
    await expect(access(leaseRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    handle.close()
  })
})
