import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import { ErrorCode } from '../../shared/error-codes'
import { sanitizeToolUiMetadata, type BoringChatMessage, type BoringChatPart, type PiChatEvent } from '../../shared/chat'
import { buildPiChatHistory } from './piChatHistory'
import { buildPiChatQueuedFollowUps } from './piChatSnapshot'

type RecordLike = Record<string, unknown>

type FileChangeOp = 'write' | 'edit' | 'unlink' | 'rename' | 'mkdir'

interface FileChangeData {
  op: FileChangeOp
  path: string
  filesystem?: string
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
  private readonly pendingUserStarts: Array<{ messageId: string; text?: string }> = []
  private readonly toolCallMessageIds = new Map<string, string>()
  private readonly toolCallInputs = new Map<string, unknown>()
  private readonly endedMessageIds = new Set<string>()
  private readonly endedAssistantTurnIds = new Set<string>()
  private readonly errorEmittedTurnIds = new Set<string>()

  constructor(options: PiChatEventMapperOptions) {
    this.sessionId = options.sessionId
    this.seq = Math.max(0, Math.floor(options.initialSeq ?? 0))
  }

  get latestSeq(): number {
    return this.seq
  }

  mapSynthetic<T extends Omit<PiChatEvent, 'seq'>>(event: T): T & { seq: number } {
    return this.event(event)
  }

