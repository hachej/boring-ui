import { describe, expect, test } from 'vitest'
import { filterSlashCommandSuggestions, getSlashCommandQuery } from '../suggestions'
import type { SlashCommand } from '../registry'

function cmd(name: string): SlashCommand {
  return { name, description: `${name} command`, handler: () => undefined }
}

describe('slash command suggestions', () => {
  test('extracts query only while typing a leading command token', () => {
    expect(getSlashCommandQuery('/')).toBe('')
    expect(getSlashCommandQuery('/mo')).toBe('mo')
    expect(getSlashCommandQuery('/model')).toBe('model')
    expect(getSlashCommandQuery('/open-chart')).toBe('open-chart')
    expect(getSlashCommandQuery('/model sonnet')).toBeNull()
    expect(getSlashCommandQuery(' /model')).toBeNull()
    expect(getSlashCommandQuery('try /model')).toBeNull()
  })

  test('filters commands by name and caps results', () => {
    const commands = [cmd('reset'), cmd('model'), cmd('cost'), cmd('clear'), cmd('clone')]
    expect(filterSlashCommandSuggestions(commands, '/c').map((c) => c.name)).toEqual([
      'clear',
      'clone',
      'cost',
    ])
    expect(filterSlashCommandSuggestions(commands, '/', 2)).toHaveLength(2)
  })
})
