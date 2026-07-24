import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, test, vi } from 'vitest'

import { getEnv, restoreEnvForTest, setEnvForTest } from '../config/env'
import {
  createTestAgentApp as createAgentApp,
  createTestRuntimeModeAdapter,
  testRuntimeHostOperations,
} from '@agent-test-host'
import { loadPlugins, flattenPluginTools } from '../harness/pi-coding-agent/pluginLoader'
import type { AgentHarness, AgentHarnessFactoryInput } from '../../shared/harness'
import type { SessionCtx, SessionDetail, SessionStore, SessionSummary } from '../../shared/session'
import { ErrorCode } from '../../shared/error-codes'
import type { RuntimeFilesystemBindingOperations, RuntimeModeAdapter } from '../runtime/mode'
import type { WorkspaceAgentDispatcherResolver } from '../workspaceAgentDispatcher'
import { createDispatcherTestHarness } from './workspaceAgentDispatcherTestHarness'

const tempDirs: string[] = []
const ORIGINAL_TEMPLATE_PATH = getEnv('BORING_AGENT_TEMPLATE_PATH')

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
  restoreEnvForTest('BORING_AGENT_TEMPLATE_PATH', ORIGINAL_TEMPLATE_PATH)
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function makeWorkspaceLocalTempDir(prefix: string): Promise<string> {
  const baseDir = join(process.cwd(), '.tmp-test-workspaces')
  await mkdir(baseDir, { recursive: true })
  const dir = await mkdtemp(join(baseDir, prefix))
  tempDirs.push(dir)
  return dir
}

async function createTemplate(
  prefix: string,
  files: Record<string, string>,
): Promise<string> {
  const root = await makeTempDir(prefix)
  for (const [relPath, contents] of Object.entries(files)) {
    const filePath = join(root, relPath)
    await mkdir(join(filePath, '..'), { recursive: true })
    await writeFile(filePath, contents, 'utf-8')
  }
  return root
}

class TestSessionStore implements SessionStore {
  private readonly records = new Map<string, SessionSummary>()
  private created = 0
  readonly createContexts: SessionCtx[] = []

  async list(): Promise<SessionSummary[]> {
    return [...this.records.values()]
  }

  async create(ctx: SessionCtx, init?: { title?: string }): Promise<SessionSummary> {
    this.createContexts.push(ctx)
    this.created += 1
    const now = new Date().toISOString()
    const summary = {
      id: `test-session-${this.created}`,
      title: init?.title ?? 'New session',
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
    }
    this.records.set(summary.id, summary)
    return summary
  }

  async load(_ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const record = this.records.get(sessionId)
    if (!record) throw new Error(`missing session ${sessionId}`)
    return record
  }

  async delete(_ctx: SessionCtx, sessionId: string): Promise<void> {
    this.records.delete(sessionId)
  }
}

function createNoopHarnessFactory() {
  const sessions = new TestSessionStore()
  const inputs: AgentHarnessFactoryInput[] = []
  const factory = async (input: AgentHarnessFactoryInput): Promise<AgentHarness> => {
    inputs.push(input)
    return {
      id: 'test-http-harness',
      placement: 'server',
      sessions,
    }
  }
  return { factory, inputs, sessions }
}

