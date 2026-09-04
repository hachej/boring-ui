import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFactoryDemoPlugin,
  type DemoSandboxFactory,
  type DemoSandboxHandle,
} from './demoPlugin'

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
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: root })
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

describe('factory demo plugin', () => {
  it('grants `demo_sandbox` only to boring-orchestrator', () => {
    const { plugin } = createFactoryDemoPlugin({
      stateRoot: '/tmp/does-not-matter',
      workspaceRoot: '/tmp/does-not-matter',
      epicKey: 'epic-1',
      env: vercelEnv(),
      workspaceScopeId: 'factory-epic-1',
    })
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }).map((tool) => tool.name)).toEqual(['demo_sandbox'])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-worker' })).toEqual([])
    expect(plugin.agentToolFactory?.({ agentTypeId: 'boring-reviewer' })).toEqual([])
  })

  it('rejects every op when the vercel provider is not configured', async () => {
    const { plugin } = createFactoryDemoPlugin({
      stateRoot: '/tmp/does-not-matter',
      workspaceRoot: '/tmp/does-not-matter',
      epicKey: 'epic-1',
      env: { BORING_FACTORY_SANDBOX_PROVIDER: 'local-simulation' } as NodeJS.ProcessEnv,
      workspaceScopeId: 'factory-epic-1',
    })
    const [tool] = plugin.agentToolFactory?.({ agentTypeId: 'boring-orchestrator' }) ?? []
    const result = await tool!.execute({ op: 'status' }, { abortSignal: new AbortController().signal, toolCallId: 'c1', sessionId: 's1' })
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' })
  })

  it('start writes fetch-bootstrap files, runs bootstrap + command, polls ready, and persists demos.json', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory, sandboxes } = createFakeFactory()
    const handle = createFactoryDemoPlugin({
      stateRoot,
      workspaceRoot,
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-epic-1',
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

  it('rejects an out-of-range port and an unconfigured command before touching the sandbox factory', async () => {
    const workspaceRoot = await createGitWorkspaceRoot()
    const stateRoot = await makeStateRoot()
    const { factory } = createFakeFactory()
    const createSpy = vi.spyOn(factory, 'create')
    const handle = createFactoryDemoPlugin({
      stateRoot,
      workspaceRoot,
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-epic-1',
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
      workspaceRoot,
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-epic-1',
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
      workspaceRoot,
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      fetchImpl: fakeFetch(200),
      workspaceScopeId: 'factory-epic-1',
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
      workspaceRoot: '/tmp/does-not-matter',
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      workspaceScopeId: 'factory-epic-1',
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
          sandboxId: 'factory-demo-expired',
          url: 'https://expired.vercel.run',
          sha: 'a'.repeat(40),
          port: 3000,
          command: 'node server.js',
          startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        'demo-live': {
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
      workspaceRoot: '/tmp/does-not-matter',
      epicKey: 'epic-1',
      env: vercelEnv(),
      sandboxFactory: factory,
      workspaceScopeId: 'factory-epic-1',
    })
    const removed = await handle.rearm()
    expect(removed).toBe(1)
    expect(sandboxes.get('factory-demo-expired')!.stopped).toBe(true)
    expect(sandboxes.get('factory-demo-live')!.stopped).toBe(false)

    const onDisk = JSON.parse(await readFile(resolve(stateRoot, 'demos.json'), 'utf8')) as { demos: Record<string, unknown> }
    expect(Object.keys(onDisk.demos)).toEqual(['demo-live'])

    handle.close()
  })
})
