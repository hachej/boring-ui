import type { BoringChatMessage, BoringChatPart } from '../../shared/chat'
import { extractToolUiMetadata } from '../../shared/tool-ui'

export interface PiSessionHistoryEntry {
  id?: string
  message: unknown
}

export interface BuildPiChatHistoryOptions {
  sessionId: string
  turnId?: string
  messageTurnIds?: ReadonlyMap<string, string>
  attachmentUrl?: (attachment: { messageId: string; index: number }) => string | undefined
}

type RecordLike = Record<string, unknown>

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function messageRole(message: RecordLike): string | undefined {
  return optionalString(message.role) ?? optionalString(message.type)
}

function runTerminalState(message: RecordLike): BoringChatMessage['runTerminalState'] {
  if (message.stopReason === 'stop') return 'success'
  if (message.stopReason === 'error') return 'error'
  if (message.stopReason === 'aborted') return 'aborted'
  return undefined
}

function messageTimestamp(message: RecordLike): string | undefined {
  const timestamp = message.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  return optionalString(timestamp)
}

function entryMessageId(entry: PiSessionHistoryEntry, message: RecordLike, index: number, sessionId: string): string {
  return (
    optionalString(entry.id) ??
    optionalString(message.id) ??
    `pi:${sessionId}:message:${index}:${messageRole(message) ?? 'unknown'}:${messageTimestamp(message) ?? 'no-ts'}`
  )
}