test('createAgentApp stamps the explicit caller runtime host over the adapter host', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-app-runtime-host-')
  const adapterBuildBwrapArgs = vi.fn(() => [])
  const callerBuildBwrapArgs = vi.fn(() => [])
  const adapterHost = { ...testRuntimeHostOperations, buildBwrapArgs: adapterBuildBwrapArgs }
  const callerHost = { ...testRuntimeHostOperations, buildBwrapArgs: callerBuildBwrapArgs }
  const directAdapter = createTestRuntimeModeAdapter('direct')
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'runtime-host-precedence-test',
    runtimeHost: adapterHost,
    workspaceFsCapability: 'strong',
    async create(context) {
      return {
        ...await directAdapter.create(context),
        runtimeHost: adapterHost,
        bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
      }
    },
  }
  const app = await createAgentApp({
    workspaceRoot,
    runtimeModeAdapter,
    runtimeHost: callerHost,
    logger: false,
  })

  try {
    expect(callerBuildBwrapArgs).toHaveBeenCalledWith(workspaceRoot)
    expect(adapterBuildBwrapArgs).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('createAgentApp composes its trusted dispatcher over the standalone runtime', async () => {
  const harness = createDispatcherTestHarness()
  const workspaceRoot = await makeTempDir('boring-agent-app-dispatcher-workspace-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    sessionId: 'standalone-dispatcher',
    sessionRoot: await makeTempDir('boring-agent-app-dispatcher-sessions-'),
    logger: false,
    harnessFactory: harness.factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })

  try {
    const binding = await resolver!.resolveWithWorkspace!({ workspaceId: 'standalone-dispatcher', userId: 'standalone-user' })
    const dispatcher = binding.dispatcher
    const events = []
    for await (const event of dispatcher.send({
      content: 'standalone prompt',
      model: { provider: 'test', id: 'gpt-5.5' },
    })) events.push(event)

    expect(harness.factoryInputs).toHaveLength(1)
    expect(harness.sessions.createContexts).toEqual([{ workspaceId: 'standalone-dispatcher', userId: 'standalone-user' }])
    expect(harness.sendInputs.find((input) => input.model)).toMatchObject({
      model: { provider: 'test', id: 'gpt-5.5' },
      ctx: { workspaceId: 'standalone-dispatcher', userId: 'standalone-user' },
    })
    expect(events.some((event) => event.chunk.type === 'usage')).toBe(true)
    expect(events.at(-1)?.chunk.type).toBe('agent-end')
    expect(binding.workspace.root).toBe(workspaceRoot)
    const boundSessionId = events[0]?.sessionId
    const boundSession = await binding.ensurePiSessionBound!(boundSessionId!)
    expect(boundSession).toMatchObject({
      fullSessionCacheKey: JSON.stringify([boundSessionId, 'standalone-dispatcher', 'standalone-user']),
    })
    expect(boundSession.visibleUserMessageTarget).toEqual({
      isIdle: expect.any(Function),
      send: expect.any(Function),
    })
    await expect(boundSession.visibleUserMessageTarget!.isIdle()).resolves.toBe(true)
    await boundSession.visibleUserMessageTarget!.send('[Manual transcript review] read live-transcripts/a.md')
    await vi.waitFor(() => expect(harness.sendInputs).toContainEqual(expect.objectContaining({
      content: '[Manual transcript review] read live-transcripts/a.md',
      sessionId: boundSessionId,
      ctx: { workspaceId: 'standalone-dispatcher', userId: 'standalone-user' },
    })))
    await expect(resolver!.resolve({ workspaceId: 'other-workspace', userId: 'standalone-user' })).rejects.toMatchObject({
      code: ErrorCode.enum.UNAUTHORIZED,
    })
  } finally {
    await app.close()
  }
})

