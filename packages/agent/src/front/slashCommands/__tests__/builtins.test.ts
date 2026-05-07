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
    reloadAgentPlugins: vi.fn().mockResolvedValue('Agent plugins reloaded.'),
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

describe('/model', () => {
  test('sets model when valid', () => {
    const ctx = makeContext()
    const result = getBuiltin('model').handler('haiku', ctx)
    expect(ctx.setModel).toHaveBeenCalledWith('haiku')
    expect(result).toBe('Model set to haiku.')
  })

  test('returns usage when no args', () => {
    const ctx = makeContext()
    const result = getBuiltin('model').handler('', ctx)
    expect(ctx.setModel).not.toHaveBeenCalled()
    expect(result).toContain('Usage')
  })

  test('returns error for invalid model', () => {
    const ctx = makeContext({ setModel: vi.fn().mockReturnValue(false) })
    const result = getBuiltin('model').handler('gpt4', ctx)
    expect(result).toContain('Unknown model')
    expect(result).toContain('gpt4')
  })
})

describe('/help', () => {
  test('lists all commands', () => {
    const ctx = makeContext()
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toContain('/clear')
    expect(result).toContain('/model')
    expect(result).toContain('/help')
    expect(result).toContain('/reload')
    expect(result).toContain('/cost')
    expect(result).toContain('/reset')
  })

  test('returns message when no commands', () => {
    const ctx = makeContext({ listCommands: vi.fn().mockReturnValue([]) })
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toBe('No commands available.')
  })
})

describe('/reload', () => {
  test('reloads agent plugins', async () => {
    const ctx = makeContext()
    const result = await getBuiltin('reload').handler('', ctx)
    expect(ctx.reloadAgentPlugins).toHaveBeenCalledOnce()
    expect(result).toBe('Agent plugins reloaded.')
  })
})

describe('/cost', () => {
  test('returns coming soon', () => {
    const ctx = makeContext()
    const result = getBuiltin('cost').handler('', ctx)
    expect(result).toBe('Coming soon.')
  })
})

describe('all 6 builtins are registered', () => {
  test('has exactly 6 commands', () => {
    expect(builtinCommands).toHaveLength(6)
  })

  test.each(['clear', 'reset', 'model', 'reload', 'help', 'cost'])('includes /%s', (name) => {
    expect(builtinCommands.find((c) => c.name === name)).toBeDefined()
  })
})
