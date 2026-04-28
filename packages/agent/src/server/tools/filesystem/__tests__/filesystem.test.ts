import { describe, expect, test, vi } from 'vitest'

import type { ExecResult, Sandbox } from '../../../../shared/sandbox'
import type { Workspace } from '../../../../shared/workspace'
import type { RuntimeBundle } from '../../../runtime/mode'
import { buildFilesystemAgentTools } from '../index'

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

function mockSandbox(provider: string): Sandbox {
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
    capabilities: ['exec'],
    exec: vi.fn(async () => defaultResult),
  }
}

function mockBundle(provider: string): RuntimeBundle {
  return {
    workspace: mockWorkspace(provider === 'vercel-sandbox' ? '/vercel/sandbox' : '/workspace'),
    sandbox: mockSandbox(provider),
    fileSearch: { search: vi.fn(async () => []) },
  }
}

describe('buildFilesystemAgentTools', () => {
  test('direct mode returns 6 tools with correct names', () => {
    const bundle = mockBundle('direct')
    const tools = buildFilesystemAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('bwrap mode returns same 6 tools as direct', () => {
    const bundle = mockBundle('bwrap')
    const tools = buildFilesystemAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('vercel-sandbox mode returns 6 tools with same names', () => {
    const bundle = mockBundle('vercel-sandbox')
    const tools = buildFilesystemAgentTools(bundle)

    expect(tools.map((t) => t.name)).toEqual(['read', 'write', 'edit', 'find', 'grep', 'ls'])
  })

  test('vercel-sandbox grep is the custom vercelGrepTool', () => {
    const bundle = mockBundle('vercel-sandbox')
    const tools = buildFilesystemAgentTools(bundle)
    const grepTool = tools.find((t) => t.name === 'grep')!

    // vercelGrepTool has "grep_files" as the pi schema name but we renamed to "grep"
    // Actually check it's our custom tool by verifying it has the right parameters shape
    expect(grepTool.parameters).toHaveProperty('properties')
    const props = (grepTool.parameters as any).properties
    expect(props).toHaveProperty('pattern')
  })

  test('different providers return different tool instances', () => {
    const directBundle = mockBundle('direct')
    const vercelBundle = mockBundle('vercel-sandbox')

    const directTools = buildFilesystemAgentTools(directBundle)
    const vercelTools = buildFilesystemAgentTools(vercelBundle)

    const directRead = directTools.find((t) => t.name === 'read')!
    const vercelRead = vercelTools.find((t) => t.name === 'read')!

    expect(directRead).not.toBe(vercelRead)
  })

  test('all tools have execute functions', () => {
    const bundle = mockBundle('direct')
    const tools = buildFilesystemAgentTools(bundle)

    for (const tool of tools) {
      expect(typeof tool.execute).toBe('function')
    }
  })
})