test('createAgentApp retires Agent, pair, then host adapter exactly once', async () => {
  const harness = createDispatcherTestHarness()
  const workspaceRoot = await makeTempDir('boring-agent-app-lifecycle-')
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  let activeSessionId: string | undefined
  const disposePair = vi.fn(async () => {
    expect(harness.adapters.get(activeSessionId!)?.abortCount).toBe(1)
  })
  const disposeAdapter = vi.fn(async () => {
    expect(disposePair).toHaveBeenCalledOnce()
  })
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'standalone-lifecycle-test',
    workspaceFsCapability: 'strong',
    dispose: disposeAdapter,
    async create(ctx) {
      const { createTestRuntimeModeAdapter } = await import('@agent-test-host')
      const directModeAdapter = createTestRuntimeModeAdapter('direct')
      const bundle = await directModeAdapter.create(ctx)
      return {
        ...bundle,
        disposeRuntime: async () => {
          await bundle.disposeRuntime?.()
          await disposePair()
        },
      }
    },
  }
  const app = await createAgentApp({
    workspaceRoot,
    runtimeModeAdapter,
    sessionId: 'standalone-lifecycle',
    logger: false,
    harnessFactory: harness.factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })

  const dispatcher = await resolver!.resolve({ workspaceId: 'standalone-lifecycle', userId: 'user-lifecycle' })
  const events = []
  for await (const event of dispatcher.send({ content: 'active standalone binding' })) events.push(event)
  activeSessionId = events[0]?.sessionId
  expect(activeSessionId).toBeDefined()

  await app.close()
  expect(disposePair).toHaveBeenCalledOnce()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('createAgentApp preserves Agent disposal failure while attempting pair and provider cleanup', async () => {
  const harness = createDispatcherTestHarness()
  const workspaceRoot = await makeTempDir('boring-agent-app-cleanup-errors-')
  const agentError = new Error('agent cleanup failed first')
  const pairError = new Error('pair cleanup failed second')
  const providerError = new Error('provider cleanup failed third')
  const disposePair = vi.fn(async () => { throw pairError })
  const disposeAdapter = vi.fn(async () => { throw providerError })
  let resolver: WorkspaceAgentDispatcherResolver | undefined
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'standalone-cleanup-error-test',
    workspaceFsCapability: 'strong',
    dispose: disposeAdapter,
    async create(ctx) {
      const { createTestRuntimeModeAdapter } = await import('@agent-test-host')
      const bundle = await createTestRuntimeModeAdapter('direct').create(ctx)
      return { ...bundle, disposeRuntime: disposePair }
    },
  }
  const app = await createAgentApp({
    workspaceRoot,
    runtimeModeAdapter,
    sessionId: 'standalone-cleanup-error',
    logger: false,
    harnessFactory: harness.factory,
    onWorkspaceAgentDispatcher: (value) => { resolver = value },
  })
  const dispatcher = await resolver!.resolve({
    workspaceId: 'standalone-cleanup-error',
    userId: 'cleanup-user',
  })
  const events = []
  for await (const event of dispatcher.send({ content: 'create active session' })) events.push(event)
  harness.adapters.get(events[0]!.sessionId)!.abort = vi.fn(async () => { throw agentError })

  await expect(app.close()).rejects.toBe(agentError)
  expect(disposePair).toHaveBeenCalledOnce()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('createAgentApp direct bash receives runtime env contributions without persisting values', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-direct-runtime-env-')
  let capturedTools: import('../../shared/tool').AgentTool[] = []
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    telemetry: { capture: vi.fn() },
    runtimeEnvContributions: [{ id: 'direct-runtime-env-test', getEnv: () => ({ GENERIC_DIRECT_RUNTIME_ENV: 'visible' }) }],
    harnessFactory: async (input) => {
      capturedTools = input.tools
      return {
        id: 'direct-env-harness',
        placement: 'server' as const,
        sessions: {
          async list() { return [] },
          async create() { const now = new Date().toISOString(); return { id: 's', title: 'S', createdAt: now, updatedAt: now, turnCount: 0 } },
          async load() { const now = new Date().toISOString(); return { id: 's', title: 'S', createdAt: now, updatedAt: now, turnCount: 0, messages: [] } },
          async delete() {},
        },
        async *sendMessage() {},
      }
    },
  })

  const result = await capturedTools.find((tool) => tool.name === 'bash')!.execute(
    { command: 'printf "%s" "$GENERIC_DIRECT_RUNTIME_ENV"' },
    { abortSignal: new AbortController().signal, toolCallId: 'direct-env' },
  )

  expect(result.content.map((part) => part.text).join('')).toContain('visible')
  await app.close()
})

test('createAgentApp direct mode forwards sessionRoot to the harness', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-direct-session-root-workspace-')
  const sessionRoot = await makeTempDir('boring-agent-direct-session-root-')
  const harness = createNoopHarnessFactory()
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    externalPlugins: false,
    sessionRoot,
    harnessFactory: harness.factory,
  })

  try {
    expect(harness.inputs[0]).toMatchObject({ cwd: workspaceRoot, sessionRoot })
    expect(harness.inputs[0]?.sessionDir).toBeUndefined()
  } finally {
    await app.close()
  }
})

test('createAgentApp rejects mode none without a workspace runtime adapter', async () => {
  await expect(createAgentApp({ mode: 'none', logger: false })).rejects.toThrow(
    'Runtime mode "none" has no built-in adapter',
  )
})

test('createAgentApp disposes its runtime once when profile initialization fails', async () => {
  const workspaceRoot = await makeTempDir('boring-agent-init-failure-')
  const initializationError = new Error('runtime provisioning rejected')
  const disposePair = vi.fn(async () => {
    throw new Error('cleanup also failed')
  })
  const disposeAdapter = vi.fn(async () => {})
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'init-failure-test',
    workspaceFsCapability: 'strong',
    async create(ctx) {
      const { createTestRuntimeModeAdapter } = await import('@agent-test-host')
      const directModeAdapter = createTestRuntimeModeAdapter('direct')
      const bundle = await directModeAdapter.create(ctx)
      return {
        ...bundle,
        disposeRuntime: async () => {
          await bundle.disposeRuntime?.()
          await disposePair()
        },
      }
    },
    dispose: disposeAdapter,
  }

  await expect(createAgentApp({
    workspaceRoot,
    runtimeModeAdapter,
    logger: false,
    runtimeProvisioner: async () => {
      throw initializationError
    },
  })).rejects.toBe(initializationError)
  expect(disposePair).toHaveBeenCalledOnce()
  expect(disposeAdapter).toHaveBeenCalledOnce()
})