function entryPiEntryId(entry: PiSessionHistoryEntry, message: RecordLike): string | undefined {
  return optionalString(entry.id) ?? optionalString(message.id)
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((part) => {
      if (!isRecord(part)) return ''
      if (part.type === 'text' && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')

  return text.length > 0 ? text : undefined
}

function filePartsFromContent(content: unknown, messageId: string, options?: Pick<BuildPiChatHistoryOptions, 'attachmentUrl'>): BoringChatPart[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part, index): BoringChatPart[] => {
    if (!isRecord(part) || part.type !== 'image') return []
    const mediaType = optionalString(part.mimeType)
    const url = options?.attachmentUrl?.({ messageId, index }) ?? imagePartUrl(part, mediaType)
    return [
      {
        type: 'file',
        id: `${messageId}:file:${index}`,
        ...(optionalString(part.filename) ? { filename: optionalString(part.filename) } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(url ? { url } : {}),
        ...(optionalString(part.path) ? { path: optionalString(part.path) } : {}),
      },
    ]
  })
}

/**
 * Rebuilds a displayable URL for an image content part. Pi stores raw base64 in
 * `data` (no data: prefix); without this the attachment renders with an empty
 * src. Prefers an explicit url, then an existing data: URL, then base64 + mime.
 */
function imagePartUrl(part: RecordLike, mediaType: string | undefined): string | undefined {
  const existing = optionalString(part.url)
  if (existing) return existing
  const data = optionalString(part.data)
  if (!data) return undefined
  if (data.startsWith('data:')) return data
  return `data:${mediaType ?? 'application/octet-stream'};base64,${data}`
}

function userParts(message: RecordLike, messageId: string, options?: Pick<BuildPiChatHistoryOptions, 'attachmentUrl'>): BoringChatPart[] {
  const parts: BoringChatPart[] = []
  const text = textFromContent(message.content)
  if (text !== undefined) parts.push({ type: 'text', id: `${messageId}:text:0`, text })
  parts.push(...filePartsFromContent(message.content, messageId, options))
  return parts
}

function systemParts(message: RecordLike, messageId: string): BoringChatPart[] {
  return [{ type: 'text', id: `${messageId}:text:0`, text: textFromContent(message.content) ?? optionalString(message.text) ?? '' }]
}

function toolInputFromCall(part: RecordLike): unknown {
  if ('arguments' in part) return part.arguments
  if ('input' in part) return part.input
  if ('args' in part) return part.args
  return undefined
}

function assistantParts(message: RecordLike, messageId: string): BoringChatPart[] {
  const content = message.content
  if (typeof content === 'string') return [{ type: 'text', id: `${messageId}:text:0`, text: content }]
  if (!Array.isArray(content)) return []

  return content.flatMap((part, index): BoringChatPart[] => {
    if (!isRecord(part)) return []
    if (part.type === 'text' && typeof part.text === 'string') {
      return [{ type: 'text', id: `${messageId}:text:${index}`, text: part.text }]
    }
    if ((part.type === 'thinking' || part.type === 'reasoning') && (typeof part.thinking === 'string' || typeof part.text === 'string')) {
      return [
        {
          type: 'reasoning',
          id: optionalString(part.id) ?? `${messageId}:reasoning:${index}`,
          text: typeof part.thinking === 'string' ? part.thinking : String(part.text ?? ''),
          state: 'done',
        },
      ]
    }
    if (part.type === 'toolCall') {
      const toolCallId = optionalString(part.id) ?? `${messageId}:tool:${index}`
      const state = part.state === 'output-error'
        ? 'output-error'
        : part.state === 'output-available'
          ? 'output-available'
          : 'input-available'
      return [
        {
          type: 'tool-call',
          id: toolCallId,
          toolName: optionalString(part.name) ?? optionalString(part.toolName) ?? 'unknown',
          input: toolInputFromCall(part),
          state,
          output: part.output,
          errorText: optionalString(part.errorText),
          ui: extractToolUiMetadata({ details: { ui: part.ui } }),
        },
      ]
    }
    return []
  })
}

function updateToolResult(messages: BoringChatMessage[], message: RecordLike): void {
  const toolCallId = optionalString(message.toolCallId)
  if (!toolCallId) return

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const candidate = messages[messageIndex]
    if (!candidate || candidate.role !== 'assistant') continue
    const partIndex = candidate.parts.findIndex((part) => part.type === 'tool-call' && part.id === toolCallId)
    if (partIndex < 0) continue

    const current = candidate.parts[partIndex]
    if (current?.type !== 'tool-call') return

    const nextPart: BoringChatPart = {
      ...current,
      output: toolResultOutput(message),
      state: message.isError === true ? 'output-error' : 'output-available',
      errorText: message.isError === true ? toolResultErrorText(message) : current.errorText,
      ui: current.ui ?? extractToolUiMetadata({ details: { ui: isRecord(message.details) ? message.details.ui : undefined } }),
    }

    candidate.parts = [...candidate.parts.slice(0, partIndex), nextPart, ...candidate.parts.slice(partIndex + 1)]
    return
  }
}

function toolResultOutput(message: RecordLike): unknown {
  if ('details' in message && message.details !== undefined) {
    return {
      content: message.content,
      details: message.details,
    }
  }
  return message.content
}

function toolResultErrorText(message: RecordLike): string | undefined {
  const text = textFromContent(message.content)
  return text ?? optionalString(message.errorText)
}

export function buildPiChatHistory(entries: readonly unknown[], options: BuildPiChatHistoryOptions): BoringChatMessage[] {
  const messages: BoringChatMessage[] = []

  entries.forEach((rawEntry, index) => {
    const entry: PiSessionHistoryEntry = isRecord(rawEntry) && 'message' in rawEntry
      ? { id: optionalString(rawEntry.id), message: rawEntry.message }
      : { message: rawEntry }
    if (!isRecord(entry.message)) return

    const role = messageRole(entry.message)
    if (role === 'toolResult') {
      updateToolResult(messages, entry.message)
      return
    }

    const id = entryMessageId(entry, entry.message, index, options.sessionId)
    const piEntryId = entryPiEntryId(entry, entry.message)
    const base = {
      id,
      createdAt: messageTimestamp(entry.message),
      piEntryId,
      turnId: optionalString(entry.message.turnId) ?? options.messageTurnIds?.get(id) ?? options.turnId,
    }

    if (role === 'user') {
      messages.push({ ...base, role: 'user', status: 'done', parts: userParts(entry.message, id, options) })
      return
    }

    if (role === 'assistant') {
      const status = entry.message.stopReason === 'aborted' ? 'aborted' : entry.message.stopReason === 'error' ? 'error' : 'done'
      const terminalState = runTerminalState(entry.message)
      messages.push({
        ...base,
        role: 'assistant',
        status,
        parts: assistantParts(entry.message, id),
        ...(terminalState ? { runTerminalState: terminalState } : {}),
      })
      return
    }

    if (role === 'system') {
      messages.push({ ...base, role: 'system', status: 'done', parts: systemParts(entry.message, id) })
      return
    }

    if (role === 'custom' && entry.message.display !== false) {
      messages.push({ ...base, role: 'system', status: 'done', parts: systemParts(entry.message, id) })
    }
  })

  return messages
}
