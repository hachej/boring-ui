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
    "createServer((request, response) => {",
    "  response.statusCode = request.url === '/ready' ? 200 : 404",
    "  response.setHeader('x-boring-factory-demo-token', request.headers['x-boring-factory-demo-token'] ?? '')",
    "  response.end('ready')",
    '})',
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
  return vi.fn(async (_input: unknown, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('x-boring-factory-demo-token')
    return new Response('', { status, ...(token ? { headers: { 'x-boring-factory-demo-token': token } } : {}) })
  }) as unknown as typeof fetch
}

function createFakeLocalRuntime(): LocalDemoProcessRuntime & {
  readonly alive: Set<number>
  readonly starts: { command: string; cwd: string; env: Record<string, string> }[]
  readonly runs: { command: string; cwd: string; env: Record<string, string> }[]
} {
  const alive = new Set<number>()
  const starts: { command: string; cwd: string; env: Record<string, string> }[] = []
  const runs: { command: string; cwd: string; env: Record<string, string> }[] = []
  let nextProcessId = 10_000
  return {
    alive,
    starts,
    runs,
    async start(command, cwd, env) {
      const processId = nextProcessId++
      alive.add(processId)
      starts.push({ command, cwd, env })
      return { processId, processStartTime: `start-${processId}` }
    },
    async run(command, cwd, env) {
      runs.push({ command, cwd, env })
      return 0
    },
    isAlive(identity) {
      return identity !== undefined && alive.has(identity.processId)
    },
    isListeningOnLoopback() {
      return true
    },
    async stop(identity) {
      if (identity !== undefined) alive.delete(identity.processId)
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
    const minimalEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
    await expect(nodeLocalProcessRuntime.run('true', root, minimalEnv, 1_000)).resolves.toBe(0)
    const childPidPath = resolve(root, 'child.pid')
    await writeFile(resolve(root, 'resistant.mjs'), [
      "import { spawn } from 'node:child_process'",
      "import { writeFileSync } from 'node:fs'",
      `const child = spawn(${JSON.stringify(process.execPath)}, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })`,
      `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid))`,
      'setInterval(() => {}, 1000)',
    ].join('\n'))
    const identity = await nodeLocalProcessRuntime.start(
      `${process.execPath} resistant.mjs`,
      root,
      minimalEnv,
    )
    await vi.waitFor(async () => await expect(access(childPidPath)).resolves.toBeUndefined())
    const childPid = Number(await readFile(childPidPath, 'utf8'))
    expect(nodeLocalProcessRuntime.isAlive(identity)).toBe(true)
    await nodeLocalProcessRuntime.stop(identity)
    expect(nodeLocalProcessRuntime.isAlive(identity)).toBe(false)
    const childStat = await readFile(`/proc/${childPid}/stat`, 'utf8').catch(() => undefined)
    expect(childStat === undefined || /\) Z /.test(childStat)).toBe(true)
  })

  it('rejects a reused leader pid whose /proc start time differs', async () => {
    const current = await nodeLocalProcessRuntime.start(
      `${process.execPath} -e "setInterval(() => {}, 1000)"`,
      process.cwd(),
      { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    )
    try {
      expect(nodeLocalProcessRuntime.isAlive({ ...current, processStartTime: `${current.processStartTime}-reused` })).toBe(false)
      await nodeLocalProcessRuntime.stop({ ...current, processStartTime: `${current.processStartTime}-reused` })
      expect(nodeLocalProcessRuntime.isAlive(current)).toBe(true)
    } finally {
      await nodeLocalProcessRuntime.stop(current)
    }
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

  it('rejects wildcard and non-address owner-facing hosts before starting a local process', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const localProcessRuntime = createFakeLocalRuntime()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv({ BORING_FACTORY_DEMO_HOST: '0.0.0.0' }),
      localProcessRuntime,
      localPortAvailable: async () => true,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: 4316 },
      { abortSignal: new AbortController().signal, toolCallId: 'wildcard-host', sessionId: 's1' },
    )
    expect(result.details).toMatchObject({ code: 'LOCAL_START_FAILED', message: expect.stringContaining('non-wildcard') })
    expect(localProcessRuntime.starts).toHaveLength(0)
    handle.close()
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
      env: localEnv(),
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
    expect(startResult.isError, JSON.stringify(startResult.details)).toBeFalsy()
    const started = startResult.details as { id: string; leaseId: string; url: string; provider: string; sha: string; port: number }
    expect(started).toMatchObject({
      id: started.leaseId,
      url: `http://127.0.0.1:${requestedPort}`,
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

  it('passes only the local demo environment allowlist and rejects shell control operators', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const localProcessRuntime = createFakeLocalRuntime()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv({
        PATH: '/safe/bin',
        HOME: '/safe/home',
        LANG: 'C.UTF-8',
        TZ: 'UTC',
        NODE_OPTIONS: '--no-warnings',
        CI: '1',
        OPENAI_API_KEY: 'must-not-pass',
        VERCEL_TOKEN: 'must-not-pass',
        CUSTOM_SECRET: 'must-not-pass',
      }),
      fetchImpl: fakeFetch(200),
      localProcessRuntime,
      localPortAvailable: async () => true,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []

    const rejected = await tool!.execute(
      { op: 'start', command: 'node server.mjs && env', port: 4318 },
      { abortSignal: new AbortController().signal, toolCallId: 'local-control-op', sessionId: 's1' },
    )
    expect(rejected.details).toMatchObject({ code: 'INVALID_COMMAND' })
    expect(localProcessRuntime.starts).toHaveLength(0)

    const started = await tool!.execute(
      { op: 'start', command: 'node server.mjs', install: 'pnpm install', port: 4318 },
      { abortSignal: new AbortController().signal, toolCallId: 'local-env', sessionId: 's1' },
    )
    expect(started.isError).toBeFalsy()
    expect(localProcessRuntime.starts[0]!.env).toEqual({
      PATH: '/safe/bin',
      HOME: '/safe/home',
      LANG: 'C.UTF-8',
      TZ: 'UTC',
      NODE_OPTIONS: '--no-warnings',
      CI: '1',
      PORT: '4318',
      HOST: '127.0.0.1',
      BORING_FACTORY_DEMO_PORT: '4318',
      BORING_FACTORY_DEMO_LEASE_ID: expect.any(String),
      BORING_FACTORY_DEMO_SHA: expect.stringMatching(/^[0-9a-f]{40}$/),
      BORING_FACTORY_DEMO_READY_NONCE: expect.any(String),
    })
    expect(localProcessRuntime.runs).toEqual([{
      command: 'pnpm install',
      cwd: localProcessRuntime.starts[0]!.cwd,
      env: localProcessRuntime.starts[0]!.env,
    }])
    await handle.control.stopDemo((started.details as { id: string }).id)
    handle.close()
  })

  it('aborts a readiness fetch that never responds and cleans up the local process', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const localProcessRuntime = createFakeLocalRuntime()
    const pendingFetch = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })) as unknown as typeof fetch
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv(),
      fetchImpl: pendingFetch,
      localProcessRuntime,
      localPortAvailable: async () => true,
      readyPollTimeoutMs: 25,
      readyPollIntervalMs: 10,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: 4319 },
      { abortSignal: new AbortController().signal, toolCallId: 'pending-ready', sessionId: 's1' },
    )
    expect(result.details).toMatchObject({ code: 'READY_FAILED' })
    expect(pendingFetch).toHaveBeenCalled()
    expect(localProcessRuntime.alive).toEqual(new Set())
    handle.close()
  })

  it('does not accept another server\'s HTTP 200 without the per-demo readiness token', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const localProcessRuntime = createFakeLocalRuntime()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv(),
      fetchImpl: vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch,
      localProcessRuntime,
      localPortAvailable: async () => true,
      readyPollTimeoutMs: 20,
      readyPollIntervalMs: 5,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: 4320 },
      { abortSignal: new AbortController().signal, toolCallId: 'wrong-ready-server', sessionId: 's1' },
    )
    expect(result.details).toMatchObject({ code: 'READY_FAILED', message: expect.stringContaining('authenticated') })
    expect(localProcessRuntime.alive).toEqual(new Set())
    handle.close()
  })

  it.runIf(loopbackSupported)('runs the local lifecycle against a tiny real HTTP server', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const port = await getFreePort()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv({ BORING_FACTORY_DEMO_HOST: '::1' }),
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const started = (await tool!.execute(
      { op: 'start', command: 'node server.mjs', port, readyPath: '/ready' },
      { abortSignal: new AbortController().signal, toolCallId: 'real-local-start', sessionId: 's1' },
    )).details as { id: string; url: string }
    try {
      expect(started.url).toBe(`http://[::1]:${port}`)
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

  it('retries another serialized, token-authenticated port when the child loses its bind', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const localProcessRuntime = createFakeLocalRuntime()
    const originalStart = localProcessRuntime.start.bind(localProcessRuntime)
    let starts = 0
    vi.spyOn(localProcessRuntime, 'start').mockImplementation(async (...args) => {
      const identity = await originalStart(...args)
      starts += 1
      if (starts === 1) localProcessRuntime.alive.delete(identity.processId)
      return identity
    })
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: localEnv(),
      fetchImpl: fakeFetch(200),
      localProcessRuntime,
      localPortAvailable: async () => true,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: 4322 },
      { abortSignal: new AbortController().signal, toolCallId: 'bind-retry', sessionId: 's1' },
    )
    expect(result.isError).toBeFalsy()
    expect(localProcessRuntime.starts.map(({ env }) => env.PORT)).toEqual(['4322', '4300'])
    expect(result.details).toMatchObject({ port: 4300 })
    await handle.control.stopDemo((result.details as { id: string }).id)
    handle.close()
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

  it('stops an ambiguously created named Vercel lease before starting local fallback', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory()
    const localProcessRuntime = createFakeLocalRuntime()
    const realCreate = factory.create.bind(factory)
    const realLocalStart = localProcessRuntime.start.bind(localProcessRuntime)
    const lifecycle: string[] = []
    vi.spyOn(localProcessRuntime, 'start').mockImplementation(async (...args) => {
      lifecycle.push('local-start')
      return await realLocalStart(...args)
    })
    vi.spyOn(factory, 'create').mockImplementationOnce(async (params) => {
      const sandbox = await realCreate(params)
      const realStop = sandbox.stop.bind(sandbox)
      vi.spyOn(sandbox, 'stop').mockImplementation(async () => {
        lifecycle.push('remote-stop')
        return await realStop()
      })
      throw new Error('connection dropped after create')
    })
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
      { op: 'start', command: 'node server.mjs', port: 4323 },
      { abortSignal: new AbortController().signal, toolCallId: 'ambiguous-create', sessionId: 's1' },
    )
    expect(result).toMatchObject({ isError: false, details: { provider: 'local', fallbackFrom: 'vercel' } })
    expect([...sandboxes.values()]).toHaveLength(1)
    expect([...sandboxes.values()][0]!.stopped).toBe(true)
    expect(lifecycle).toEqual(['remote-stop', 'local-start'])
    await handle.control.stopDemo((result.details as { id: string }).id)
    handle.close()
  })

  it('does not start local fallback when the named Vercel lease cannot be classified', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory } = createFakeFactory()
    const localProcessRuntime = createFakeLocalRuntime()
    vi.spyOn(factory, 'create').mockRejectedValueOnce(new Error('create timed out'))
    vi.spyOn(factory, 'get').mockRejectedValueOnce(new Error('control plane unavailable'))
    const handle = createFactoryDemoPlugin({
      stateRoot,
      ...epicDeps(workspaceRoot),
      env: vercelEnv(),
      sandboxFactory: factory,
      localProcessRuntime,
      workspaceScopeId: 'factory-hub',
    })
    const [tool] = handle.plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute(
      { op: 'start', command: 'node server.mjs', port: 4324 },
      { abortSignal: new AbortController().signal, toolCallId: 'ambiguous-reconcile', sessionId: 's1' },
    )
    expect(result.details).toMatchObject({ code: 'REMOTE_RECONCILIATION_FAILED', provider: 'vercel' })
    expect(localProcessRuntime.starts).toHaveLength(0)
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