test('createAgentApp provisions from templatePath option', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const templateRoot = await createTemplate('boring-ui-template-', {
    'README.md': '# api-template\n',
  })

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    templatePath: templateRoot,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'README.md'), 'utf-8')).resolves.toBe('# api-template\n')
})

test('createAgentApp falls back to BORING_AGENT_TEMPLATE_PATH', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const templateRoot = await createTemplate('boring-ui-template-', {
    'FROM_ENV.txt': 'env-template\n',
  })
  setEnvForTest('BORING_AGENT_TEMPLATE_PATH', templateRoot)

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'FROM_ENV.txt'), 'utf-8')).resolves.toBe('env-template\n')
})

test('createAgentApp wires runtime provisioning skill paths into harness and skills API', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-runtime-provisioning-')
  const generatedSkill = join(workspaceRoot, '.boring-agent', 'skills', 'plugin', 'macro-transform')
  await mkdir(generatedSkill, { recursive: true })
  await writeFile(join(generatedSkill, 'SKILL.md'), '---\ndescription: Macro transform skill\n---\n# Macro transform\n')
  const harnessFactory = vi.fn(async (input) => ({
    id: 'custom-test-harness',
    placement: 'server' as const,
    sessions: {
      async list() { return [] },
      async create() {
        const now = new Date().toISOString()
        return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
      },
      async load() {
        const now = new Date().toISOString()
        return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
      },
      async delete() {},
    },
  }))

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    harnessFactory,
    runtimeProvisioning: {
      changed: false,
      env: { BORING_AGENT_WORKSPACE_ROOT: workspaceRoot },
      pathEntries: [join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin')],
      skillPaths: [join(workspaceRoot, '.boring-agent', 'skills')],
    },
  })
  try {
    const bashTool = harnessFactory.mock.calls[0]?.[0].tools.find((tool: { name: string }) => tool.name === 'bash')
    expect(bashTool).toBeTruthy()
    const skills = await app.inject({ method: 'GET', url: '/api/v1/agent/skills' })
    expect(skills.statusCode).toBe(200)
    expect(skills.json().skills.map((skill: { name: string }) => skill.name)).toContain('macro-transform')
  } finally {
    await app.close()
  }
})

test('createAgentApp can use a custom harness factory for non-pi runtimes', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-custom-harness-')
  const reloadSession = vi.fn(async () => true)
  const telemetryEvents: Array<{ name: string; properties?: Record<string, unknown> }> = []
  const telemetry = {
    capture(event: { name: string; properties?: Record<string, unknown> }) {
      telemetryEvents.push(event)
    },
  }
  const getSlashCommands = vi.fn((sessionId: string) => [{
    name: 'open-test-panel',
    description: `Open test panel for ${sessionId}`,
    source: 'extension' as const,
  }])
  const harnessFactory = vi.fn(async (input) => ({
    id: 'custom-test-harness',
    placement: 'server' as const,
    sessions: {
      async list() { return [] },
      async create() {
        const now = new Date().toISOString()
        return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
      },
      async load() {
        const now = new Date().toISOString()
        return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
      },
      async delete() {},
    },
    reloadSession,
    getSlashCommands,
  }))

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    harnessFactory,
    telemetry,
    extraTools: [{
      name: 'custom_runtime_tool',
      description: 'Provided to harness factory.',
      parameters: { type: 'object' as const, properties: {} },
      async execute() { return { content: [{ type: 'text' as const, text: 'ok' }] } },
    }],
  })
  try {
    expect(harnessFactory).toHaveBeenCalledTimes(1)
    expect(harnessFactory.mock.calls[0]?.[0].cwd).toBe(workspaceRoot)
    expect(harnessFactory.mock.calls[0]?.[0].telemetry).toBe(telemetry)
    expect(harnessFactory.mock.calls[0]?.[0].tools.map((tool: { name: string }) => tool.name)).toContain('custom_runtime_tool')

    const commandsRes = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=custom' })
    expect(commandsRes.statusCode).toBe(200)
    expect(commandsRes.json()).toMatchObject({
      commands: [{ name: 'open-test-panel', source: 'extension' }],
    })

    expect(telemetryEvents).toEqual([])

    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: { sessionId: 'custom' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, sessionId: 'custom', reloaded: true })
    expect(reloadSession).toHaveBeenCalledWith('custom')
  } finally {
    await app.close()
  }
})

