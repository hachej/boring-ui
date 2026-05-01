import { describe, it, expect } from 'vitest'
import type { AgentTool, ToolResult } from '@boring/workspace'
import { createMacroTools } from '../tools/macroTools'

function findTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

const DUMMY_CTX = {
  abortSignal: new AbortController().signal,
  toolCallId: 'test-call-1',
}

describe('createMacroTools', () => {
  const tools = createMacroTools(null)

  it('returns 4 tools', () => {
    expect(tools).toHaveLength(4)
  })

  it('has correct tool names', () => {
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual([
      'execute_sql',
      'get_series_data',
      'macro_search',
      'persist_derived_series',
    ])
  })

  it('all tools conform to AgentTool interface', () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(typeof tool.description).toBe('string')
      expect(typeof tool.parameters).toBe('object')
      expect(tool.parameters.type).toBe('object')
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('all tools have JSON Schema parameters (not Typebox)', () => {
    for (const tool of tools) {
      expect(tool.parameters).not.toHaveProperty('static')
      expect(tool.parameters).not.toHaveProperty('[Kind]')
      expect(tool.parameters).toHaveProperty('properties')
    }
  })
})

describe('execute_sql', () => {
  const tools = createMacroTools(null)
  const tool = findTool(tools, 'execute_sql')

  it('returns error when CH not configured', async () => {
    const result = await tool.execute({ query: 'SELECT 1' }, DUMMY_CTX)
    expect(result.content[0].text).toContain('not configured')
    expect(result.isError).toBe(true)
  })

  it('rejects empty query', async () => {
    const result = await tool.execute({ query: '' }, DUMMY_CTX)
    expect(result.content[0].text).toContain('not configured')
  })

  it('has required query parameter in schema', () => {
    expect(tool.parameters.required).toContain('query')
  })
})

describe('macro_search', () => {
  const tools = createMacroTools(null)
  const tool = findTool(tools, 'macro_search')

  it('returns error when CH not configured', async () => {
    const result = await tool.execute({ query: 'inflation' }, DUMMY_CTX)
    expect(result.content[0].text).toContain('not configured')
    expect(result.isError).toBe(true)
  })

  it('has required query parameter', () => {
    expect(tool.parameters.required).toContain('query')
  })

  it('has optional limit with min/max', () => {
    const props = tool.parameters.properties as Record<string, Record<string, unknown>>
    expect(props.limit.minimum).toBe(1)
    expect(props.limit.maximum).toBe(100)
  })
})

describe('get_series_data', () => {
  const tools = createMacroTools(null)
  const tool = findTool(tools, 'get_series_data')

  it('returns error when CH not configured', async () => {
    const result = await tool.execute({ series_id: 'CPIAUCSL' }, DUMMY_CTX)
    expect(result.content[0].text).toContain('not configured')
    expect(result.isError).toBe(true)
  })

  it('has required series_id parameter', () => {
    expect(tool.parameters.required).toContain('series_id')
  })

  it('has optional from, to, limit, order parameters', () => {
    const props = tool.parameters.properties as Record<string, unknown>
    expect(props).toHaveProperty('from')
    expect(props).toHaveProperty('to')
    expect(props).toHaveProperty('limit')
    expect(props).toHaveProperty('order')
  })
})

describe('persist_derived_series', () => {
  const tools = createMacroTools(null)
  const tool = findTool(tools, 'persist_derived_series')

  it('returns error when CH not configured', async () => {
    const result = await tool.execute({
      output_id: 'TEST',
      title: 'Test',
      input_ids: ['A'],
      transform_name: 'test',
      observations: [{ date: '2025-01-01', value: 1 }],
    }, DUMMY_CTX)
    expect(result.content[0].text).toContain('not configured')
    expect(result.isError).toBe(true)
  })

  it('requires core persistence parameters', () => {
    const required = tool.parameters.required as string[]
    expect(required).toContain('output_id')
    expect(required).toContain('title')
    expect(required).toContain('input_ids')
    expect(required).toContain('observations')
    expect(required).not.toContain('transform_name')
  })

  it('observations schema has nested object with date + value', () => {
    const props = tool.parameters.properties as Record<string, Record<string, unknown>>
    const obs = props.observations
    expect(obs.type).toBe('array')
    const items = obs.items as Record<string, unknown>
    expect(items.type).toBe('object')
    expect((items.required as string[])).toContain('date')
    expect((items.required as string[])).toContain('value')
  })

  it('supports optional transform_spec metadata', () => {
    const props = tool.parameters.properties as Record<string, Record<string, unknown>>
    expect(props.transform_spec.type).toBe('object')
  })
})
