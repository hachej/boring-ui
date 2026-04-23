import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { standardCatalog } from '../standardCatalog'
import type { CatalogDeps } from '../../../shared/catalog'
import type { Workspace } from '../../../shared/workspace'
import type { Sandbox } from '../../../shared/sandbox'

function mockWorkspace(): Workspace {
  return {
    root: '/tmp/test',
    readFile: async () => '',
    writeFile: async () => {},
    unlink: async () => {},
    readdir: async () => [],
    stat: async () => ({ size: 0, mtimeMs: 0, kind: 'file' as const }),
    mkdir: async () => {},
    rename: async () => {},
  }
}

function mockSandbox(capabilities: string[] = ['exec']): Sandbox {
  return {
    id: 'test-sandbox',
    placement: 'server',
    capabilities: capabilities as Sandbox['capabilities'],
    init: async () => {},
    exec: async () => ({
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 0,
      truncated: false,
    }),
  }
}

function baseDeps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    workspace: mockWorkspace(),
    sandbox: mockSandbox(),
    ...overrides,
  }
}

describe('standardCatalog', () => {
  it('returns exactly 4 tools without uiBridge', () => {
    const tools = standardCatalog(baseDeps())
    expect(tools).toHaveLength(4)
  })

  it('returns tools in correct order: bash, read, write, edit', () => {
    const tools = standardCatalog(baseDeps())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['bash', 'read', 'write', 'edit'])
  })

  it('returns 6 tools with uiBridge', () => {
    const tools = standardCatalog(baseDeps({ uiBridge: {} }))
    expect(tools).toHaveLength(6)
  })

  it('appends get_ui_state and exec_ui after core tools', () => {
    const tools = standardCatalog(baseDeps({ uiBridge: {} }))
    const names = tools.map((t) => t.name)
    expect(names).toEqual([
      'bash',
      'read',
      'write',
      'edit',
      'get_ui_state',
      'exec_ui',
    ])
  })

  it('returns 7 tools with isolated-code capability', () => {
    const tools = standardCatalog(
      baseDeps({
        sandbox: mockSandbox(['exec', 'isolated-code']),
        uiBridge: {},
      })
    )
    expect(tools).toHaveLength(7)
    expect(tools[6].name).toBe('execute_isolated_code')
  })

  it('all tool names are unique', () => {
    const tools = standardCatalog(
      baseDeps({
        sandbox: mockSandbox(['exec', 'isolated-code']),
        uiBridge: {},
      })
    )
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('each tool has valid JSON Schema parameters (ajv validated)', () => {
    const ajv = new Ajv({ strict: false })
    const tools = standardCatalog(
      baseDeps({
        sandbox: mockSandbox(['exec', 'isolated-code']),
        uiBridge: {},
      })
    )
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined()
      expect(tool.parameters.type).toBe('object')
      const valid = ajv.validateSchema(tool.parameters)
      expect(valid).toBe(true)
    }
  })

  it('each tool has name and description', () => {
    const tools = standardCatalog(baseDeps({ uiBridge: {} }))
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
    }
  })

  it('each tool has an execute function', () => {
    const tools = standardCatalog(baseDeps({ uiBridge: {} }))
    for (const tool of tools) {
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('without uiBridge and without isolated-code returns 4 tools', () => {
    const tools = standardCatalog(baseDeps())
    expect(tools).toHaveLength(4)
    expect(tools.map((t) => t.name)).toEqual([
      'bash',
      'read',
      'write',
      'edit',
    ])
  })
})
