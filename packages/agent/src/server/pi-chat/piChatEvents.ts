import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { ErrorCode } from '../../shared/error-codes'
import { sanitizeToolUiMetadata, type BoringChatPart, type PiChatEvent } from '../../shared/chat'
import { buildPiChatHistory } from './piChatHistory'
import { buildPiChatQueuedFollowUps } from './piChatSnapshot'

type RecordLike = Record<string, unknown>

type FileChangeOp = 'write' | 'edit' | 'unlink' | 'rename' | 'mkdir'

interface FileChangeData {
  op: FileChangeOp
  path: string
}

const FILE_CHANGE_OPS = new Set<FileChangeOp>(['write', 'edit', 'unlink', 'rename', 'mkdir'])

export interface PiChatEventMapperOptions {
  sessionId: string
  initialSeq?: number
}

export class PiChatEventMapper {
  private seq: number
  private readonly sessionId: string
  private activeTurnId: string | undefined
  private activeAssistantMessageId: string | undefined

  constructor(options: PiChatEventMapperOptions) {
    this.sessionId = options.sessionId
    this.seq = Math.max(0, Math.floor(options.initialSeq ?? 0))
  }

  get latestSeq(): number {
    return this.seq
  }

  map(event: AgentSessionEvent | unknown): PiChatEvent[] {
    if (!isRecord(event) || typeof event.type !== 'string') return []

    switch (event.type) {
      case 'agent_start': {
        const turnId = optionalString(event.turnId) ?? this.createTurnId()
        this.activeTurnId = turnId
        return [this.event({ type: 'agent-start', turnId })]
      }

      case 'agent_end': {
        const turnId = this.activeTurnId ?? this.createTurnId()
        const status = agentEndStatus(event)
        const mapped = [this.event({ type: 'agent-end', turnId, status })]
        this.activeAssistantMessageId = undefined
        if (status !== 'error') this.activeTurnId = undefined
        return mapped
      }

      case 'message_start':
        return this.mapMessageStart(event)

      case 'message_update':
        return this.mapMessageUpdate(event)

      case 'message_end':
        return this.mapMessageEnd(event)

      case 'tool_execution_end':
        return this.mapToolExecutionEnd(event)

      case 'queue_update':
        return [
          this.event({
            type: 'queue-updated',
            queue: { followUps: buildPiChatQueuedFollowUps(this.sessionId, readStringArray(event.followUp)) },
          }),
        ]

      case 'auto_retry_start':
        return [
          this.event({
            type: 'auto-retry-start',
            attempt: numberValue(event.attempt) ?? 0,
            maxAttempts: numberValue(event.maxAttempts) ?? 0,
            delayMs: numberValue(event.delayMs) ?? 0,
            errorMessage: optionalString(event.errorMessage) ?? '',
          }),
        ]

      case 'auto_retry_end':
        return [
          this.event({
            type: 'auto-retry-end',
            success: event.success === true,
            attempt: numberValue(event.attempt) ?? 0,
            finalError: optionalString(event.finalError),
          }),
        ]

      case 'ui_command':
      case 'ui-command':
        return [this.event({ type: 'ui-command', command: event.command ?? event.data ?? {}, displayOnly: true })]

      default:
        return []
    }
  }

  private createTurnId(): string {
    return `turn:${this.sessionId}:${this.seq + 1}`
  }

  private event<T extends Omit<PiChatEvent, 'seq'>>(event: T): T & { seq: number } {
    this.seq += 1
    return { ...event, seq: this.seq }
  }

