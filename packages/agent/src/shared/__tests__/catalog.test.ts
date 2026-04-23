import { expectTypeOf, test } from 'vitest'

import { type CatalogDeps, type ToolCatalog } from '../catalog'
import { standardCatalog } from '../../server/catalog/standardCatalog'
import type { FileSearch } from '../file-search'
import type { Sandbox } from '../sandbox'
import type { AgentTool } from '../tool'
import type { Workspace } from '../workspace'

const mockWorkspace: Workspace = {
  root: '/tmp/workspace',
  async readFile() {
    return ''
  },
  async writeFile() {},
  async unlink() {},
  async readdir() {
    return []
  },
  async stat() {
    return { size: 0, mtimeMs: 0, kind: 'file' }
  },
  async mkdir() {},
  async rename() {},
}

const mockSandbox: Sandbox = {
  id: 'sandbox-1',
  placement: 'server',
  capabilities: ['exec'],
  async init() {},
  async exec() {
    return {
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
      exitCode: 0,
      durationMs: 0,
      truncated: false,
    }
  },
}

test('CatalogDeps contract', () => {
  expectTypeOf<CatalogDeps>().toMatchTypeOf<{
    workspace: Workspace
    sandbox: Sandbox
    uiBridge?: unknown
    fileSearch?: FileSearch
  }>()
})

test('ToolCatalog contract', () => {
  expectTypeOf<ToolCatalog>().toEqualTypeOf<(deps: CatalogDeps) => AgentTool[]>()
})

test('standardCatalog works with required deps only', () => {
  expectTypeOf(standardCatalog({ workspace: mockWorkspace, sandbox: mockSandbox })).toEqualTypeOf<
    AgentTool[]
  >()
})
