import type {
  BoringChatMessage,
  BoringChatPart,
  ChatError,
  PiChatEvent,
  PiChatSnapshot,
  PiChatStatus,
  QueuedUserMessage,
} from '../../../shared/chat'
import { commitFinalMessage } from './piChatAssistantCommit'
import { replaceOrAppendMessage } from './piChatCommittedMessages'
import {
  collectTextPartPreservationKeys,
  isToolPending,
  markTextPartsPreservedForFold,
  mergeFinalMessageParts,
  mergeToolResultPart,
  preservedFinalMessageStatus,
  shouldKeepFinalMessageStreaming,
} from './piChatPartMerging'
import { earliestCreatedAt } from './piChatMessageMetadata'
import {
  clearOptimisticFollowUps,
  clearQueuedFollowUps,
  enrichQueueWithKnownMetadata,
  removeOutboxEntry,
  removeOutboxForMessageStart,
  removeOutboxMatchingQueue,
  removeQueueEntryForMessageStart,
  type OptimisticUserMessage,
} from './piChatQueueState'

export type PiChatConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export type { OptimisticUserMessage } from './piChatQueueState'

export interface PiChatRuntimeNotice {
  id: string
  level: 'info' | 'warning' | 'error'
  text: string
  dismissible?: boolean
}

export interface PiChatRetryNotice {
  attempt: number
  maxAttempts: number
  delayMs: number
  errorMessage: string
}

export interface PiChatSeqGap {
  expectedSeq: number
  actualSeq: number
  lastSeq: number
}

export interface PiChatHistoryState {
  /** First cut renders full history; this explicit shape leaves room for paged windows later. */
  mode: 'full'
  messageCount: number
}

export interface PiChatState {
  sessionId: string
  workspaceId?: string
  storageScope: string
  status: PiChatStatus
  turnId?: string
  lastSeq: number
  committedMessages: BoringChatMessage[]
  streamingMessage?: BoringChatMessage
  streamingPreservedTextPartKeys?: Set<string>
  history: PiChatHistoryState
  queue: { followUps: QueuedUserMessage[] }
  optimisticOutbox: Record<string, OptimisticUserMessage>
  pendingToolCallIds: Set<string>
  connection: {
    state: PiChatConnectionState
    lastHeartbeatAt?: number
  }
  error?: ChatError
  retryNotice?: PiChatRetryNotice
  notices: PiChatRuntimeNotice[]
  hydrated: boolean
  needsResync?: PiChatSeqGap
}

export type PiChatReducerAction =
  | { type: 'hydrate'; snapshot: PiChatSnapshot; allowSeqRewind?: boolean }
  | { type: 'cursor-sync'; cursor: number }
  | { type: 'event'; event: PiChatEvent }
  | { type: 'optimistic-user-message'; message: OptimisticUserMessage }
  | { type: 'remove-optimistic-user-message'; clientNonce: string }
  | { type: 'clear-optimistic-followups'; clientNonce?: string; clientSeq?: number }
  | { type: 'connection-state'; state: PiChatConnectionState }
  | { type: 'heartbeat'; now?: number }
  | { type: 'protocol-error'; error: ChatError }
  | { type: 'clear-notice'; id: string }

export interface CreatePiChatStateOptions {
  sessionId: string
  workspaceId?: string
  storageScope: string
  status?: PiChatStatus
  lastSeq?: number
}

export function createInitialPiChatState(options: CreatePiChatStateOptions): PiChatState {
  return {
    sessionId: options.sessionId,
    workspaceId: options.workspaceId,
    storageScope: options.storageScope,
    status: options.status ?? 'hydrating',
    lastSeq: options.lastSeq ?? 0,
    committedMessages: [],
    history: { mode: 'full', messageCount: 0 },
    queue: { followUps: [] },
    optimisticOutbox: {},
    pendingToolCallIds: new Set(),
    connection: { state: 'disconnected' },
    notices: [],
    hydrated: false,
  }
}