  private mapMessageStart(event: RecordLike): PiChatEvent[] {
    if (!isRecord(event.message)) return []
    const message = event.message
    const rawRole = messageRole(message)
    if (rawRole !== 'user' && rawRole !== 'assistant') return []
    const role: 'user' | 'assistant' = rawRole

    const messageId = messageIdFrom(message) ?? fallbackMessageId(this.sessionId, role, this.seq + 1)
    if (role === 'assistant') this.activeAssistantMessageId = messageId

    const clientNonce = optionalString(message.clientNonce)
    const clientSeq = numberValue(message.clientSeq)
    const start = this.event({
      type: 'message-start',
      messageId,
      role,
      clientNonce,
      clientSeq,
      text: textFromContent(message.content) ?? optionalString(message.text),
      files: filePartsFromContent(message.content, messageId),
    })

    if (role === 'user' && clientNonce !== undefined && clientSeq !== undefined) {
      return [start, this.event({ type: 'followup-consumed', clientNonce, clientSeq, messageId })]
    }

    return [start]
  }

  private mapMessageUpdate(event: RecordLike): PiChatEvent[] {
    if (!isRecord(event.assistantMessageEvent)) return []
    const assistantEvent = event.assistantMessageEvent
    const messageId = this.messageUpdateId(event, assistantEvent)
    const partId = partIdFromAssistantEvent(assistantEvent)

    switch (assistantEvent.type) {
      case 'text_delta':
        return [this.event({ type: 'message-delta', messageId, partId, kind: 'text', delta: stringValue(assistantEvent.delta) })]
      case 'text_end':
        return [this.event({ type: 'message-part-end', messageId, partId, kind: 'text', text: stringValue(assistantEvent.content) })]
      case 'thinking_delta':
        return [this.event({ type: 'message-delta', messageId, partId, kind: 'reasoning', delta: stringValue(assistantEvent.delta) })]
      case 'thinking_end':
        return [this.event({ type: 'message-part-end', messageId, partId, kind: 'reasoning', text: stringValue(assistantEvent.content) })]
      case 'toolcall_end':
        return this.mapToolCallEnd(messageId, assistantEvent)
      case 'done': {
        const usage = isRecord(assistantEvent.message) ? assistantEvent.message.usage : undefined
        return usage === undefined ? [] : [this.event({ type: 'usage', usage })]
      }
      case 'error': {
        const errorMessage = errorMessageFromAssistantError(assistantEvent)
        return [
          this.event({
            type: 'error',
            turnId: this.activeTurnId,
            retryable: false,
            error: {
              code: assistantEvent.reason === 'aborted' ? ErrorCode.enum.ABORTED : ErrorCode.enum.INTERNAL_ERROR,
              message: errorMessage,
              retryable: false,
            },
          }),
        ]
      }
      default:
        return []
    }
  }

  private messageUpdateId(event: RecordLike, assistantEvent: RecordLike): string {
    const fromEventMessage = isRecord(event.message) ? messageIdFrom(event.message) : undefined
    const fromPartial = isRecord(assistantEvent.partial) ? messageIdFrom(assistantEvent.partial) : undefined
    const fromFinal = isRecord(assistantEvent.message) ? messageIdFrom(assistantEvent.message) : undefined
    const id = fromEventMessage ?? fromPartial ?? fromFinal ?? this.activeAssistantMessageId ?? fallbackMessageId(this.sessionId, 'assistant', this.seq + 1)
    this.activeAssistantMessageId = id
    return id
  }

  private mapToolCallEnd(messageId: string, assistantEvent: RecordLike): PiChatEvent[] {
    if (!isRecord(assistantEvent.toolCall)) return []
    const toolCall = assistantEvent.toolCall
    const toolCallId = optionalString(toolCall.id) ?? `${messageId}:tool:${partIdFromAssistantEvent(assistantEvent)}`
    return [
      this.event({
        type: 'tool-call',
        messageId,
        toolCallId,
        toolName: optionalString(toolCall.name) ?? 'unknown',
        input: toolCall.arguments ?? {},
        ui: sanitizeToolUiMetadata(toolCall.ui),
      }),
    ]
  }

  private mapMessageEnd(event: RecordLike): PiChatEvent[] {
    if (!isRecord(event.message)) return []
    const final = buildPiChatHistory([event.message], { sessionId: this.sessionId, turnId: this.activeTurnId })[0]
    if (!final) return []
    if (final.role === 'assistant') this.activeAssistantMessageId = undefined
    return [this.event({ type: 'message-end', messageId: final.id, final })]
  }

