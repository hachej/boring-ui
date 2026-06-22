import { spawnSync } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeBashStrategy, RuntimeBundle } from '../../../runtime/mode'
import { ErrorCode } from '../../../../shared/error-codes'
import { buildHarnessAgentTools } from '../index'

function mockWorkspace(root = '/workspace'): Workspace {
  const runtimeContext = { runtimeCwd: root }
  return {
    root,
    runtimeContext,
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => {}),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const })),
    mkdir: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
  }
}

function mockSandbox(provider: string, capabilities: string[] = ['exec']): Sandbox {
  const defaultResult: ExecResult = {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 10,
    truncated: false,
  }
  return {
    id: `mock-${provider}`,
    placement: provider === 'vercel-sandbox' ? 'remote' : 'server',
    provider,
    capabilities,
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: vi.fn(async () => defaultResult),
  }
}

function mockBundle(provider: string, capabilities?: string[], workspaceRoot = '/workspace'): RuntimeBundle {
  const bash: RuntimeBashStrategy | undefined = provider === 'vercel-sandbox'
    ? { kind: 'remote', defaultPath: '/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin' }
    : provider === 'bwrap'
      ? { kind: 'local-sandbox', sandboxRoot: '/workspace' }
      : undefined
  return {
    workspace: mockWorkspace(workspaceRoot),
    sandbox: mockSandbox(provider, capabilities),
    fileSearch: { search: vi.fn(async () => []) },
    getRuntimeEnv: vi.fn(async () => ({})),
    storageRoot: workspaceRoot,
    ...(bash ? { bash } : {}),
  }
}

function hasBwrap(): boolean {
  if (process.platform !== 'linux') return false
  return spawnSync('bwrap', ['--version'], { stdio: 'ignore' }).status === 0
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boring-agent-bash-env-'))
  tempDirs.push(dir)
  await mkdir(join(dir, '.boring-agent', 'venv', 'bin'), { recursive: true })
  await mkdir(join(dir, '.boring-agent', 'node', 'node_modules', '.bin'), { recursive: true })
  await mkdir(join(dir, '.boring-agent', 'sdk', 'uv', 'bin'), { recursive: true })
  return dir
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, 'utf8')
  await chmod(path, 0o755)
}