export function piChatReducer(state: PiChatState, action: PiChatReducerAction): PiChatState {
  switch (action.type) {
    case 'hydrate':
      return hydrateFromSnapshot(state, action.snapshot, { allowSeqRewind: action.allowSeqRewind })
    case 'cursor-sync':
      return syncCursor(state, action.cursor)
    case 'event':
      return applySequencedEvent(state, action.event)
    case 'optimistic-user-message':
      return {
        ...state,
        optimisticOutbox: {
          ...state.optimisticOutbox,
          [action.message.clientNonce]: {
            ...action.message,
            // Anchor the placeholder to the message it was submitted after so its
            // render position is clock-skew independent (see OptimisticUserMessage).
            afterMessageId: action.message.afterMessageId
              ?? state.committedMessages[state.committedMessages.length - 1]?.id,
          },
        },
      }
    case 'remove-optimistic-user-message':
      return { ...state, optimisticOutbox: removeOutboxEntry(state.optimisticOutbox, action.clientNonce) }
    case 'clear-optimistic-followups':
      return {
        ...state,
        queue: { followUps: clearQueuedFollowUps(state.queue.followUps, action) },
        optimisticOutbox: clearOptimisticFollowUps(state.optimisticOutbox, action),
      }
    case 'connection-state':
      return { ...state, connection: { ...state.connection, state: action.state } }
    case 'heartbeat':
      return { ...state, connection: { ...state.connection, lastHeartbeatAt: action.now ?? Date.now() } }
    case 'protocol-error':
      return {
        ...state,
        connection: { ...state.connection, state: 'reconnecting' },
        error: action.error,
        notices: upsertNotice(state.notices, {
          id: 'protocol-error',
          level: 'error',
          text: action.error.message,
          dismissible: true,
        }),
      }
    case 'clear-notice':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) }
  }
}

function syncCursor(state: PiChatState, cursor: number): PiChatState {
  if (cursor <= state.lastSeq) return { ...state, hydrated: true, needsResync: undefined }
  return { ...state, lastSeq: cursor, hydrated: true, needsResync: undefined }
}

function hydrateFromSnapshot(
  state: PiChatState,
  snapshot: PiChatSnapshot,
  options: { allowSeqRewind?: boolean } = {},
): PiChatState {
  if (snapshot.seq < state.lastSeq && !options.allowSeqRewind) return state

  const queue = { followUps: enrichQueueWithKnownMetadata(snapshot.queue.followUps, state.optimisticOutbox, state.queue.followUps) }
  const committedMessages = normalizeSnapshotMessages(snapshot.messages)
  const serverNonces = new Set<string>()
  for (const message of committedMessages) {
    if (message.clientNonce) serverNonces.add(message.clientNonce)
  }
  for (const followUp of queue.followUps) {
    if (followUp.clientNonce) serverNonces.add(followUp.clientNonce)
  }

  const nextOutbox: Record<string, OptimisticUserMessage> = {}
  const staleOutbox = Object.values(state.optimisticOutbox).filter((message) => !serverNonces.has(message.clientNonce))

  const notices = staleOutbox.length > 0
    ? upsertNotice(state.notices, {
        id: 'stale-outbox-cleared',
        level: 'warning',
        text: 'Some pending messages were not present in the recovered session and were cleared.',
        dismissible: true,
      })
    : state.notices

  return {
    ...state,
    sessionId: snapshot.sessionId,
    status: snapshot.status,
    turnId: snapshot.activeTurnId,
    lastSeq: snapshot.seq,
    committedMessages,
    streamingMessage: undefined,
    streamingPreservedTextPartKeys: undefined,
    history: { mode: 'full', messageCount: committedMessages.length },
    queue,
    optimisticOutbox: nextOutbox,
    pendingToolCallIds: collectPendingToolCallIds(committedMessages),
    error: snapshot.error,
    retryNotice: undefined,
    notices,
    hydrated: true,
    needsResync: undefined,
  }
}

function applySequencedEvent(state: PiChatState, event: PiChatEvent): PiChatState {
  if (event.seq <= state.lastSeq) return state
  const expectedSeq = state.lastSeq + 1
  if (event.seq > expectedSeq) {
    return {
      ...state,
      connection: { ...state.connection, state: 'reconnecting' },
      needsResync: { expectedSeq, actualSeq: event.seq, lastSeq: state.lastSeq },
    }
  }

  const next = reduceEvent({ ...state, lastSeq: event.seq, needsResync: undefined }, event)
  return next
}

