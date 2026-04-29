import { describe, it, expect } from 'vitest'
import { Message, MessagePartContainer } from '../Message'
import { ComposerPrimitive } from '../Composer'
import { Tool } from '../Tool'
import { Terminal } from '../Terminal'
import { CodeBlock } from '../CodeBlock'
import { Reasoning } from '../Reasoning'

describe('Primitive exports', () => {
  it('Message is a function component', () => {
    expect(typeof Message).toBe('function')
    expect(Message.length).toBeGreaterThanOrEqual(0)
  })

  it('MessagePartContainer is a function component', () => {
    expect(typeof MessagePartContainer).toBe('function')
  })

  it('ComposerPrimitive is a forwardRef component', () => {
    expect(ComposerPrimitive).toBeDefined()
    expect(typeof ComposerPrimitive).toBe('object')
    expect((ComposerPrimitive as any).$$typeof).toBeDefined()
  })

  it('Tool is a function component', () => {
    expect(typeof Tool).toBe('function')
  })

  it('Terminal is a function component', () => {
    expect(typeof Terminal).toBe('function')
  })

  it('CodeBlock is a function component', () => {
    expect(typeof CodeBlock).toBe('function')
  })

  it('Reasoning is a function component', () => {
    expect(typeof Reasoning).toBe('function')
  })
})

describe('Tool states', () => {
  it('exports all expected tool states as a type', () => {
    const states: import('../Tool').ToolState[] = [
      'input-streaming',
      'input-available',
      'approval-requested',
      'approval-responded',
      'output-available',
      'output-error',
      'output-denied',
    ]
    expect(states).toHaveLength(7)
  })
})

describe('Barrel exports', () => {
  it('all primitives re-exported from index', async () => {
    const mod = await import('../index')
    expect(mod.Message).toBe(Message)
    expect(mod.MessagePartContainer).toBe(MessagePartContainer)
    expect(mod.ComposerPrimitive).toBe(ComposerPrimitive)
    expect(mod.Tool).toBe(Tool)
    expect(mod.Terminal).toBe(Terminal)
    expect(mod.CodeBlock).toBe(CodeBlock)
    expect(mod.Reasoning).toBe(Reasoning)
  })
})
