import type { ClickableMention } from './ClickableMention'

/**
 * Parse text for clickable mentions.
 * 
 * Patterns (order matters - more specific first):
 * - Slash commands: /command-name
 * - File paths: @path/to/file
 * - Skills: !skill-name
 * 
 * Returns text segments with mention markers for rendering.
 */
export interface TextSegment {
  type: 'text' | 'mention'
  content: string
  mention?: ClickableMention
}

// Slash command mention: /command-name at a word boundary, but not URL/path segments.
const SLASH_COMMAND_PATTERN = /(^|[\s([{"'`])\/(\w[\w-]*)\b/g

// File path mention: @path/to/file
const FILE_PATH_PATTERN = /(^|\s)(@[A-Za-z0-9_./-]+)/g

// Skill mention: !skill-name
const SKILL_PATTERN = /(^|\s)(![\w-]+)/g

export function parseMentions(text: string, availableCommands?: string[]): TextSegment[] {
  if (!text.includes('/') && !text.includes('@') && !text.includes('!')) {
    return [{ type: 'text', content: text }]
  }

  const segments: TextSegment[] = []

  // Find all potential mentions
  const matches: Array<{ start: number; end: number; type: string; value: string }> = []

  // Slash commands
  for (const match of text.matchAll(SLASH_COMMAND_PATTERN)) {
    const prefix = match[1]
    const commandName = match[2]
    if (availableCommands && !availableCommands.includes(commandName)) continue
    const command = `/${commandName}`
    const start = match.index! + prefix.length
    const end = start + command.length
    matches.push({ start, end, type: 'slash-command', value: command })
  }

  // File paths
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    const prefix = match[1]
    const path = match[2]
    const start = match.index! + prefix.length
    const end = start + path.length
    matches.push({ start, end, type: 'file-path', value: path })
  }

  // Skills
  for (const match of text.matchAll(SKILL_PATTERN)) {
    const prefix = match[1]
    const skill = match[2]
    const start = match.index! + prefix.length
    const end = start + skill.length
    matches.push({ start, end, type: 'skill', value: skill })
  }

  // Sort by start position and merge overlapping
  matches.sort((a, b) => a.start - b.start)
  
  const merged: typeof matches = []
  for (const match of matches) {
    if (merged.length === 0 || match.start >= merged[merged.length - 1].end) {
      merged.push(match)
    }
  }

  // Build segments
  let pos = 0
  for (const match of merged) {
    // Add text before this mention
    if (match.start > pos) {
      segments.push({
        type: 'text',
        content: text.slice(pos, match.start),
      })
    }

    // Add mention
    const mention: ClickableMention = {
      kind: match.type,
      value: match.value,
      label: match.value,
    }
    segments.push({
      type: 'mention',
      content: match.value,
      mention,
    })

    pos = match.end
  }

  // Add remaining text
  if (pos < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(pos),
    })
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: text }]
}