test('createAgentApp exposes static filesystem bindings on files and tree routes', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-static-bindings-')
  const disposeRuntime = vi.fn()
  const operations: RuntimeFilesystemBindingOperations = {
    read: vi.fn(async ({ path }) => ({ content: `company:${path}` })),
    list: vi.fn(async ({ path }) => ({ entries: path === '/' ? ['company'] : ['policy.md'], metadata: {} })),
    find: vi.fn(),
    grep: vi.fn(),
    stat: vi.fn(async ({ path }) => ({ isDirectory: path === 'company', metadata: {} })),
    rejectMutation: vi.fn((operation) => { throw new Error(`readonly ${operation}`) }),
  }
  const runtimeModeAdapter: RuntimeModeAdapter = {
    id: 'static-bindings-test',
    workspaceFsCapability: 'strong' as const,
    dispose: disposeRuntime,
    async create(ctx) {
      const { createNodeWorkspace } = await import('@agent-test-host')
      const { createDirectSandbox } = await import('@agent-test-host')
      const { createServerFileSearch } = await import('../runtime/createServerFileSearch')
      const workspace = createNodeWorkspace(ctx.workspaceRoot)
      const sandbox = createDirectSandbox()
      await sandbox.init?.({ workspace, sessionId: ctx.sessionId })
      return {
        workspace,
        storageRoot: ctx.workspaceRoot,
        sandbox,
        fileSearch: createServerFileSearch(workspace, sandbox),
        filesystemBindings: [{ filesystem: 'company_context', access: 'readonly' as const, operations }],
      }
    },
  }
  const app = await createAgentApp({
    workspaceRoot,
    runtimeModeAdapter,
    logger: false,
    harnessFactory: vi.fn(async () => ({
      id: 'static-bindings-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
    })),
  })

  try {
    const files = await app.inject({
      method: 'GET',
      url: '/api/v1/files?filesystem=company_context&path=%2Fpolicy.md',
    })
    expect(files.statusCode).toBe(200)
    expect(files.json()).toEqual({ content: 'company:/policy.md', access: 'readonly' })
    expect(operations.read).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/policy.md' })

    const tree = await app.inject({ method: 'GET', url: '/api/v1/tree?filesystem=company_context' })
    expect(tree.statusCode).toBe(200)
    expect(tree.json().entries).toEqual([{ name: 'company', kind: 'dir', path: 'company' }])
    expect(operations.list).toHaveBeenCalledWith({ filesystem: 'company_context', path: '/' })
    expect(operations.stat).toHaveBeenCalledWith({ filesystem: 'company_context', path: 'company' })
  } finally {
    await app.close()
  }
  expect(disposeRuntime).toHaveBeenCalledOnce()
})

test('createAgentApp rejects command execution when metering is configured', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-metered-commands-')
  const executeSlashCommand = vi.fn(async () => {})
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    metering: {
      reserveRun: vi.fn(),
      recordUsage: vi.fn(),
      settleRun: vi.fn(),
      releaseRun: vi.fn(),
    },
    harnessFactory: vi.fn(async () => ({
      id: 'metered-commands-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      getSlashCommands: async () => [{ name: 'plan', source: 'prompt' as const }],
      executeSlashCommand,
    })),
  })
  try {
    const commandsRes = await app.inject({ method: 'GET', url: '/api/v1/agent/commands?sessionId=custom' })
    expect(commandsRes.statusCode).toBe(200)
    expect(commandsRes.json()).toEqual({ commands: [{ name: 'plan', source: 'prompt' }] })

    const executeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/commands/execute?sessionId=custom',
      payload: { name: 'plan', args: 'ship it' },
    })
    expect(executeRes.statusCode).toBe(409)
    expect(executeRes.json()).toMatchObject({ error: { code: ErrorCode.enum.METERING_UNSUPPORTED_COMMAND } })
    expect(executeSlashCommand).not.toHaveBeenCalled()
  } finally {
    await app.close()
  }
})

