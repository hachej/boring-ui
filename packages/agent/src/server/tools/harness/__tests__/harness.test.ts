import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeBundle } from '../../../runtime/mode'
import { buildHarnessAgentTools } from '../index'

function mockWorkspace(root = '/workspace'): Workspace {
  return {
    root,
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
    exec: vi.fn(async () => defaultResult),
  }
}

function mockBundle(provider: string, capabilities?: string[]): RuntimeBundle {
  return {
    workspace: mockWorkspace(),
    sandbox: mockSandbox(provider, capabilities),
    fileSearch: { search: vi.fn(async () => []) },
  }
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
      { code: 'x', language: 'python' },
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
      { code: 'x', language: 'rust' },
      { abortSignal: new AbortController().signal, toolCallId: 'test-5' },
    )
    expect(badLang.isError).toBe(true)
  })
})
