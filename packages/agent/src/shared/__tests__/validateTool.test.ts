import { describe, it, expect } from 'vitest'
import { validateTool } from '../validateTool'
import type { AgentTool } from '../tool'

function makeTool(overrides?: Partial<AgentTool>): AgentTool {
  return {
    name: 'test',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    ...overrides,
  }
}

describe('validateTool', () => {
  it('accepts a well-formed AgentTool', () => {
    const tool = makeTool()
    const result = validateTool(tool)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test')
  })

  it('rejects null', () => {
    expect(validateTool(null)).toBeNull()
  })

  it('rejects undefined', () => {
    expect(validateTool(undefined)).toBeNull()
  })

  it('rejects non-object primitives', () => {
    expect(validateTool(42)).toBeNull()
    expect(validateTool('string')).toBeNull()
    expect(validateTool(true)).toBeNull()
  })

  it('rejects empty name', () => {
    expect(validateTool({ ...makeTool(), name: '' })).toBeNull()
  })

  it('rejects missing name', () => {
    const { name: _, ...rest } = makeTool()
    expect(validateTool(rest)).toBeNull()
  })

  it('rejects non-string description', () => {
    expect(validateTool({ ...makeTool(), description: 123 })).toBeNull()
  })

  it('rejects missing description', () => {
    const { description: _, ...rest } = makeTool()
    expect(validateTool(rest)).toBeNull()
  })

  it('rejects null parameters', () => {
    expect(validateTool({ ...makeTool(), parameters: null })).toBeNull()
  })

  it('rejects missing parameters', () => {
    const { parameters: _, ...rest } = makeTool()
    expect(validateTool(rest)).toBeNull()
  })

  it('rejects missing execute', () => {
    const { execute: _, ...rest } = makeTool()
    expect(validateTool(rest)).toBeNull()
  })

  it('rejects non-function execute', () => {
    expect(validateTool({ ...makeTool(), execute: 'not-a-fn' })).toBeNull()
  })
})
