import type { SlashCommand } from './registry'

const COMMAND_TOKEN = /^\/([a-zA-Z0-9_-]*)$/

export function getSlashCommandQuery(text: string): string | null {
  const match = COMMAND_TOKEN.exec(text)
  return match ? match[1].toLowerCase() : null
}

export function filterSlashCommandSuggestions(
  commands: SlashCommand[],
  text: string,
  limit = 6,
): SlashCommand[] {
  const query = getSlashCommandQuery(text)
  if (query == null) return []
  const normalized = commands
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  const matches = normalized.filter((command) => {
    const name = command.name.toLowerCase()
    return name.startsWith(query) || name.includes(query)
  })

  return matches.slice(0, Math.max(0, limit))
}