test('POST /api/v1/agent/reload surfaces harness resource diagnostics', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-reload-diagnostics-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    harnessFactory: vi.fn(async () => ({
      id: 'diagnostics-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'custom', title: 'Custom', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      reloadSession: async () => true,
      getResourceDiagnostics: () => [
        { source: 'pi-skills', message: 'bad SKILL.md', path: 'skills/broken' },
      ],
    })),
  })
  try {
    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: { sessionId: 'custom' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.reloaded).toBe(true)
    expect(body.diagnostics).toEqual([
      { source: 'pi-skills', message: 'bad SKILL.md' },
    ])
  } finally {
    await app.close()
  }
})

test('GET /api/v1/agent/commands reports command discovery failures', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-command-route-failure-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    harnessFactory: vi.fn(async () => ({
      id: 'failing-command-harness',
      placement: 'server' as const,
      sessions: {
        async list() { return [] },
        async create() {
          const now = new Date().toISOString()
          return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0 }
        },
        async load() {
          const now = new Date().toISOString()
          return { id: 'default', title: 'Default', createdAt: now, updatedAt: now, turnCount: 0, messages: [] }
        },
        async delete() {},
      },
      getSlashCommands: () => { throw new Error('command loader failed') },
    })),
  })
  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/commands' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ commands: [], error: 'command loader failed' })
  } finally {
    await app.close()
  }
})

test('POST /api/v1/agent/reload awaits beforeReload and aborts on failure', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-reload-hook-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    beforeReload: async () => {
      throw new Error('before reload failed')
    },
  })
  try {
    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: { sessionId: 'missing' } })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ ok: false, error: 'before reload failed' })
  } finally {
    await app.close()
  }
})

test('POST /api/v1/agent/reload includes beforeReload restart warnings and diagnostics', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-reload-hook-diagnostics-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    beforeReload: async () => ({
      restart_warnings: [
        { id: 'routes-plugin', surfaces: ['routes'], message: 'restart routes' },
      ],
      diagnostics: [
        { source: 'directory (/plugin)', pluginId: 'broken-plugin', message: 'syntax error' },
      ],
    }),
  })
  try {
    const res = await app.inject({ method: 'POST', url: '/api/v1/agent/reload', payload: { sessionId: 'default' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      sessionId: 'default',
      reloaded: false,
      restart_warnings: [
        { id: 'routes-plugin', surfaces: ['routes'], message: 'restart routes' },
      ],
      diagnostics: [
        { source: 'directory (/plugin)', pluginId: 'broken-plugin', message: 'syntax error' },
        { source: 'reload', message: 'No live agent session to reload yet — changes apply to the next session.' },
      ],
    })
  } finally {
    await app.close()
  }
})

test('createAgentApp option templatePath takes precedence over env fallback', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const envTemplate = await createTemplate('boring-ui-template-env-', {
    'FROM_ENV.txt': 'env-template\n',
  })
  const apiTemplate = await createTemplate('boring-ui-template-api-', {
    'FROM_API.txt': 'api-template\n',
  })
  setEnvForTest('BORING_AGENT_TEMPLATE_PATH', envTemplate)

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    templatePath: apiTemplate,
  })
  await app.close()

  await expect(readFile(join(workspaceRoot, 'FROM_API.txt'), 'utf-8')).resolves.toBe('api-template\n')
  await expect(readFile(join(workspaceRoot, 'FROM_ENV.txt'), 'utf-8')).rejects.toSatisfy(
    (error: unknown) => (error as { code?: string }).code === 'ENOENT',
  )
})

test('extraTools appear in catalog endpoint', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-extra-tools-')

  const customTool = {
    name: 'reverse',
    description: 'Reverse a string.',
    parameters: {
      type: 'object' as const,
      properties: { s: { type: 'string' } },
      required: ['s'],
    },
    async execute(params: Record<string, unknown>) {
      const s = typeof params.s === 'string' ? params.s : ''
      return { content: [{ type: 'text' as const, text: s.split('').reverse().join('') }] }
    },
  }

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    extraTools: [customTool],
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
  })

  expect(res.statusCode).toBe(200)
  const body = res.json()
  const names = body.tools.map((t: { name: string }) => t.name)
  expect(names).toContain('bash')
  expect(names).toContain('reverse')

  const reverseMeta = body.tools.find((t: { name: string }) => t.name === 'reverse')
  expect(reverseMeta.description).toBe('Reverse a string.')
  expect(reverseMeta.parameters.required).toEqual(['s'])

  await app.close()
})