  private mapToolExecutionEnd(event: RecordLike): PiChatEvent[] {
    const messageId = this.activeAssistantMessageId ?? fallbackMessageId(this.sessionId, 'assistant', this.seq + 1)
    const toolCallId = optionalString(event.toolCallId)
    if (!toolCallId) return []
    const result = event.result
    const mapped: PiChatEvent[] = []

    for (const fileChange of extractFileChanges(isRecord(result) ? result.details : undefined)) {
      mapped.push(this.event({ type: 'file-changed', path: fileChange.path, changeType: fileChange.op }))
    }

    mapped.push(
      this.event({
        type: 'tool-result',
        messageId,
        toolCallId,
        output: result ?? {},
        isError: event.isError === true,
        errorText: event.isError === true ? toolErrorText(result) : undefined,
        ui: sanitizeToolUiMetadata(isRecord(result) && isRecord(result.details) ? result.details.ui : undefined),
      }),
    )

    return mapped
  }
}

export function mapPiAgentSessionEvent(event: AgentSessionEvent | unknown, options: PiChatEventMapperOptions): PiChatEvent[] {
  return new PiChatEventMapper(options).map(event)
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function messageRole(message: RecordLike): string | undefined {
  return optionalString(message.role) ?? optionalString(message.type)
}

function messageIdFrom(message: RecordLike): string | undefined {
  return optionalString(message.id) ?? optionalString(message.messageId)
}

function fallbackMessageId(sessionId: string, role: string, seq: number): string {
  return `pi:${sessionId}:event:${seq}:${role}`
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const text = content.map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
  return text.length > 0 ? text : undefined
}

function filePartsFromContent(content: unknown, messageId: string): BoringChatPart[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part, index): BoringChatPart[] => {
    if (!isRecord(part) || part.type !== 'image') return []
    return [{ type: 'file', id: `${messageId}:file:${index}`, mediaType: optionalString(part.mimeType) }]
  })
}

function partIdFromAssistantEvent(assistantEvent: RecordLike): string {
  const contentIndex = assistantEvent.contentIndex
  return typeof contentIndex === 'number' && Number.isInteger(contentIndex) && contentIndex >= 0 ? String(contentIndex) : '0'
}

function agentEndStatus(event: RecordLike): 'ok' | 'aborted' | 'error' {
  const messages = Array.isArray(event.messages) ? event.messages : []
  const lastAssistant = [...messages].reverse().find((message): message is RecordLike => isRecord(message) && message.role === 'assistant')
  if (lastAssistant?.stopReason === 'aborted') return 'aborted'
  if (lastAssistant?.stopReason === 'error' || event.willRetry === true) return 'error'
  return 'ok'
}

function errorMessageFromAssistantError(assistantEvent: RecordLike): string {
  if (isRecord(assistantEvent.error) && typeof assistantEvent.error.errorMessage === 'string') return assistantEvent.error.errorMessage
  return assistantEvent.reason === 'aborted' ? 'Aborted' : 'Unknown error'
}

function normalizeFileChangeEntry(value: unknown): FileChangeData | null {
  if (!isRecord(value)) return null
  const op = value.op
  const path = value.path
  if (typeof op !== 'string' || !FILE_CHANGE_OPS.has(op as FileChangeOp)) return null
  if (typeof path !== 'string' || path.length === 0) return null
  return { op: op as FileChangeOp, path }
}

function extractFileChanges(details: unknown): FileChangeData[] {
  if (!isRecord(details)) return []
  const entries = details.fileChanges
  if (Array.isArray(entries)) return entries.map(normalizeFileChangeEntry).filter((entry): entry is FileChangeData => entry !== null)
  const single = normalizeFileChangeEntry(details.fileChange)
  return single ? [single] : []
}

function toolErrorText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  const content = result.content
  const text = textFromContent(content)
  return text ?? optionalString(result.errorText)
}