function reduceEvent(state: PiChatState, event: PiChatEvent): PiChatState {
  switch (event.type) {
    case 'agent-start':
      return { ...state, status: 'streaming', turnId: event.turnId, error: undefined, streamingPreservedTextPartKeys: undefined }
    case 'agent-end':
      if (isStaleTurnScopedEvent(state, event.turnId)) return state
      if (isLateNonErrorAgentEndAfterTerminalError(state, event.status)) return state
      return settleTurn({
        ...state,
        status: event.status === 'error' ? 'error' : 'idle',
        turnId: undefined,
      }, event.status)
    case 'message-start':
      return applyMessageStart(state, event)
    case 'message-delta':
      return updateMessageById(state, event.messageId, (message) => appendPartDelta(message, event.partId, event.kind, event.delta))
    case 'message-part-end':
      return updateMessageById(state, event.messageId, (message) => finishPart(message, event.partId, event.kind, event.text))
    case 'message-end':
      return commitFinalMessage(state, event.messageId, event.final)
    case 'tool-call':
      return applyToolCall(state, event)
    case 'tool-result':
      return applyToolResult(state, event)
    case 'queue-updated': {
      const queue = { followUps: enrichQueueWithKnownMetadata(event.queue.followUps, state.optimisticOutbox, state.queue.followUps) }
      return {
        ...state,
        queue,
        optimisticOutbox: removeOutboxMatchingQueue(state.optimisticOutbox, queue.followUps),
      }
    }
    case 'followup-consumed':
      return { ...state, optimisticOutbox: removeOutboxEntry(state.optimisticOutbox, event.clientNonce) }
    case 'auto-retry-start':
      return {
        ...state,
        retryNotice: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
      }
    case 'auto-retry-end':
      return {
        ...state,
        retryNotice: undefined,
        notices: event.success
          ? state.notices
          : upsertNotice(state.notices, {
              id: 'auto-retry-failed',
              level: 'error',
              text: event.finalError ?? 'Agent retry failed.',
              dismissible: true,
            }),
      }
    case 'error':
      if (isStaleTurnScopedEvent(state, event.turnId)) return state
      return settleTurn({
        ...state,
        status: 'error',
        turnId: undefined,
        error: event.error,
        notices: upsertNotice(state.notices, {
          id: `turn-error:${event.turnId ?? event.seq}`,
          level: 'error',
          text: event.error.message,
          dismissible: true,
        }),
      }, 'error')
    case 'file-changed':
    case 'ui-command':
    case 'usage':
      return state
  }
}

function isStaleTurnScopedEvent(state: PiChatState, eventTurnId: string | undefined): boolean {
  return Boolean(state.turnId && eventTurnId && eventTurnId !== state.turnId)
}

function isLateNonErrorAgentEndAfterTerminalError(state: PiChatState, status: 'ok' | 'aborted' | 'error'): boolean {
  return state.turnId === undefined && state.status === 'error' && state.error !== undefined && status !== 'error'
}

function applyMessageStart(state: PiChatState, event: Extract<PiChatEvent, { type: 'message-start' }>): PiChatState {
  if (event.role === 'user') {
    const message: BoringChatMessage = {
      id: event.messageId,
      role: 'user',
      status: 'done',
      clientNonce: event.clientNonce,
      clientSeq: event.clientSeq,
      createdAt: event.createdAt,
      turnId: state.turnId,
      parts: [
        ...(event.text ? [{ type: 'text' as const, id: `${event.messageId}:text:0`, text: event.text }] : []),
        ...(event.files ?? []),
      ],
    }
    return withCommittedMessages({
      ...state,
      queue: { followUps: removeQueueEntryForMessageStart(state.queue.followUps, event) },
      optimisticOutbox: removeOutboxForMessageStart(state.optimisticOutbox, event),
    }, replaceOrAppendMessage(state.committedMessages, message))
  }

  const assistant: BoringChatMessage = {
    id: event.messageId,
    role: 'assistant',
    status: 'streaming',
    createdAt: event.createdAt,
    turnId: state.turnId,
    parts: event.text ? [{ type: 'text', id: `${event.messageId}:text:0`, text: event.text }] : [],
  }
  const prepared = prepareNewStreamingAssistantMessage(state, event.messageId, assistant.parts, { createdAt: event.createdAt })
  return { ...prepared.state, status: 'streaming', streamingMessage: prepared.message }
}