test('extraTools are appended after bundle tools', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-extra-tools-order-')

  const customTool = {
    name: 'custom_last',
    description: 'Should be after standard tools.',
    parameters: { type: 'object' as const, properties: {} },
    async execute() {
      return { content: [{ type: 'text' as const, text: 'ok' }] }
    },
  }

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    extraTools: [customTool],
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/agent/catalog',
  })

  const names = res.json().tools.map((t: { name: string }) => t.name)
  const bashIdx = names.indexOf('bash')
  const customIdx = names.indexOf('custom_last')
  expect(bashIdx).toBeLessThan(customIdx)

  await app.close()
})

test('standalone createAgentApp keeps agent catalog and has no /api/v1/capabilities route', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-standalone-capabilities-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  try {
    const catalogRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/catalog',
    })
    expect(catalogRes.statusCode).toBe(200)
    expect(
      catalogRes
        .json()
        .tools.map((tool: { name: string }) => tool.name),
    ).toContain('bash')

    const capabilitiesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
    })
    expect(capabilitiesRes.statusCode).toBe(404)
  } finally {
    await app.close()
  }
})

test('createAgentApp throws clearly when templatePath is missing', async () => {
  const parent = await makeTempDir('boring-ui-app-parent-')
  const workspaceRoot = join(parent, 'workspace')
  const missingTemplate = join(parent, 'missing-template')

  await expect(
    createAgentApp({
      workspaceRoot,
      mode: 'direct',
      logger: false,
      templatePath: missingTemplate,
    }),
  ).rejects.toThrow(`Failed to copy template from "${missingTemplate}"`)
})

test('externalPlugins=false keeps local plugin files out of the app catalog', async () => {
  const workspaceRoot = await makeWorkspaceLocalTempDir('boring-ui-plugin-disabled-')
  const pluginDir = join(workspaceRoot, '.pi', 'extensions')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'hidden.mjs'),
    [
      'export default {',
      "  name: 'a4s_plugin_hidden',",
      "  description: 'hidden plugin tool',",
      "  parameters: { type: 'object', properties: {} },",
      '  async execute() { return { content: [{ type: \'text\', text: \'hidden\' }] } },',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  )

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
    externalPlugins: false,
  })

  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
    expect(res.statusCode).toBe(200)
    const names = res.json().tools.map((t: { name: string }) => t.name)
    expect(names).not.toContain('a4s_plugin_hidden')
    expect(names).not.toContain('plugin_diagnostics')
    expect(names).toContain('bash')
    const catalogText = JSON.stringify(res.json()).toLowerCase()
    expect(catalogText).not.toContain('boring-ui-plugin')
    expect(catalogText).not.toContain('boring-plugin-authoring')
    expect(catalogText).not.toContain('plugin-owned')
    expect(catalogText).not.toContain('my-plugin')
  } finally {
    await app.close()
  }
})

test('real local plugin file remains callable and appears in app catalog', async () => {
  const workspaceRoot = await makeWorkspaceLocalTempDir('boring-ui-plugin-e2e-')
  const pluginDir = join(workspaceRoot, '.pi', 'extensions')
  await mkdir(pluginDir, { recursive: true })

  const pluginPath = join(pluginDir, 'hello.mjs')
  await writeFile(
    pluginPath,
    [
      'export default {',
      "  name: 'a4s_plugin_hello',",
      "  description: 'hello plugin tool for compatibility smoke test',",
      '  parameters: {',
      "    type: 'object',",
      "    properties: { name: { type: 'string' } },",
      "    required: ['name'],",
      '  },',
      '  async execute(params) {',
      "    const name = typeof params?.name === 'string' ? params.name : 'world'",
      "    return { content: [{ type: 'text', text: `hello ${name}` }] }",
      '  },',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  )

  const pluginResult = await loadPlugins({ cwd: workspaceRoot, skipGlobal: true })
  expect(pluginResult.errors).toEqual([])
  const pluginTools = flattenPluginTools(pluginResult)
  expect(pluginTools.map((tool) => tool.name)).toContain('a4s_plugin_hello')
  await expect(
    pluginTools.find((tool) => tool.name === 'a4s_plugin_hello')!.execute(
      { name: 'Ada' },
      { abortSignal: new AbortController().signal, toolCallId: 'plugin-call-1' },
    ),
  ).resolves.toMatchObject({
    content: [{ type: 'text', text: 'hello Ada' }],
  })

  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  try {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/catalog',
    })
    expect(res.statusCode).toBe(200)
    const names = res.json().tools.map((t: { name: string }) => t.name)
    expect(names).toContain('a4s_plugin_hello')
  } finally {
    await app.close()
  }
})

