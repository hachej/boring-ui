import { spawnSync } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeBundle } from '../../../runtime/mode'
import { createBwrapSandbox } from '../../../sandbox/bwrap/createBwrapSandbox'
import { createNodeWorkspace } from '../../../workspace/createNodeWorkspace'
import { buildHarnessAgentTools } from '../index'

function mockWorkspace(root = '/workspace'): Workspace {
  const runtimeContext = { runtimeCwd: root }
  return {
    root: runtimeContext.runtimeCwd,
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
  const runtimeContext = { runtimeCwd: '/workspace' }
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
    runtimeContext,
    exec: vi.fn(async () => defaultResult),
  }
}

function mockBundle(provider: string, capabilities?: string[], workspaceRoot = '/workspace', storageRoot?: string): RuntimeBundle {
  const runtimeContext = { runtimeCwd: workspaceRoot }
  return {
    runtimeContext,
    storageRoot,
    workspace: mockWorkspace(workspaceRoot),
    sandbox: { ...mockSandbox(provider, capabilities), runtimeContext },
    fileSearch: { search: vi.fn(async () => []) },
  }
}

const tempDirs: string[] = []
const HAS_BWRAP = (() => {
  const result = spawnSync('bwrap', ['--version'], { stdio: 'ignore' })
  return result.status === 0
})()
const describeIfBwrap = HAS_BWRAP ? describe : describe.skip

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'boring-agent-bash-env-'))
  tempDirs.push(dir)
  await mkdir(join(dir, '.boring-agent', 'bin'), { recursive: true })
  await mkdir(join(dir, '.boring-agent', 'venv', 'bin'), { recursive: true })
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

  test('bwrap bash forwards through sandbox.exec with runtime cwd', async () => {
    const bundle = mockBundle('bwrap')
    vi.mocked(bundle.sandbox.exec).mockImplementation(async (_command, opts) => {
      opts?.onStdout?.(Buffer.from('/workspace\n/workspace\n'))
      return {
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 10,
        truncated: false,
      }
    })
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      { command: 'printf "%s\\n%s\\n" "$(pwd)" "$PWD"', timeout: 10 },
      { abortSignal: new AbortController().signal, toolCallId: 'test-bwrap-sandbox-exec' },
    )

    expect(bundle.sandbox.exec).toHaveBeenCalledWith(
      'printf "%s\\n%s\\n" "$(pwd)" "$PWD"',
      expect.objectContaining({
        cwd: '/workspace',
        timeoutMs: 10_000,
        onStdout: expect.any(Function),
        onStderr: expect.any(Function),
      }),
    )
    expect(result.content[0].text).toContain('/workspace\n/workspace')
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

  test('direct bash exposes workspace app/python/pip shims and env', async () => {
    const workspaceRoot = await makeTempWorkspace()
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'bin', 'app-cli'), '#!/usr/bin/env bash\necho app-cli-shim\n')
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'python'), '#!/usr/bin/env bash\necho python-shim\n')
    await writeExecutable(join(workspaceRoot, '.boring-agent', 'venv', 'bin', 'pip'), '#!/usr/bin/env bash\necho pip-shim\n')

    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      {
        command:
          'app-cli; python; pip; printf "%s\\n%s\\n" "$BORING_AGENT_WORKSPACE_ROOT" "$VIRTUAL_ENV"',
        timeout: 10,
      },
      { abortSignal: new AbortController().signal, toolCallId: 'test-direct-env' },
    )

    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('app-cli-shim')
    expect(result.content[0].text).toContain('python-shim')
    expect(result.content[0].text).toContain('pip-shim')
    expect(result.content[0].text).toContain(workspaceRoot)
    expect(result.content[0].text).toContain(join(workspaceRoot, '.boring-agent', 'venv'))
  })

  test('direct model bash pwd, PWD, and workspace root env are the host workspace path', async () => {
    const workspaceRoot = await makeTempWorkspace()
    const bundle = mockBundle('direct', ['exec'], workspaceRoot)
    const tools = buildHarnessAgentTools(bundle)
    const bashTool = tools.find((t) => t.name === 'bash')!

    const result = await bashTool.execute(
      {
        command: 'printf "%s\\n%s\\n%s" "$(pwd)" "$PWD" "$BORING_AGENT_WORKSPACE_ROOT"',
        timeout: 10,
      },
      { abortSignal: new AbortController().signal, toolCallId: 'test-direct-cwd' },
    )

    const [pwd, envPwd, boringRoot] = result.content[0].text.trimEnd().split('\n').slice(-3)
    expect(result.isError).toBe(false)
    expect(pwd).toBe(workspaceRoot)
    expect(envPwd).toBe(workspaceRoot)
    expect(boringRoot).toBe(workspaceRoot)
    expect([pwd, envPwd, boringRoot]).not.toContain('/workspace')
  })

  describeIfBwrap('bwrap bash tool integration', () => {
    test('model bash pwd and PWD are /workspace', async () => {
      const workspaceRoot = await makeTempWorkspace()
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(workspaceRoot, { runtimeContext })
      const sandbox = createBwrapSandbox({ hostWorkspaceRoot: workspaceRoot, runtimeContext })
      await sandbox.init?.({ workspace, sessionId: 'harness-bwrap-cwd' })
      const bundle: RuntimeBundle = {
        runtimeContext,
        storageRoot: workspaceRoot,
        workspace,
        sandbox,
        fileSearch: { search: vi.fn(async () => []) },
      }

      const tools = buildHarnessAgentTools(bundle)
      const bashTool = tools.find((t) => t.name === 'bash')!
      const result = await bashTool.execute(
        { command: 'printf "%s\\n%s\\n" "$(pwd)" "$PWD"', timeout: 10 },
        { abortSignal: new AbortController().signal, toolCallId: 'harness-bwrap-cwd' },
      )

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('/workspace\n/workspace')
      expect(result.content[0].text).not.toContain(workspaceRoot)
    })

    test('model bash sees parent .boring-agent fallback in nested child workspace', async () => {
      const parentRoot = await mkdtemp(join(tmpdir(), 'boring-agent-bwrap-parent-'))
      tempDirs.push(parentRoot)
      const childRoot = join(parentRoot, 'child')
      await mkdir(join(parentRoot, '.boring-agent'), { recursive: true })
      await mkdir(childRoot, { recursive: true })
      await writeFile(join(parentRoot, '.boring-agent', 'marker.txt'), 'parent-agent-fallback')
      const runtimeContext = { runtimeCwd: '/workspace' }
      const workspace = createNodeWorkspace(childRoot, { runtimeContext })
      const sandbox = createBwrapSandbox({ hostWorkspaceRoot: childRoot, runtimeContext })
      await sandbox.init?.({ workspace, sessionId: 'harness-bwrap-parent-fallback' })
      const bundle: RuntimeBundle = {
        runtimeContext,
        storageRoot: childRoot,
        workspace,
        sandbox,
        fileSearch: { search: vi.fn(async () => []) },
      }

      const tools = buildHarnessAgentTools(bundle)
      const bashTool = tools.find((t) => t.name === 'bash')!
      const result = await bashTool.execute(
        { command: 'cat .boring-agent/marker.txt && printf "\\n%s\\n%s" "$(pwd)" "$PWD"', timeout: 10 },
        { abortSignal: new AbortController().signal, toolCallId: 'harness-bwrap-parent-fallback' },
      )

      expect(result.isError).toBe(false)
      expect(result.content[0].text).toContain('parent-agent-fallback\n/workspace\n/workspace')
      expect(result.content[0].text).not.toContain(parentRoot)
      expect(result.content[0].text).not.toContain(childRoot)
    })
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
