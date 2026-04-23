export interface ParsedCommand {
  name: string
  args: string
}

export function parseSlashCommand(text: string): ParsedCommand | null {
  const match = text.match(/^\/(\w+)(?:\s+(.*))?$/s)
  if (!match) return null
  return { name: match[1], args: match[2]?.trim() ?? '' }
}
