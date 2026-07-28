import { describe, expect, it } from 'vitest'
import { splitSlashCommandMentions } from '../SlashCommandMentions'

const commands = [{ name: 'reload', clickBehavior: 'execute' as const }]

function isActionable(text: string): boolean {
  return splitSlashCommandMentions(text, commands).some((segment) => segment.command?.name === 'reload')
}

describe('splitSlashCommandMentions', () => {
  it.each(['/reload.', 'Try (/reload).', 'Try "/reload"', '/reload...'])(
    'accepts a complete prose token in %s',
    (text) => expect(isActionable(text)).toBe(true),
  )

  it.each(['/reload/config', '/reload.md', '/reload?unknown', '/reload:unknown', '/reload#unknown', '/reload=unknown', '/reloadé'])(
    'rejects an extended or unknown token in %s',
    (text) => expect(isActionable(text)).toBe(false),
  )
})