describe('buildHarnessAgentTools', () => {
  test('direct mode returns bash tool', () => {
    const bundle = mockBundle('direct')
    const tools = buildHarnessAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['bash'])
  })

  test('bwrap mode returns bash tool', () => {
    const bundle = mockBundle('bwrap')
    const tools = buildHarnessAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['bash'])
  })

  test('vercel-sandbox mode returns bash tool', () => {
    const bundle = mockBundle('vercel-sandbox')
    const tools = buildHarnessAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['bash'])
  })

  test('includes execute_isolated_code when capability present', () => {
    const bundle = mockBundle('vercel-sandbox', ['exec', 'isolated-code'])
    const tools = buildHarnessAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['bash', 'execute_isolated_code'])
  })

  test('omits execute_isolated_code when capability absent', () => {
    const bundle = mockBundle('direct', ['exec'])
    const tools = buildHarnessAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['bash'])
  })

  test('direct bash exposes provisioned workspace bm/python/pip shims and env', async () => {
    const workspaceRoot = await makeTempWorkspace()
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'bm'), '#!/usr/bin/env bash\necho bm-shim\n')
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'python'), '#!/usr/bin/env bash\necho python-shim\n')
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'pip'), '#!/usr/bin/env bash\necho pip-shim\n')

    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      {
        command:
          'bm; python; pip; printf "%s\\n%s\\n" "$BORING_AGENT_WORKSPACE_ROOT" "$VIRTUAL_ENV"',
        timeout: 10,
      },
      { abortSignal: new AbortController().signal, toolCallId: 'test-direct-env' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('bm-shim')
    expect(result.content[0].text).toContain('python-shim')
    expect(result.content[0].text).toContain('pip-shim')
    expect(result.content[0].text).toContain(workspaceRoot)
    expect(result.content[0].text).toContain(join(workspaceRoot, '.boring-agent', 'venv'))
  })

  test('direct bash returns runtime readiness for explicit runtime dependency command while preparing', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle, {
      getReadiness: () => ({ ready: false, state: 'preparing', workspaceId: 'workspace-a', retryable: true }),
    })
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: './.boring-agent/venv/bin/democli --version', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-runtime-bin-not-ready' },
    )

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({
      code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
      requirement: 'runtime:python',
      state: 'preparing',
      retryable: true,
    })
  })

  test('direct bash adapts missing Python runtime imports while preparing', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle, {
      getReadiness: () => ({ ready: false, state: 'preparing', workspaceId: 'workspace-a', retryable: true }),
    })
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: "python3 - <<'PY'\nimport boring_macro\nPY", timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-python-import-not-ready' },
    )

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({
      code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
      requirement: 'runtime:python',
      state: 'preparing',
      retryable: true,
    })
    expect(result.content[0].text).not.toContain('ModuleNotFoundError')
  })

  test('direct bash prefixes provisioning PATH/env while preserving caller PATH tail', async () => {
    const workspaceRoot = await makeTempWorkspace()
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin', 'from-runtime'), '#!/usr/bin/env bash\necho runtime-bin\n')

    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle, {
      env: { BORING_MACRO_API_URL: 'http://macro', PATH: '/runtime/base' },
      pathEntries: [join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin')],
    })
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: 'from-runtime; printf "%s\\n%s" "$BORING_MACRO_API_URL" "$PATH"', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-runtime-env' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('runtime-bin')
    expect(result.content[0].text).toContain('http://macro')
    expect(result.content[0].text).toContain(`${join(workspaceRoot, '.boring-agent', 'node', 'node_modules', '.bin')}:`)
    expect(result.content[0].text).toContain('/runtime/base')
  })

  test('bash redacts runtime bridge tokens from output and details', async () => {
    const workspaceRoot = await makeTempWorkspace()
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'print-token'), '#!/usr/bin/env bash\nprintf "%s" "$BORING_WORKSPACE_BRIDGE_TOKEN"\n')

    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    bundle.getRuntimeEnv = vi.fn(async () => ({ BORING_WORKSPACE_BRIDGE_TOKEN: 'bridge-token-secret' }))
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: 'print-token', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-redaction' },
    )

    expect(result.content[0].text).toContain('[REDACTED]')
    expect(result.content[0].text).not.toContain('bridge-token-secret')
    expect(JSON.stringify(result)).not.toContain('bridge-token-secret')
  })

  test('bash redacts runtime bridge tokens from failed output', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    bundle.getRuntimeEnv = vi.fn(async () => ({ BORING_WORKSPACE_BRIDGE_TOKEN: 'bridge-token-secret' }))
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: 'printf %s "$BORING_WORKSPACE_BRIDGE_TOKEN"; exit 1', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-redaction-fail' },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('[REDACTED]')
    expect(result.content[0].text).not.toContain('bridge-token-secret')
  })

  test('bwrap bash mounts storage root while exposing runtime cwd', async () => {
    if (!hasBwrap()) return
    const storageRoot = await makeTempWorkspace()
    await writeFile(join(storageRoot, 'marker.txt'), 'mounted\n', 'utf8')
    const bundle: RuntimeBundle = {
      storageRoot,
      workspace: mockWorkspace('/workspace'),
      sandbox: mockSandbox('bwrap'),
      fileSearch: { search: vi.fn(async () => []) },
      bash: { kind: 'local-sandbox', sandboxRoot: '/workspace' },
    }
    const tools = buildHarnessAgentTools(bundle, {
      pathEntries: ['/workspace/.boring-agent/node/node_modules/.bin'],
    })
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: 'pwd; cat marker.txt; test -d .boring-agent && printf "%s" "$BORING_AGENT_WORKSPACE_ROOT"', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-bwrap-storage-root' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('/workspace')
    expect(result.content[0].text).toContain('mounted')
  })

  test('vercel-sandbox bash forwards to sandbox.exec with dynamic runtime env', async () => {
    const bundle = mockBundle('vercel-sandbox')
    let macroUrl = 'http://macro-v1'
    const tools = buildHarnessAgentTools(bundle, {
      getCurrent: () => ({
        env: { BORING_MACRO_API_URL: macroUrl, PATH: '/runtime/base' },
        pathEntries: ['/workspace/.boring-agent/venv/bin'],
      }),
    })
    const bashTool = tools.find((t) => t.name === 'bash')!

    await bashTool.execute(
      { command: 'echo hello', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-1' },
    )

    const firstExecOptions = vi.mocked(bundle.sandbox.exec).mock.calls[0][1]
    if (!firstExecOptions) throw new Error('missing sandbox exec options')
    expect(firstExecOptions).toEqual(expect.objectContaining({
      timeoutMs: 10_000,
      env: expect.objectContaining({ BORING_MACRO_API_URL: 'http://macro-v1' }),
    }))
    expect(firstExecOptions.env?.PATH).toBe('/workspace/.boring-agent/venv/bin:/runtime/base:/vercel/runtimes/node24/bin:/vercel/runtimes/node22/bin:/usr/local/bin:/usr/bin:/bin')
    expect(firstExecOptions.env).not.toHaveProperty('VAULT_TOKEN')
    expect(firstExecOptions.env).not.toHaveProperty('ANTHROPIC_API_KEY')

    macroUrl = 'http://macro-v2'
    await bashTool.execute(
      { command: 'echo again', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-1b' },
    )
    expect(bundle.sandbox.exec).toHaveBeenLastCalledWith('echo again', expect.objectContaining({
      env: expect.objectContaining({ BORING_MACRO_API_URL: 'http://macro-v2' }),
    }))
  })

  test('vercel-sandbox bash forwards to sandbox.exec', async () => {
    const bundle = mockBundle('vercel-sandbox')
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    await bashTool.execute(
      { command: 'echo hello', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-1' },
    )

    expect(bundle.sandbox.exec).toHaveBeenCalledWith('echo hello', expect.objectContaining({
      timeoutMs: 10_000,
    }))
  })

  test('execute_isolated_code delegates to sandbox', async () => {
    const bundle = mockBundle('vercel-sandbox', ['exec', 'isolated-code'])
    const mockResult = { sandboxId: 's1', stdout: 'hi', stderr: '', exitCode: 0 }
    bundle.sandbox.executeIsolatedCode = vi.fn(async () => mockResult)

    const tools = buildHarnessAgentTools(bundle)
    const tool = tools.find((t) => t.name === 'execute_isolated_code')!

    const result = await tool.execute(
      { code: 'print("hi")', language: 'python' },
      { abortSignal: new AbortController().signal, toolCallId: 'test-2' },
    )

    expect(bundle.sandbox.executeIsolatedCode).toHaveBeenCalledWith(expect.objectContaining({
      code: 'print("hi")',
      language: 'python',
    }))
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('hi')
  })

  test('execute_isolated_code returns error when capability missing at runtime', async () => {
    const bundle = mockBundle('vercel-sandbox', ['exec', 'isolated-code'])
    // Capability declared but method not provided
    const tools = buildHarnessAgentTools(bundle)
    const tool = tools.find((t) => t.name === 'execute_isolated_code')!

    const result = await tool.execute(
      { code: 'print("x")', language: 'python' },
      { abortSignal: new AbortController().signal, toolCallId: 'test-3' },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not available')
  })

  test('execute_isolated_code validates inputs', async () => {
    const bundle = mockBundle('vercel-sandbox', ['exec', 'isolated-code'])
    bundle.sandbox.executeIsolatedCode = vi.fn()
    const tools = buildHarnessAgentTools(bundle)
    const tool = tools.find((t) => t.name === 'execute_isolated_code')!

    const emptyCode = await tool.execute(
      { code: '', language: 'python' },
      { abortSignal: new AbortController().signal, toolCallId: 'test-4' },
    )
    expect(emptyCode.isError).toBe(true)

    const badLang = await tool.execute(
      { code: 'fn main() {}', language: 'rust' },
      { abortSignal: new AbortController().signal, toolCallId: 'test-5' },
    )
    expect(badLang.isError).toBe(true)
  })
})