  map(event: AgentSessionEvent | unknown): PiChatEvent[] {
    if (!isRecord(event) || typeof event.type !== 'string') return []

    switch (event.type) {
      case 'agent_start': {
        const turnId = optionalString(event.turnId) ?? this.createTurnId()
        this.activeTurnId = turnId
        this.pendingUserStarts.length = 0
        this.endedMessageIds.clear()
        this.endedAssistantTurnIds.clear()
        this.errorEmittedTurnIds.clear()
        return [this.event({ type: 'agent-start', turnId })]
      }

      case 'agent_end': {
        const turnId = this.activeTurnId ?? this.createTurnId()
        const status = agentEndStatus(event)
        const mapped = [
          ...this.mapAgentEndFinalAssistant(event, turnId),
          ...this.mapAgentEndError(event, turnId, status),
          // willRetry marks a non-terminal end (auto-retry coming) so once-per-settle
          // consumers can ignore it; mirrors mapAgentEndError's own willRetry gate.
          this.event({ type: 'agent-end', turnId, status, ...(event.willRetry === true ? { willRetry: true } : {}) }),
        ]
        this.activeAssistantMessageId = undefined
        this.toolCallMessageIds.clear()
        this.toolCallInputs.clear()
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
        this.resetDedupForRetry()
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

  private resetDedupForRetry(): void {
    this.endedMessageIds.clear()
    if (this.activeTurnId) this.endedAssistantTurnIds.delete(this.activeTurnId)
    else this.endedAssistantTurnIds.clear()
    this.activeAssistantMessageId = undefined
    this.toolCallMessageIds.clear()
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
    const text = textFromContent(message.content) ?? optionalString(message.text)
    if (role === 'assistant') this.activeAssistantMessageId = messageId
    if (role === 'user' && messageIdFrom(message) === undefined) this.pendingUserStarts.push({ messageId, text })

    const clientNonce = optionalString(message.clientNonce)
    const clientSeq = numberValue(message.clientSeq)
    const start = this.event({
      type: 'message-start',
      messageId,
      role,
      clientNonce,
      clientSeq,
      createdAt: messageTimestamp(message),
      text,
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
        if (this.activeTurnId) this.errorEmittedTurnIds.add(this.activeTurnId)
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
    this.toolCallMessageIds.set(toolCallId, messageId)
    this.toolCallInputs.set(toolCallId, toolCall.arguments)
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
    const messageId = this.finalMessageId(final)
    const canonicalFinal = final.id === messageId ? final : rewriteMessageId(final, messageId)
    if (this.endedMessageIds.has(messageId)) return []
    this.endedMessageIds.add(messageId)
    if (canonicalFinal.role === 'assistant') {
      if (this.activeTurnId && isTerminalAssistantFinal(canonicalFinal)) this.endedAssistantTurnIds.add(this.activeTurnId)
      this.activeAssistantMessageId = undefined
    }
    return [this.event({ type: 'message-end', messageId, final: canonicalFinal })]
  }

  private mapAgentEndFinalAssistant(event: RecordLike, turnId: string): PiChatEvent[] {
    if (this.endedAssistantTurnIds.has(turnId)) return []
    const messages = readRecordArray(event.messages)
    const lastAssistantIndex = findLastIndex(messages, (message) => messageRole(message) === 'assistant')
    if (lastAssistantIndex < 0) return []
    if (isContentlessTerminalAssistant(messages[lastAssistantIndex] as RecordLike)) return []

    const finalAssistant = this.buildAgentEndFinalAssistant(messages, lastAssistantIndex, turnId)
    if (!finalAssistant) return []
    if (this.endedMessageIds.has(finalAssistant.id)) return []

    this.endedMessageIds.add(finalAssistant.id)
    this.activeAssistantMessageId = undefined
    return [this.event({ type: 'message-end', messageId: finalAssistant.id, final: finalAssistant })]
  }

  /**
   * Surfaces a turn failure as an explicit `error` event. Some failures (e.g.
   * "No API key for provider") never produce an assistant `error` stream
   * event — the message only rides on agent_end's final assistant entry
   * (stopReason 'error' + errorMessage), which is also where the snapshot
   * reads it from. Without this, live clients see an empty assistant message
   * and an error agent-end but never the error text. Skipped when pi will
   * auto-retry (auto_retry_* events own that flow) or when an error event was
   * already emitted for this turn.
   */
  private mapAgentEndError(event: RecordLike, turnId: string, status: 'ok' | 'aborted' | 'error'): PiChatEvent[] {
    if (status !== 'error' || event.willRetry === true) return []
    if (this.errorEmittedTurnIds.has(turnId)) return []
    this.errorEmittedTurnIds.add(turnId)
    return [
      this.event({
        type: 'error',
        turnId,
        retryable: false,
        error: {
          code: ErrorCode.enum.INTERNAL_ERROR,
          message: agentEndErrorMessage(event),
          retryable: false,
        },
      }),
    ]
  }

  private finalMessageId(final: BoringChatMessage): string {
    if (final.role === 'assistant' && this.activeAssistantMessageId) return this.activeAssistantMessageId
    if (final.role !== 'user') return final.id

    const text = messageText(final)
    const exactIndex = this.pendingUserStarts.findIndex((start) => start.text === text)
    const fallbackIndex = exactIndex >= 0 ? exactIndex : this.pendingUserStarts.findIndex((start) => start.text === undefined || text === undefined)
    if (fallbackIndex < 0) return final.id
    const [matched] = this.pendingUserStarts.splice(fallbackIndex, 1)
    return matched?.messageId ?? final.id
  }

  private buildAgentEndFinalAssistant(messages: RecordLike[], lastAssistantIndex: number, turnId: string): BoringChatMessage | undefined {
    const rawAssistant = messages[lastAssistantIndex]
    if (!rawAssistant) return undefined

    if (messageIdFrom(rawAssistant) === undefined) {
      return buildPiChatHistory([{ id: this.activeAssistantMessageId ?? fallbackAgentEndAssistantId(this.sessionId, turnId), message: rawAssistant }], {
        sessionId: this.sessionId,
        turnId,
      })[0]
    }

    const assistants = buildPiChatHistory(messages, { sessionId: this.sessionId, turnId })
      .filter((message) => message.role === 'assistant')
    return assistants[assistants.length - 1]
  }

  private mapToolExecutionEnd(event: RecordLike): PiChatEvent[] {
    const toolCallId = optionalString(event.toolCallId)
    if (!toolCallId) return []
    const messageId = this.toolCallMessageIds.get(toolCallId) ?? this.activeAssistantMessageId ?? fallbackMessageId(this.sessionId, 'assistant', this.seq + 1)
    const result = event.result
    const mapped: PiChatEvent[] = []

    const toolFilesystem = filesystemFromToolInput(this.toolCallInputs.get(toolCallId))
    for (const fileChange of extractFileChanges(isRecord(result) ? result.details : undefined)) {
      const filesystem = fileChange.filesystem ?? toolFilesystem
      mapped.push(this.event({
        type: 'file-changed',
        path: fileChange.path,
        changeType: fileChange.op,
        ...(filesystem ? { filesystem } : {}),
      }))
    }
    this.toolCallInputs.delete(toolCallId)

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

function readRecordArray(value: unknown): RecordLike[] {
  return Array.isArray(value) ? value.filter((item): item is RecordLike => isRecord(item)) : []
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index
  }
  return -1
}

function messageRole(message: RecordLike): string | undefined {
  return optionalString(message.role) ?? optionalString(message.type)
}

function messageIdFrom(message: RecordLike): string | undefined {
  return optionalString(message.id) ?? optionalString(message.messageId)
}

function messageTimestamp(message: RecordLike): string | undefined {
  const timestamp = message.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return new Date(timestamp).toISOString()
  return optionalString(timestamp)
}

function fallbackMessageId(sessionId: string, role: string, seq: number): string {
  return `pi:${sessionId}:event:${seq}:${role}`
}

function fallbackAgentEndAssistantId(sessionId: string, turnId: string): string {
  return `pi:${sessionId}:turn:${turnId}:assistant`
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const text = content.map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
  return text.length > 0 ? text : undefined
}

function isContentlessTerminalAssistant(message: RecordLike): boolean {
  if (message.stopReason !== 'aborted' && message.stopReason !== 'error') return false
  return !hasDisplayableAssistantContent(message.content)
}

function hasDisplayableAssistantContent(content: unknown): boolean {
  if (typeof content === 'string') return content.length > 0
  if (!Array.isArray(content)) return false

  return content.some((part) => {
    if (!isRecord(part)) return false
    if (part.type === 'toolCall') return true
    if (part.type === 'text') return typeof part.text === 'string' && part.text.length > 0
    if (part.type === 'thinking' || part.type === 'reasoning') {
      return (typeof part.thinking === 'string' && part.thinking.length > 0) || (typeof part.text === 'string' && part.text.length > 0)
    }
    return false
  })
}

function filePartsFromContent(content: unknown, messageId: string): BoringChatPart[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part, index): BoringChatPart[] => {
    if (!isRecord(part) || part.type !== 'image') return []
    const mediaType = optionalString(part.mimeType)
    const url = imagePartUrl(part, mediaType)
    return [{
      type: 'file',
      id: `${messageId}:file:${index}`,
      ...(optionalString(part.filename) ? { filename: optionalString(part.filename) } : {}),
      ...(mediaType ? { mediaType } : {}),
      ...(url ? { url } : {}),
      ...(optionalString(part.path) ? { path: optionalString(part.path) } : {}),
    }]
  })
}

// Pi stores raw base64 in `data`; rebuild a displayable URL so the attachment
// preview has a real src instead of rendering empty.
function imagePartUrl(part: Record<string, unknown>, mediaType: string | undefined): string | undefined {
  const existing = optionalString(part.url)
  if (existing) return existing
  const data = optionalString(part.data)
  if (!data) return undefined
  if (data.startsWith('data:')) return data
  return `data:${mediaType ?? 'application/octet-stream'};base64,${data}`
}

function messageText(message: BoringChatMessage): string | undefined {
  const text = message.parts
    .filter((part): part is Extract<BoringChatPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
  return text.length > 0 ? text : undefined
}

function isTerminalAssistantFinal(message: BoringChatMessage): boolean {
  return message.role === 'assistant' && !message.parts.some((part) => part.type === 'tool-call')
}

function rewriteMessageId(message: BoringChatMessage, id: string): BoringChatMessage {
  return {
    ...message,
    id,
    parts: message.parts.map((part, index): BoringChatPart => {
      if (part.type === 'text') return { ...part, id: rewritePartId(part.id, message.id, id, `text:${index}`) }
      if (part.type === 'file') return { ...part, id: rewritePartId(part.id, message.id, id, `file:${index}`) }
      if (part.type === 'reasoning') return { ...part, id: rewritePartId(part.id, message.id, id, `reasoning:${index}`) }
      return part
    }),
  }
}

function rewritePartId(partId: string | undefined, previousMessageId: string, nextMessageId: string, fallbackSuffix: string): string {
  if (partId?.startsWith(previousMessageId)) return `${nextMessageId}${partId.slice(previousMessageId.length)}`
  return `${nextMessageId}:${fallbackSuffix}`
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

function agentEndErrorMessage(event: RecordLike): string {
  const messages = Array.isArray(event.messages) ? event.messages : []
  const lastAssistant = [...messages].reverse().find((message): message is RecordLike => isRecord(message) && message.role === 'assistant')
  if (typeof lastAssistant?.errorMessage === 'string' && lastAssistant.errorMessage.length > 0) return lastAssistant.errorMessage
  return 'Agent turn failed.'
}

function errorMessageFromAssistantError(assistantEvent: RecordLike): string {
  if (isRecord(assistantEvent.error) && typeof assistantEvent.error.errorMessage === 'string') return assistantEvent.error.errorMessage
  return assistantEvent.reason === 'aborted' ? 'Aborted' : 'Unknown error'
}

function filesystemFromToolInput(input: unknown): string | undefined {
  return isRecord(input) ? optionalString(input.filesystem) : undefined
}

function normalizeFileChangeEntry(value: unknown): FileChangeData | null {
  if (!isRecord(value)) return null
  const op = value.op
  const path = value.path
  if (typeof op !== 'string' || !FILE_CHANGE_OPS.has(op as FileChangeOp)) return null
  if (typeof path !== 'string' || path.length === 0) return null
  const filesystem = optionalString(value.filesystem)
  return {
    op: op as FileChangeOp,
    path,
    ...(filesystem ? { filesystem } : {}),
  }
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
