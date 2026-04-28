import { expectTypeOf, test } from 'vitest'

import { type CatalogDeps, type ToolCatalog } from '../catalog'
import type { FileSearch } from '../file-search'
import type { Sandbox } from '../sandbox'
import type { AgentTool } from '../tool'
import type { Workspace } from '../workspace'

test('CatalogDeps contract', () => {
  expectTypeOf<CatalogDeps>().toMatchTypeOf<{
    workspace: Workspace
    sandbox: Sandbox
    fileSearch?: FileSearch
  }>()
})

test('ToolCatalog contract', () => {
  expectTypeOf<ToolCatalog>().toEqualTypeOf<(deps: CatalogDeps) => AgentTool[]>()
})