function applyToolCall(state: PiChatState, event: Extract<PiChatEvent, { type: 'tool-call' }>): PiChatState {
  const nextPending = new Set(state.pendingToolCallIds)
  nextPending.add(event.toolCallId)
  return updateMessageById(
    { ...state, pendingToolCallIds: nextPending },
    event.messageId,
    (message) => upsertPart(message, {
      type: 'tool-call',
      id: event.toolCallId,
      toolName: event.toolName,
      input: event.input,
      state: 'input-available',
      ui: event.ui,
    }),
  )
}

function applyToolResult(state: PiChatState, event: Extract<PiChatEvent, { type: 'tool-result' }>): PiChatState {
  const nextPending = new Set(state.pendingToolCallIds)
  nextPending.delete(event.toolCallId)
  const toolTarget = findToolCallTarget(state, event.toolCallId)
  if (toolTarget) {
    const nextState = updateToolCallTarget(
      { ...state, pendingToolCallIds: nextPending },
      toolTarget,
      event.toolCallId,
      (part) => mergeToolResultPart(part, event),
    )
    return nextPending.size === 0 && toolTarget.type === 'committed'
      ? markCommittedMessageDoneAtIndex(nextState, toolTarget.index)
      : nextState
  }

  if (!hasMessageById(state, event.messageId)) {
    return { ...state, pendingToolCallIds: nextPending }
  }
  const nextState = updateMessageById(
    { ...state, pendingToolCallIds: nextPending },
    event.messageId,
    (message) => updateToolPart(message, event.toolCallId, (part) => mergeToolResultPart(part, event)),
  )
  return nextPending.size === 0 ? markCommittedMessageDone(nextState, event.messageId) : nextState
}

type ToolCallTarget = { type: 'streaming' } | { type: 'committed'; index: number }

function findToolCallTarget(state: PiChatState, toolCallId: string): ToolCallTarget | undefined {
  if (state.streamingMessage?.parts.some((part) => part.type === 'tool-call' && part.id === toolCallId)) return { type: 'streaming' }
  const committedIndex = findLatestCommittedMessageIndexWithToolCall(state.committedMessages, toolCallId)
  return committedIndex >= 0 ? { type: 'committed', index: committedIndex } : undefined
}

function findLatestCommittedMessageIndexWithToolCall(messages: BoringChatMessage[], toolCallId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.parts.some((part) => part.type === 'tool-call' && part.id === toolCallId)) return index
  }
  return -1
}

function updateToolCallTarget(
  state: PiChatState,
  target: ToolCallTarget,
  toolCallId: string,
  update: (part: Extract<BoringChatPart, { type: 'tool-call' }>) => BoringChatPart,
): PiChatState {
  if (target.type === 'streaming') {
    return state.streamingMessage
      ? { ...state, streamingMessage: updateToolPart(state.streamingMessage, toolCallId, update) }
      : state
  }
  const message = state.committedMessages[target.index]
  if (!message) return state
  const nextCommitted = [...state.committedMessages]
  nextCommitted[target.index] = updateToolPart(message, toolCallId, update)
  return { ...state, committedMessages: nextCommitted }
}

function normalizeChatMessage(message: BoringChatMessage): BoringChatMessage {
  if (message.role !== 'assistant') return message
  const parts = mergeFinalMessageParts([], message.parts)
  return {
    ...message,
    status: shouldKeepFinalMessageStreaming(message, parts) ? 'streaming' : message.status,
    parts,
  }
}

