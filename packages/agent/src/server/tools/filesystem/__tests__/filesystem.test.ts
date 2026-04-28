import { describe, expect, test, vi } from 'vitest'

import type { FileSearch } from '../../../../shared/file-search'
import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import { createLogger } from '../../../logging'
import type { RuntimeBundle } from '../../../runtime/mode'
import { buildFilesystemAgentTools } from '../index'

const logger = createLogger('[test:tools:filesystem]')

function logStep(step: string, details: Record<string, unknown> = {}): void {
  logger.info('step', { suite: 'filesystem', step, ...details })
}

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

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    stdout: new Uint8Array(),
    stderr: new Uint8Array(),
    exitCode: 0,
    durationMs: 1,
    truncated: false,
    stdoutEncoding: 'utf-8',
    stderrEncoding: 'utf-8',
    ...overrides,
  }
}

function mockSandbox(provider: string): Sandbox {
  return {
    id: `mock-${provider}`,
    placement: provider === 'vercel-sandbox' ? 'remote' : 'server',
    provider,
    capabilities: ['exec'],
    exec: vi.fn(async () => makeExecResult()),
  }
}

function mockFileSearch(): FileSearch {
  return { search: vi.fn(async () => []) }
}

function mockBundle(provider: string, root = '/workspace'): RuntimeBundle {
  return {
    workspace: mockWorkspace(root),
    sandbox: mockSandbox(provider),
    fileSearch: mockFileSearch(),
  }
}

function toolNames(provider: string): string[] {
  return buildFilesystemAgentTools(mockBundle(provider)).map((tool) => tool.name)
}

describe('buildFilesystemAgentTools', () => {
  test('direct mode returns pi filesystem tool names in stable order', () => {
    logStep('direct:names')

    expect(toolNames('direct')).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('local bwrap mode returns pi filesystem tool names in stable order', () => {
    logStep('bwrap:names')

    expect(toolNames('bwrap')).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('vercel-sandbox mode returns filesystem tool names with custom grep', async () => {
    logStep('vercel:names-and-custom-grep')

    const bundle = mockBundle('vercel-sandbox')
    const tools = buildFilesystemAgentTools(bundle)

    expect(tools.map((tool) => tool.name)).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])

    const grep = tools.find((tool) => tool.name === 'grep')
    expect(grep).toBeDefined()

    await grep!.execute(
      { pattern: 'needle' },
      { abortSignal: new AbortController().signal, toolCallId: 'grep-1' },
    )

    logStep('vercel:grep-exec-called', {
      calls: vi.mocked(bundle.sandbox.exec).mock.calls.length,
    })
    expect(bundle.sandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('rg '),
      expect.objectContaining({ timeoutMs: 30_000 }),
    )
  })

  test('switching modes returns fresh tool objects', () => {
    logStep('mode-switch:fresh-objects')

    const directTools = buildFilesystemAgentTools(mockBundle('direct'))
    const vercelTools = buildFilesystemAgentTools(mockBundle('vercel-sandbox'))

    expect(directTools).not.toBe(vercelTools)
    expect(directTools.map((tool, index) => tool === vercelTools[index])).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })
})
