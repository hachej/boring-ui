import { afterEach, describe, expect, test, vi } from 'vitest'
import { builtinCommands } from '../builtins'
import type { SlashCommandContext } from '../registry'

function makeContext(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    sessionId: 'test-session',
    clearMessages: vi.fn(),
    resetSession: vi.fn(),
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

describe('/help', () => {
  test('lists all commands', () => {
    const ctx = makeContext()
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toContain('/clear')
    expect(result).toContain('/reset')
    expect(result).toContain('/reload')
    expect(result).toContain('/help')
  })

  test('returns message when no commands', () => {
    const ctx = makeContext({ listCommands: vi.fn().mockReturnValue([]) })
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toBe('No commands available.')
  })
})

describe('builtin click behavior metadata', () => {
  test('/reload is marked execute', () => {
    expect(getBuiltin('reload').clickBehavior).toBe('execute')
  })

  test('/help is marked insert', () => {
    expect(getBuiltin('help').clickBehavior).toBe('insert')
  })
})

describe('/reload', () => {
  test('uses pluginUpdate.run (banner UX) when the host provides it', async () => {
    const run = vi.fn().mockResolvedValue('Plugins updated.')
    const ctx = makeContext({ pluginUpdate: { run } })
    const result = await getBuiltin('reload').handler('', ctx)
    expect(run).toHaveBeenCalledTimes(1)
    expect(ctx.reloadAgentPlugins).not.toHaveBeenCalled()
    expect(result).toBe('Plugins updated.')
  })

  test('falls back to inline-text reload when pluginUpdate is absent', async () => {
    const ctx = makeContext({ pluginUpdate: undefined })
    const result = await getBuiltin('reload').handler('', ctx)
    expect(ctx.reloadAgentPlugins).toHaveBeenCalledOnce()
    expect(result).toBe('Agent plugins reloaded.')
  })
})

describe('all 4 builtins are registered', () => {
  test('has exactly 4 commands', () => {
    expect(builtinCommands).toHaveLength(4)
  })

  test.each(['clear', 'reset', 'reload', 'help'])('includes /%s', (name) => {
    expect(builtinCommands.find((c) => c.name === name)).toBeDefined()
  })

  test('does NOT include /model or /cost (removed)', () => {
    expect(builtinCommands.find((c) => c.name === 'model')).toBeUndefined()
    expect(builtinCommands.find((c) => c.name === 'cost')).toBeUndefined()
  })
})