function normalizeSnapshotMessages(messages: BoringChatMessage[]): BoringChatMessage[] {
  const normalized: BoringChatMessage[] = []
  for (const message of messages) {
    const next = normalizeChatMessage(message)
    const previous = normalized[normalized.length - 1]
    if (previous?.role === 'assistant' && next.role === 'assistant' && shouldMergeAssistantSnapshotMessages(previous, next)) {
      normalized[normalized.length - 1] = mergeAssistantSnapshotMessages(previous, next)
    } else {
      normalized.push(next)
    }
  }
  return normalized
}

function shouldMergeAssistantSnapshotMessages(previous: BoringChatMessage, next: BoringChatMessage): boolean {
  if (previous.turnId && next.turnId && previous.turnId !== next.turnId) return false
  if (previous.id === next.id) return true
  return Boolean(previous.turnId && next.turnId && previous.turnId === next.turnId)
}

function mergeAssistantSnapshotMessages(previous: BoringChatMessage, next: BoringChatMessage): BoringChatMessage {
  const previousParts = previous.id === next.id ? previous.parts : markTextPartsPreservedForFold(previous.parts)
  const parts = mergeFinalMessageParts(previousParts, next.parts, {
    preserveCoveredTextPartKeys: previous.id === next.id
      ? undefined
      : collectTextPartPreservationKeys(previousParts),
  })
  return {
    ...previous,
    ...next,
    createdAt: earliestCreatedAt(previous.createdAt, next.createdAt),
    parts,
    status: preservedFinalMessageStatus(next, previous, parts),
  }
}

function updateMessageById(state: PiChatState, messageId: string, update: (message: BoringChatMessage) => BoringChatMessage): PiChatState {
  if (state.streamingMessage?.id === messageId) {
    return { ...state, streamingMessage: update(state.streamingMessage) }
  }

  const committedIndex = findCommittedMessageUpdateIndex(state.committedMessages, messageId, state.turnId)
  if (committedIndex >= 0) {
    const nextCommitted = [...state.committedMessages]
    nextCommitted[committedIndex] = update(nextCommitted[committedIndex]!)
    return { ...state, committedMessages: nextCommitted }
  }

  const prepared = prepareNewStreamingAssistantMessage(state, messageId, [])
  return { ...prepared.state, streamingMessage: update(prepared.message), status: 'streaming' }
}

function hasMessageById(state: PiChatState, messageId: string): boolean {
  return (
    state.streamingMessage?.id === messageId ||
    findCommittedMessageUpdateIndex(state.committedMessages, messageId, state.turnId) >= 0
  )
}

function findCommittedMessageUpdateIndex(
  messages: BoringChatMessage[],
  messageId: string,
  activeTurnId: string | undefined,
): number {
  let latestSameIdIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.id !== messageId) continue
    if (activeTurnId && message.turnId === activeTurnId) return index
    if (latestSameIdIndex < 0) latestSameIdIndex = index
  }
  return latestSameIdIndex
}

function prepareNewStreamingAssistantMessage(
  state: PiChatState,
  messageId: string,
  parts: BoringChatPart[],
  options: { createdAt?: string } = {},
): { state: PiChatState; message: BoringChatMessage } {
  const message: BoringChatMessage = {
    id: messageId,
    role: 'assistant',
    status: 'streaming',
    createdAt: options.createdAt,
    turnId: state.turnId,
    parts,
  }
  if (!state.streamingMessage) {
    const committedMergeTarget = findCommittedAssistantMergeTargetForNewStreaming(state.committedMessages, state.turnId)
    if (!committedMergeTarget) return { state, message }
    const preservedParts = markTextPartsPreservedForFold(committedMergeTarget.message.parts)
    return {
      state: {
        ...state,
        committedMessages: state.committedMessages.filter((_, index) => index !== committedMergeTarget.index),
        streamingPreservedTextPartKeys: collectTextPartPreservationKeys(preservedParts),
      },
      message: {
        ...message,
        createdAt: earliestCreatedAt(committedMergeTarget.message.createdAt, message.createdAt),
        parts: mergeFinalMessageParts(preservedParts, parts),
      },
    }
  }
  if (state.streamingMessage.id === messageId) {
    return {
      state,
      message: {
        ...state.streamingMessage,
        createdAt: earliestCreatedAt(state.streamingMessage.createdAt, options.createdAt),
        parts: mergeFinalMessageParts(state.streamingMessage.parts, parts),
      },
    }
  }
  if (!state.streamingMessage.turnId || !state.turnId || state.streamingMessage.turnId !== state.turnId) return { state, message }
  const preservedParts = markTextPartsPreservedForFold(state.streamingMessage.parts)
  return {
    state: {
      ...state,
      streamingMessage: undefined,
      streamingPreservedTextPartKeys: mergeTextPartPreservationKeys(
        state.streamingPreservedTextPartKeys,
        collectTextPartPreservationKeys(preservedParts),
      ),
    },
    message: {
      ...message,
      createdAt: earliestCreatedAt(state.streamingMessage.createdAt, message.createdAt),
      parts: mergeFinalMessageParts(preservedParts, parts),
    },
  }
}

