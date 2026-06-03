import type {
  BoringChatMessage,
  BoringChatPart,
  ChatError,
  PiChatEvent,
  PiChatSnapshot,
  PiChatStatus,
  QueuedUserMessage,
} from '../../../shared/chat'

export type PiChatConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface OptimisticUserMessage extends BoringChatMessage {
  role: 'user'
  clientNonce: string
  clientSeq?: number
}

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
  | { type: 'hydrate'; snapshot: PiChatSnapshot }
  | { type: 'event'; event: PiChatEvent }
  | { type: 'optimistic-user-message'; message: OptimisticUserMessage }
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
      return hydrateFromSnapshot(state, action.snapshot)
    case 'event':
      return applySequencedEvent(state, action.event)
    case 'optimistic-user-message':
      return {
        ...state,
        optimisticOutbox: {
          ...state.optimisticOutbox,
          [action.message.clientNonce]: action.message,
        },
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

function hydrateFromSnapshot(state: PiChatState, snapshot: PiChatSnapshot): PiChatState {
  if (snapshot.seq < state.lastSeq) return state

  const serverNonces = new Set<string>()
  for (const message of snapshot.messages) {
    if (message.clientNonce) serverNonces.add(message.clientNonce)
  }
  for (const followUp of snapshot.queue.followUps) {
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
    committedMessages: snapshot.messages,
    streamingMessage: undefined,
    history: { mode: 'full', messageCount: snapshot.messages.length },
    queue: snapshot.queue,
    optimisticOutbox: nextOutbox,
    pendingToolCallIds: collectPendingToolCallIds(snapshot.messages),
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
      return { ...state, status: 'streaming', turnId: event.turnId, error: undefined }
    case 'agent-end':
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
    case 'queue-updated':
      return {
        ...state,
        queue: event.queue,
        optimisticOutbox: removeOutboxMatchingQueue(state.optimisticOutbox, event.queue.followUps),
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
      return settleTurn({
        ...state,
        status: 'error',
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

function applyMessageStart(state: PiChatState, event: Extract<PiChatEvent, { type: 'message-start' }>): PiChatState {
  if (event.role === 'user') {
    const message: BoringChatMessage = {
      id: event.messageId,
      role: 'user',
      status: 'done',
      clientNonce: event.clientNonce,
      turnId: state.turnId,
      parts: [
        ...(event.text ? [{ type: 'text' as const, id: `${event.messageId}:text:0`, text: event.text }] : []),
        ...(event.files ?? []),
      ],
    }
    return withCommittedMessages({
      ...state,
      optimisticOutbox: removeOutboxEntry(state.optimisticOutbox, event.clientNonce),
    }, replaceOrAppendMessage(state.committedMessages, message))
  }

  const assistant: BoringChatMessage = {
    id: event.messageId,
    role: 'assistant',
    status: 'streaming',
    turnId: state.turnId,
    parts: event.text ? [{ type: 'text', id: `${event.messageId}:text:0`, text: event.text }] : [],
  }
  return { ...state, status: 'streaming', streamingMessage: assistant }
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
  return updateMessageById(
    { ...state, pendingToolCallIds: nextPending },
    event.messageId,
    (message) => updateToolPart(message, event.toolCallId, (part) => ({
      ...part,
      state: event.isError ? 'output-error' : 'output-available',
      output: event.output,
      errorText: event.isError ? event.errorText : part.errorText,
      ui: part.ui ?? event.ui,
    })),
  )
}

function commitFinalMessage(state: PiChatState, messageId: string, final: BoringChatMessage): PiChatState {
  const nextPending = new Set(state.pendingToolCallIds)
  for (const part of final.parts) {
    if (part.type === 'tool-call' && isToolPending(part)) nextPending.add(part.id)
    if (part.type === 'tool-call' && !isToolPending(part)) nextPending.delete(part.id)
  }

  return withCommittedMessages({
    ...state,
    streamingMessage: state.streamingMessage?.id === messageId ? undefined : state.streamingMessage,
    pendingToolCallIds: nextPending,
  }, replaceOrAppendMessage(state.committedMessages.filter((message) => message.id !== messageId), final))
}

function updateMessageById(state: PiChatState, messageId: string, update: (message: BoringChatMessage) => BoringChatMessage): PiChatState {
  if (state.streamingMessage?.id === messageId) {
    return { ...state, streamingMessage: update(state.streamingMessage) }
  }

  const committedIndex = state.committedMessages.findIndex((message) => message.id === messageId)
  if (committedIndex >= 0) {
    const nextCommitted = [...state.committedMessages]
    nextCommitted[committedIndex] = update(nextCommitted[committedIndex]!)
    return { ...state, committedMessages: nextCommitted }
  }

  const message: BoringChatMessage = { id: messageId, role: 'assistant', status: 'streaming', turnId: state.turnId, parts: [] }
  return { ...state, streamingMessage: update(message), status: 'streaming' }
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

  const part: BoringChatPart = kind === 'text'
    ? { type: 'text', id: partId, text }
    : { type: 'reasoning', id: partId, text, state: 'done' }
  return { ...message, parts: [...message.parts, part] }
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

function replaceOrAppendMessage(messages: BoringChatMessage[], message: BoringChatMessage): BoringChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id)
  if (index < 0) return [...messages, message]
  const next = [...messages]
  next[index] = message
  return next
}

function withCommittedMessages(state: PiChatState, committedMessages: BoringChatMessage[]): PiChatState {
  return {
    ...state,
    committedMessages,
    history: { mode: 'full', messageCount: committedMessages.length },
  }
}

function settleTurn(state: PiChatState, status: 'ok' | 'aborted' | 'error'): PiChatState {
  if (state.pendingToolCallIds.size === 0) return state
  const toolState = status === 'error' ? 'output-error' : 'aborted'
  const settle = (message: BoringChatMessage): BoringChatMessage => ({
    ...message,
    parts: message.parts.map((part) => part.type === 'tool-call' && state.pendingToolCallIds.has(part.id) ? { ...part, state: toolState } : part),
  })
  return {
    ...state,
    streamingMessage: state.streamingMessage ? settle(state.streamingMessage) : undefined,
    committedMessages: state.committedMessages.map(settle),
    pendingToolCallIds: new Set(),
  }
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

function isToolPending(part: Extract<BoringChatPart, { type: 'tool-call' }>): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}

function removeOutboxEntry(outbox: Record<string, OptimisticUserMessage>, clientNonce?: string): Record<string, OptimisticUserMessage> {
  if (!clientNonce || !(clientNonce in outbox)) return outbox
  const next = { ...outbox }
  delete next[clientNonce]
  return next
}

function removeOutboxMatchingQueue(
  outbox: Record<string, OptimisticUserMessage>,
  queue: QueuedUserMessage[],
): Record<string, OptimisticUserMessage> {
  let next = outbox
  for (const queued of queue) {
    if (queued.clientNonce) next = removeOutboxEntry(next, queued.clientNonce)
  }
  return next
}

function upsertNotice(notices: PiChatRuntimeNotice[], notice: PiChatRuntimeNotice): PiChatRuntimeNotice[] {
  const index = notices.findIndex((candidate) => candidate.id === notice.id)
  if (index < 0) return [...notices, notice]
  const next = [...notices]
  next[index] = notice
  return next
}
