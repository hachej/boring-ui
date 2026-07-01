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

// File path mention: @path/to/file, packages/foo.ts, ./src/file.ts, README.md:12
const FILE_PATH_PATTERN = /(^|[\s([{"'`])(@?(?:(?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8})(?::\d+(?::\d+)?)?)/g

// Skill mention: !skill-name
const SKILL_PATTERN = /(^|\s)(![\w-]+)/g

export function parseMentions(text: string, availableCommands?: string[]): TextSegment[] {
  if (!text.includes('/') && !text.includes('@') && !text.includes('!') && !text.includes('.')) {
    return [{ type: 'text', content: text }]
  }

  const segments: TextSegment[] = []

  // Find all potential mentions
  const matches: Array<{ start: number; end: number; type: string; value: string; label?: string }> = []

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
    const rawPath = trimTrailingPathPunctuation(match[2])
    const path = rawPath.replace(/^@/, '')
    if (!rawPath.startsWith('@') && !isLikelyWorkspacePath(path)) continue
    const start = match.index! + prefix.length
    const end = start + rawPath.length
    matches.push({ start, end, type: 'file-path', value: path, label: rawPath })
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
      label: match.label ?? match.value,
    }
    segments.push({
      type: 'mention',
      content: match.label ?? match.value,
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

function trimTrailingPathPunctuation(path: string): string {
  return path.replace(/[),.;:]+$/, '')
}

function isLikelyWorkspacePath(path: string): boolean {
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false

  const withoutLine = path.replace(/:\d+(?::\d+)?$/, '')
  const slashCount = (withoutLine.match(/\//g) ?? []).length
  if (withoutLine.startsWith('./') || withoutLine.startsWith('../')) return true
  if (hasKnownFileExtension(withoutLine)) return true
  return slashCount >= 2
}

function hasKnownFileExtension(path: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|yml|yaml|toml|rs|go|py|sh|sql|txt|png|jpg|jpeg|gif|webp|svg)$/i.test(path)
}
