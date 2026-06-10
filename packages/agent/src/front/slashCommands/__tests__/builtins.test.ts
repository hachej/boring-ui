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

describe('/clear intentionally absent', () => {
  test('does not register /clear in the Pi-native first cut', () => {
    // First-cut Pi-native chat intentionally omits local-only transcript
    // filtering. Canonical history is Pi JSONL; a future viewport clear must
    // be non-canonical and should be tested separately when reintroduced.
    expect(builtinCommands.find((c) => c.name === 'clear')).toBeUndefined()
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
  test('lists Pi-native builtin commands and omits /clear', () => {
    const ctx = makeContext()
    const result = getBuiltin('help').handler('', ctx)
    expect(result).not.toContain('/clear')
    expect(result).toContain('/reset')
    expect(result).toContain('/reload')
    expect(result).toContain('/help')
  })

  test('includes skill and extra commands from the registry context', () => {
    const ctx = makeContext({
      listCommands: vi.fn().mockReturnValue([
        ...builtinCommands,
        { name: 'review', description: 'Run review skill', kind: 'skill', handler: vi.fn() },
        { name: 'ask-user', description: 'Ask user', handler: vi.fn() },
      ]),
    })
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toContain('/review — Run review skill')
    expect(result).toContain('/ask-user — Ask user')
  })

  test('returns message when no commands', () => {
    const ctx = makeContext({ listCommands: vi.fn().mockReturnValue([]) })
    const result = getBuiltin('help').handler('', ctx)
    expect(result).toBe('No commands available.')
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

describe('/model and /thinking', () => {
  test('/model opens the model picker without args and delegates selection with args', () => {
    const openModelPicker = vi.fn()
    const selectComposerModel = vi.fn().mockReturnValue('Model set.')
    const ctx = makeContext({ openModelPicker, selectComposerModel })

    expect(getBuiltin('model').handler('', ctx)).toBeUndefined()
    expect(openModelPicker).toHaveBeenCalledOnce()
    expect(getBuiltin('model').handler('gpt', ctx)).toBe('Model set.')
    expect(selectComposerModel).toHaveBeenCalledWith('gpt')
  })

  test('/thinking and /think open or set the thinking picker', () => {
    const openThinkingPicker = vi.fn()
    const selectComposerThinking = vi.fn().mockReturnValue('Thinking set.')
    const ctx = makeContext({ openThinkingPicker, selectComposerThinking })

    expect(getBuiltin('thinking').handler('', ctx)).toBeUndefined()
    expect(openThinkingPicker).toHaveBeenCalledOnce()
    expect(getBuiltin('thinking').handler('low', ctx)).toBe('Thinking set.')
    expect(getBuiltin('think').handler('high', ctx)).toBe('Thinking set.')
    expect(selectComposerThinking).toHaveBeenCalledWith('low')
    expect(selectComposerThinking).toHaveBeenCalledWith('high')
  })
})

describe('Pi-native builtins are registered', () => {
  test('has exactly 6 commands', () => {
    expect(builtinCommands).toHaveLength(6)
  })

  test.each(['reset', 'reload', 'model', 'thinking', 'think', 'help'])('includes /%s', (name) => {
    expect(builtinCommands.find((c) => c.name === name)).toBeDefined()
  })

  test('does NOT include removed/deferred local commands', () => {
    expect(builtinCommands.find((c) => c.name === 'clear')).toBeUndefined()
    expect(builtinCommands.find((c) => c.name === 'cost')).toBeUndefined()
  })
})