function mergeTextPartPreservationKeys(
  left: Set<string> | undefined,
  right: Set<string>,
): Set<string> {
  return new Set([...(left ?? []), ...right])
}

function findCommittedAssistantMergeTargetForNewStreaming(
  messages: BoringChatMessage[],
  turnId: string | undefined,
): { message: BoringChatMessage; index: number } | undefined {
  if (!turnId) return undefined
  const index = messages.length - 1
  const previous = messages[index]
  if (previous?.role !== 'assistant' || previous.turnId !== turnId) return undefined
  return { message: previous, index }
}

function appendPartDelta(message: BoringChatMessage, partId: string, kind: 'text' | 'reasoning', delta: string): BoringChatMessage {
  const partIndex = message.parts.findIndex((part) => part.id === partId && part.type === kind)
  if (partIndex >= 0) {
    const parts = [...message.parts]
    const part = parts[partIndex]!
    if (part.type === 'text') parts[partIndex] = { ...part, text: part.text + delta }
    if (part.type === 'reasoning') parts[partIndex] = { ...part, text: part.text + delta, state: 'streaming' }
    return { ...message, parts }
  }

  if (terminalMessageAlreadyCoversPartText(message, kind, delta)) return message

  const part: BoringChatPart = kind === 'text'
    ? { type: 'text', id: partId, text: delta }
    : { type: 'reasoning', id: partId, text: delta, state: 'streaming' }
  return { ...message, parts: [...message.parts, part] }
}

function finishPart(message: BoringChatMessage, partId: string, kind: 'text' | 'reasoning', text: string): BoringChatMessage {
  const partIndex = message.parts.findIndex((part) => part.id === partId && part.type === kind)
  if (partIndex >= 0) {
    const parts = [...message.parts]
    const part = parts[partIndex]!
    if (part.type === 'reasoning') parts[partIndex] = { ...part, text, state: 'done' }
    if (part.type === 'text') parts[partIndex] = { ...part, text }
    return { ...message, parts }
  }

  if (terminalMessageAlreadyCoversPartText(message, kind, text)) return message

  const part: BoringChatPart = kind === 'text'
    ? { type: 'text', id: partId, text }
    : { type: 'reasoning', id: partId, text, state: 'done' }
  return { ...message, parts: [...message.parts, part] }
}

function terminalMessageAlreadyCoversPartText(
  message: BoringChatMessage,
  kind: 'text' | 'reasoning',
  text: string,
): boolean {
  if (message.status === 'streaming' || text.length === 0) return false
  return message.parts.some((part) => (
    part.type === kind &&
    (part.text === text || part.text.includes(text))
  ))
}

function upsertPart(message: BoringChatMessage, part: BoringChatPart): BoringChatMessage {
  const partIndex = message.parts.findIndex((candidate) => candidate.id === part.id && candidate.type === part.type)
  if (partIndex < 0) return { ...message, parts: [...message.parts, part] }
  const parts = [...message.parts]
  parts[partIndex] = part
  return { ...message, parts }
}

function updateToolPart(
  message: BoringChatMessage,
  toolCallId: string,
  update: (part: Extract<BoringChatPart, { type: 'tool-call' }>) => BoringChatPart,
): BoringChatMessage {
  const partIndex = message.parts.findIndex((part) => part.type === 'tool-call' && part.id === toolCallId)
  if (partIndex < 0) return message
  const part = message.parts[partIndex]
  if (!part || part.type !== 'tool-call') return message
  const parts = [...message.parts]
  parts[partIndex] = update(part)
  return { ...message, parts }
}

