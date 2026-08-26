import { afterEach, describe, expect, test, vi } from 'vitest'
import { builtinCommands, reloadResultForModel } from '../builtins'
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

describe('/reset', () => {
  test('calls resetSession after confirm', () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const ctx = makeContext()
    const result = getBuiltin('reset').handler('', ctx)
    expect(ctx.resetSession).toHaveBeenCalledOnce()
    expect(result).toBe('Session reset.')
  })

  test('returns undefined when confirm is cancelled', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const ctx = makeContext()
    const result = getBuiltin('reset').handler('', ctx)
    expect(ctx.resetSession).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
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

describe('/help', () => {
  test('renders commands as a plain-text list (one line per command)', () => {
    const ctx = makeContext()
    const result = getBuiltin('help').handler('', ctx) as string
    expect(result).toContain('/clear')
    expect(result).toContain('/reset')
    expect(result).toContain('/reload')
    expect(result).toContain('/help')
    // Command results render as a plain-text notice (white-space: pre-wrap),
    // not Streamdown — so no GFM table markup, one command per line.
    expect(result).not.toContain('|')
    expect(result.startsWith('Available commands:')).toBe(true)
    expect(result).toContain('/clear — Hide messages from display')
    expect(result.split('\n').filter((l) => l.startsWith('/')).length).toBeGreaterThanOrEqual(3)
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
    expect(result).toMatchObject({ message: 'Plugins updated.' })
  })

  test('falls back to inline-text reload when pluginUpdate is absent', async () => {
    const ctx = makeContext({ pluginUpdate: undefined })
    const result = await getBuiltin('reload').handler('', ctx)
    expect(ctx.reloadAgentPlugins).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ message: 'Agent plugins reloaded.' })
  })

  test('reports the reload outcome to the model, not only to the UI', async () => {
    const run = vi.fn().mockResolvedValue('Extensions reloaded.\n\nWarnings:\ntasks: skipped')
    const ctx = makeContext({ pluginUpdate: { run } })
    const result = await getBuiltin('reload').handler('', ctx)
    expect(result).toEqual({
      message: 'Extensions reloaded.\n\nWarnings:\ntasks: skipped',
      modelMessage: '/reload result:\nExtensions reloaded.\n\nWarnings:\ntasks: skipped',
    })
  })

  test('makes a failed reload the thing the model sees', async () => {
    const run = vi.fn().mockResolvedValue('Extension update failed: worker unreachable')
    const ctx = makeContext({ pluginUpdate: { run } })
    const result = await getBuiltin('reload').handler('', ctx)
    expect(result).toMatchObject({
      modelMessage: '/reload result:\nExtension update failed: worker unreachable',
    })
  })

  test('bounds a runaway reload report instead of dumping it', () => {
    const report = reloadResultForModel(`Extensions reloaded.\n${'warning line\n'.repeat(500)}`)
    expect(report.length).toBeLessThan(2_100)
    expect(report.endsWith('… (truncated)')).toBe(true)
  })
})

describe('/model', () => {
  test('opens model picker when no args', () => {
    const openModelPicker = vi.fn(() => true)
    const ctx = makeContext({ openModelPicker })
    getBuiltin('model').handler('', ctx)
    expect(openModelPicker).toHaveBeenCalledOnce()
  })

  test('calls selectComposerModel with query when args provided', () => {
    const selectComposerModel = vi.fn()
    const ctx = makeContext({ selectComposerModel })
    getBuiltin('model').handler('claude-sonnet', ctx)
    expect(selectComposerModel).toHaveBeenCalledWith('claude-sonnet')
  })
})

describe('/thinking', () => {
  test('/thinking opens thinking picker when no args', () => {
    const openThinkingPicker = vi.fn(() => true)
    const ctx = makeContext({ openThinkingPicker })
    getBuiltin('thinking').handler('', ctx)
    expect(openThinkingPicker).toHaveBeenCalledOnce()
  })

  test('does not register the old /think alias', () => {
    expect(builtinCommands.find((c) => c.name === 'think')).toBeUndefined()
  })
})

describe('all builtins registered', () => {
  test('only /reload opts into direct assistant-message execution', () => {
    expect(builtinCommands.filter((command) => command.clickBehavior === 'execute').map((command) => command.name)).toEqual(['reload'])
    expect(getBuiltin('reset').clickBehavior).toBeUndefined()
  })

  test.each(['reset', 'clear', 'reload', 'model', 'thinking', 'help'])('includes /%s', (name) => {
    expect(builtinCommands.find((c) => c.name === name)).toBeDefined()
  })

  test('does NOT include /cost (never added)', () => {
    expect(builtinCommands.find((c) => c.name === 'cost')).toBeUndefined()
  })
})
