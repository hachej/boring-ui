import { describe, expect, test, vi } from 'vitest'
import { createCommandRegistry, type SlashCommand } from '../registry'

function makeCommand(name: string, description = ''): SlashCommand {
  return { name, description, handler: vi.fn() }
}

describe('createCommandRegistry', () => {
  test('starts empty when no initial commands given', () => {
    const reg = createCommandRegistry()
    expect(reg.list()).toEqual([])
  })

  test('populates from initial commands', () => {
    const reg = createCommandRegistry([makeCommand('a'), makeCommand('b')])
    expect(reg.list().map((c) => c.name)).toEqual(['a', 'b'])
  })

  test('register adds a command', () => {
    const reg = createCommandRegistry()
    reg.register(makeCommand('foo'))
    expect(reg.get('foo')).toBeDefined()
    expect(reg.get('foo')!.name).toBe('foo')
  })

  test('get returns undefined for unknown command', () => {
    const reg = createCommandRegistry()
    expect(reg.get('nope')).toBeUndefined()
  })

  test('register overwrites existing command', () => {
    const reg = createCommandRegistry([makeCommand('x', 'old')])
    reg.register(makeCommand('x', 'new'))
    expect(reg.get('x')!.description).toBe('new')
  })

  test('list returns all commands in insertion order', () => {
    const reg = createCommandRegistry()
    reg.register(makeCommand('c'))
    reg.register(makeCommand('a'))
    reg.register(makeCommand('b'))
    expect(reg.list().map((c) => c.name)).toEqual(['c', 'a', 'b'])
  })

  test('preserves click behavior metadata', () => {
    const reg = createCommandRegistry([
      { name: 'reload', description: 'Reload', clickBehavior: 'execute', handler: vi.fn() },
    ])
    expect(reg.get('reload')?.clickBehavior).toBe('execute')
  })
})
