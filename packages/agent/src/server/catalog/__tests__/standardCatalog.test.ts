import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import { standardCatalog } from '../standardCatalog'
import type { CatalogDeps } from '../../../shared/catalog'
import type { FileSearch } from '../../../shared/file-search'
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
    provider: 'test',
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

function mockFileSearch(): FileSearch {
  return {
    search: async () => [],
  }
}

function baseDeps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    workspace: mockWorkspace(),
    sandbox: mockSandbox(),
    fileSearch: mockFileSearch(),
    ...overrides,
  }
}

describe('standardCatalog', () => {
  it('returns exactly 6 tools by default', () => {
    const tools = standardCatalog(baseDeps())
    expect(tools).toHaveLength(6)
  })

  it('returns tools in correct order: bash, find_files, grep_files, read, write, edit', () => {
    const tools = standardCatalog(baseDeps())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['bash', 'find_files', 'grep_files', 'read', 'write', 'edit'])
  })

  it('does NOT include UI tools — those moved to @boring/workspace', () => {
    // Regression test for UI_BRIDGE_OWNERSHIP_REFACTOR: standalone agent
    // must not ship get_ui_state / exec_ui. Workspace consumers register
    // them via createWorkspaceAgentApp (which uses extraTools internally).
    const tools = standardCatalog(baseDeps())
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('get_ui_state')
    expect(names).not.toContain('exec_ui')
  })

  it('returns 7 tools with isolated-code capability', () => {
    const tools = standardCatalog(
      baseDeps({
        sandbox: mockSandbox(['exec', 'isolated-code']),
      })
    )
    expect(tools).toHaveLength(7)
    expect(tools[6].name).toBe('execute_isolated_code')
  })

  it('all tool names are unique', () => {
    const tools = standardCatalog(
      baseDeps({
        sandbox: mockSandbox(['exec', 'isolated-code']),
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
    const tools = standardCatalog(baseDeps())
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
    }
  })

  it('each tool has an execute function', () => {
    const tools = standardCatalog(baseDeps())
    for (const tool of tools) {
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('without fileSearch returns 5 core tools', () => {
    const tools = standardCatalog(baseDeps({ fileSearch: undefined }))
    expect(tools).toHaveLength(5)
    expect(tools.map((t) => t.name)).toEqual([
      'bash',
      'grep_files',
      'read',
      'write',
      'edit',
    ])
  })
})