// ----------------------------------------------------------------------
// UI bridge regression tests — pin the contract that standalone agent
// ships ZERO UI bridge surface.
//
// Background: the UI bridge (interface, in-memory impl, /api/v1/ui/* routes,
// get_ui_state + exec_ui tool factories) used to live here. As of
// UI_BRIDGE_OWNERSHIP_REFACTOR they moved to @hachej/boring-workspace. Standalone
// CLI agent and any non-workspace embedder must not see them.
// ----------------------------------------------------------------------

test('standalone catalog does NOT include get_ui_state or exec_ui', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-no-uitools-')
  const app = await createAgentApp({ workspaceRoot, mode: 'direct', logger: false })
  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/catalog' })
    expect(res.statusCode).toBe(200)
    const names = res.json().tools.map((t: { name: string }) => t.name)
    expect(names).not.toContain('get_ui_state')
    expect(names).not.toContain('exec_ui')
    // Sanity: the standalone catalog still has its core tools.
    expect(names).toContain('bash')
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
  } finally {
    await app.close()
  }
})

test('standalone /api/v1/ui/state does NOT exist (404)', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-no-uiroutes-')
  const app = await createAgentApp({ workspaceRoot, mode: 'direct', logger: false })
  try {
    const get = await app.inject({ method: 'GET', url: '/api/v1/ui/state' })
    expect(get.statusCode).toBe(404)
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/state',
      payload: { state: {}, causedBy: 'user' },
    })
    expect(put.statusCode).toBe(404)
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/commands',
      payload: { kind: 'openFile', params: { path: 'x.ts' } },
    })
    expect(post.statusCode).toBe(404)
  } finally {
    await app.close()
  }
})


test('POST /api/v1/agent/reload is available before first turn', async () => {
  const workspaceRoot = await makeTempDir('boring-ui-reload-route-')
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/reload',
      payload: { sessionId: 'default' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      ok: true,
      sessionId: 'default',
      reloaded: false,
      diagnostics: [
        { source: 'reload', message: 'No live agent session to reload yet — changes apply to the next session.' },
      ],
    })
  } finally {
    await app.close()
  }
})

test('GET /api/v1/git/file-url 404-free and disabled for a non-git workspace', async () => {
  // Regression: the file-tree "Copy Git URL" action calls this route, which the
  // workspace app serves via createAgentApp. It must be wired here (not only in
  // registerAgentRoutes), or the action 404s. A bare temp dir is not a git
  // repo, so the route resolves to a disabled result rather than 404.
  const workspaceRoot = await makeTempDir('boring-ui-git-route-')
  const previousGitCeiling = process.env.GIT_CEILING_DIRECTORIES
  process.env.GIT_CEILING_DIRECTORIES = dirname(workspaceRoot)
  const app = await createAgentApp({
    workspaceRoot,
    mode: 'direct',
    logger: false,
  })

  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=README.md' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      enabled: false,
      reason: 'Workspace is not inside a Git repository.',
    })
  } finally {
    if (previousGitCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = previousGitCeiling
    await app.close()
  }
})

test('GET /api/v1/git/file-url resolves a real repo via the host storage root', async () => {
  // End-to-end: the route must run git against the HOST workspace path. Build a
  // real repo with a github origin and assert the blob URL comes back.
  const workspaceRoot = await makeTempDir('boring-ui-git-repo-')
  const git = async (...args: string[]) => {
    await promisify(execFile)('git', args, { cwd: workspaceRoot })
  }
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await git('remote', 'add', 'origin', 'git@github.com:acme/demo.git')
  await writeFile(join(workspaceRoot, 'README.md'), '# demo\n')
  await git('add', '.')
  await git('commit', '-m', 'init')

  const app = await createAgentApp({ workspaceRoot, mode: 'direct', logger: false })
  try {
    const res = await app.inject({ method: 'GET', url: '/api/v1/git/file-url?path=README.md' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      enabled: true,
      url: 'https://github.com/acme/demo/blob/main/README.md',
    })
  } finally {
    await app.close()
  }
})
