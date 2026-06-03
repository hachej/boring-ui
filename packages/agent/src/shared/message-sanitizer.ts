import type { UIMessage } from './message.js'

export interface SanitizeUiMessagesOptions {
  dropEmptyAssistantMessages?: boolean
}

function collapseExactRepeatedText(text: string): string {
  const maxCopies = Math.min(20, Math.floor(text.length / 4))
  for (let copies = maxCopies; copies >= 2; copies -= 1) {
    if (text.length % copies !== 0) continue
    const unit = text.slice(0, text.length / copies)
    if (unit.length < 4) continue
    if (unit.repeat(copies) === text) return unit
  }
  return text
}

function textFromMessage(message: UIMessage, role: UIMessage['role']): string | null {
  if (message.role !== role) return null
  const text = (message.parts ?? [])
    .map((part) => {
      const candidate = part as Record<string, unknown>
      return candidate.type === 'text' && typeof candidate.text === 'string' ? candidate.text : ''
    })
    .join('')
    .trim()
  return text || null
}

function assistantVisibleText(message: UIMessage): string | null {
  return textFromMessage(message, 'assistant')
}

function userVisibleText(message: UIMessage): string | null {
  return textFromMessage(message, 'user')
}

function isTransientUserId(id: string): boolean {
  return /^user-\d+$/.test(id)
}

function isEmptyAssistantMessage(message: UIMessage): boolean {
  return message.role === 'assistant' && (!message.parts || message.parts.length === 0)
}

export function sanitizeUiMessage(message: UIMessage): UIMessage {
  if (message.role !== 'assistant') return message
  let changed = false
  const parts: UIMessage['parts'] = []
  for (const part of message.parts ?? []) {
    const candidate = part as Record<string, unknown>
    if (candidate.type !== 'text' || typeof candidate.text !== 'string') {
      parts.push(part)
      continue
    }
    const text = collapseExactRepeatedText(candidate.text)
    const previous = parts[parts.length - 1] as Record<string, unknown> | undefined
    if (previous?.type === 'text' && previous.text === text) {
      changed = true
      continue
    }
    if (text !== candidate.text) changed = true
    parts.push(text === candidate.text ? part : ({ ...candidate, text } as typeof part))
  }
  return changed ? { ...message, parts } : message
}

export function uiMessageContentKey(message: UIMessage): string {
  const sanitized = sanitizeUiMessage(message)
  return `${sanitized.role}:${JSON.stringify(sanitized.parts ?? [])}`
}

export function dropEmptyAssistantUiMessages(messages: readonly UIMessage[]): UIMessage[] {
  return messages.filter((message) => !isEmptyAssistantMessage(message))
}

export function sanitizeUiMessages(
  messages: readonly UIMessage[],
  options: SanitizeUiMessagesOptions = {},
): UIMessage[] {
  const deduped: UIMessage[] = []
  const seenUserText = new Set<string>()

  for (const rawMessage of messages) {
    if (options.dropEmptyAssistantMessages && isEmptyAssistantMessage(rawMessage)) continue

    const message = sanitizeUiMessage(rawMessage)
    const userText = userVisibleText(message)
    const id = typeof message.id === 'string' ? message.id : ''
    if (userText) {
      if (seenUserText.has(userText) && isTransientUserId(id)) continue
      if (!id.startsWith('pending-user:')) seenUserText.add(userText)
    }

    const previous = deduped[deduped.length - 1]
    const assistantText = assistantVisibleText(message)
    if (assistantText && previous && assistantVisibleText(previous) === assistantText) continue
    deduped.push(message)
  }

  return deduped
}
