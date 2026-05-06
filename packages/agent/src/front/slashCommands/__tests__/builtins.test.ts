import { afterEach, describe, expect, test, vi } from 'vitest'
import { builtinCommands } from '../builtins'
import type { SlashCommandContext } from '../registry'

function makeContext(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    sessionId: 'test-session',
    clearMessages: vi.fn(),
    resetSession: vi.fn(),
    setModel: vi.fn().mockReturnValue(true),
    listCommands: vi.fn().mockReturnValue(builtinCommands),
    ...overrides,
  }
}

function getBuiltin(name: string) {
  const cmd = builtinCommands.find((c) => c.name === name)
  if (!cmd) throw new Error(`Builtin "${name}" not found`)
  return cmd
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/clear', () => {
  test('calls clearMessages', () => {
    const ctx = makeContext()
    getBuiltin('clear').handler('', ctx)
    expect(ctx.clearMessages).toHaveBeenCalledOnce()
  })

  test('returns no message', () => {
    const ctx = makeContext()
    const result = getBuiltin('clear').handler('', ctx)
    expect(result).toBeUndefined()
  })
})

describe('/reset', () => {
  test('resets session when confirmed', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const ctx = makeContext()
    const result = getBuiltin('reset').handler('', ctx)
    expect(ctx.resetSession).toHaveBeenCalledOnce()
    expect(result).toBe('Session reset.')
  })

  test('does nothing when cancelled', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    const ctx = makeContext()
    const result = getBuiltin('reset').handler('', ctx)
    expect(ctx.resetSession).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
})

describe('all 2 builtins are registered', () => {
  test('has exactly 2 commands', () => {
    expect(builtinCommands).toHaveLength(2)
  })

  test.each(['clear', 'reset'])('includes /%s', (name) => {
    expect(builtinCommands.find((c) => c.name === name)).toBeDefined()
  })
})
