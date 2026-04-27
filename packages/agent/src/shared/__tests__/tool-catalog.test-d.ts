import { expectTypeOf, test } from 'vitest'
import type { AgentTool, ToolExecContext, ToolResult, JSONSchema } from '../tool'
import type { ToolCatalog, CatalogDeps } from '../catalog'

test('checking AgentTool contract', () => {
  expectTypeOf<AgentTool>().toHaveProperty('name')
  expectTypeOf<AgentTool>().toHaveProperty('description')
  expectTypeOf<AgentTool>().toHaveProperty('parameters')
  expectTypeOf<AgentTool>().toHaveProperty('execute')

  expectTypeOf<AgentTool['name']>().toEqualTypeOf<string>()
  expectTypeOf<AgentTool['description']>().toEqualTypeOf<string>()
  expectTypeOf<AgentTool['parameters']>().toEqualTypeOf<JSONSchema>()
  expectTypeOf<AgentTool['execute']>().toBeFunction()
})

test('checking ToolExecContext contract', () => {
  expectTypeOf<ToolExecContext>().toHaveProperty('abortSignal')
  expectTypeOf<ToolExecContext>().toHaveProperty('toolCallId')
  expectTypeOf<ToolExecContext>().toHaveProperty('onUpdate')

  expectTypeOf<ToolExecContext['abortSignal']>().toEqualTypeOf<AbortSignal>()
  expectTypeOf<ToolExecContext['toolCallId']>().toEqualTypeOf<string>()
})

test('checking ToolResult contract', () => {
  expectTypeOf<ToolResult>().toHaveProperty('content')
  expectTypeOf<ToolResult>().toHaveProperty('isError')
  expectTypeOf<ToolResult>().toHaveProperty('details')
})

test('checking ToolCatalog is a function', () => {
  expectTypeOf<ToolCatalog>().toBeFunction()
  expectTypeOf<ToolCatalog>().parameters.toEqualTypeOf<[CatalogDeps]>()
  expectTypeOf<ToolCatalog>().returns.toEqualTypeOf<AgentTool[]>()
})

test('checking CatalogDeps contract', () => {
  expectTypeOf<CatalogDeps>().toHaveProperty('workspace')
  expectTypeOf<CatalogDeps>().toHaveProperty('sandbox')
  expectTypeOf<CatalogDeps>().toHaveProperty('fileSearch')
  // uiBridge moved to @boring/workspace as of UI_BRIDGE_OWNERSHIP_REFACTOR.
})