function markCommittedMessageDone(state: PiChatState, messageId: string): PiChatState {
  const committedIndex = findCommittedMessageUpdateIndex(state.committedMessages, messageId, state.turnId)
  return markCommittedMessageDoneAtIndex(state, committedIndex)
}

function markCommittedMessageDoneAtIndex(state: PiChatState, committedIndex: number): PiChatState {
  if (committedIndex < 0 || state.committedMessages[committedIndex]?.status !== 'streaming') return state
  const nextCommitted = [...state.committedMessages]
  nextCommitted[committedIndex] = { ...nextCommitted[committedIndex]!, status: 'done' }
  return { ...state, committedMessages: nextCommitted }
}

function withCommittedMessages(state: PiChatState, committedMessages: BoringChatMessage[]): PiChatState {
  return {
    ...state,
    committedMessages,
    history: { mode: 'full', messageCount: committedMessages.length },
  }
}

function settleTurn(state: PiChatState, status: 'ok' | 'aborted' | 'error'): PiChatState {
  const shouldSettleStreamingMessage = status !== 'ok' && state.streamingMessage !== undefined
  if (state.pendingToolCallIds.size === 0 && !shouldSettleStreamingMessage) return state
  const toolState = status === 'error' ? 'output-error' : 'aborted'
  const settleParts = (message: BoringChatMessage): BoringChatMessage => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type === 'tool-call' && state.pendingToolCallIds.has(part.id)) return { ...part, state: toolState }
      if (status !== 'ok' && part.type === 'reasoning' && part.state === 'streaming') return { ...part, state: 'done' }
      return part
    }),
  })
  const settleCommittedMessage = (message: BoringChatMessage): BoringChatMessage => {
    const settled = settleParts(message)
    if (status === 'ok' || message.role !== 'assistant') return settled
    const hadPendingTool = message.parts.some((part) => part.type === 'tool-call' && state.pendingToolCallIds.has(part.id))
    if (message.status !== 'streaming' && !hadPendingTool) return settled
    return { ...settled, status: status === 'error' ? 'error' : 'aborted' }
  }
  const settleStreamingMessage = (message: BoringChatMessage): BoringChatMessage => {
    const settled = settleParts(message)
    if (status === 'ok') return settled
    return { ...settled, status: status === 'error' ? 'error' : 'aborted' }
  }
  let committedMessages = state.committedMessages.map(settleCommittedMessage)
  let streamingMessage = state.streamingMessage ? settleStreamingMessage(state.streamingMessage) : undefined
  if (status !== 'ok' && streamingMessage) {
    committedMessages = replaceOrAppendTerminalStreamingMessage(committedMessages, streamingMessage)
    streamingMessage = undefined
  }
  return {
    ...state,
    streamingMessage,
    streamingPreservedTextPartKeys: streamingMessage ? state.streamingPreservedTextPartKeys : undefined,
    committedMessages,
    pendingToolCallIds: new Set(),
  }
}

function replaceOrAppendTerminalStreamingMessage(messages: BoringChatMessage[], message: BoringChatMessage): BoringChatMessage[] {
  if (!message.turnId) return [...messages, message]
  let index = -1
  for (let candidateIndex = messages.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = messages[candidateIndex]
    if (candidate?.id === message.id && candidate.turnId === message.turnId) {
      index = candidateIndex
      break
    }
  }
  if (index < 0) return [...messages, message]
  const next = [...messages]
  next[index] = message
  return next
}

function collectPendingToolCallIds(messages: BoringChatMessage[]): Set<string> {
  const pending = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool-call' && isToolPending(part)) pending.add(part.id)
    }
  }
  return pending
}

function upsertNotice(notices: PiChatRuntimeNotice[], notice: PiChatRuntimeNotice): PiChatRuntimeNotice[] {
  const index = notices.findIndex((candidate) => candidate.id === notice.id)
  if (index < 0) return [...notices, notice]
  const next = [...notices]
  next[index] = notice
  return next
}
