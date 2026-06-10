import type { BoringChatMessage, BoringChatPart, QueuedUserMessage } from '../../../shared/chat'
import type { PiChatRuntimeNotice, PiChatState } from './piChatReducer'
import { earliestCreatedAt } from './piChatMessageMetadata'
import { mergeFinalMessageParts, preservedFinalMessageStatus } from './piChatPartMerging'

export function selectMessagesForRender(state: PiChatState): BoringChatMessage[] {
  const messages = foldRenderableAssistantMessages(state.committedMessages)
  const optimisticMessages = Object.values(state.optimisticOutbox)
    .filter((optimistic) => !messages.some((message) => message.clientNonce === optimistic.clientNonce))

  for (const optimistic of optimisticMessages) {
    if (optimistic.clientSeq === undefined) insertOptimisticPrompt(messages, optimistic, optimistic.afterMessageId)
  }
  if (state.streamingMessage) upsertRenderableStreamingMessage(messages, state.streamingMessage)
  return messages
}

export function selectQueuePreview(state: PiChatState): QueuedUserMessage[] {
  const followUps = [...state.queue.followUps]
  const representedNonces = new Set(followUps.map((followUp) => followUp.clientNonce).filter(Boolean))
  const representedClientSeqs = new Set(followUps
    .map((followUp) => followUp.clientSeq)
    .filter((clientSeq): clientSeq is number => clientSeq !== undefined))
  const metadataFreeTextCounts = new Map<string, number>()
  for (const followUp of followUps) {
    if (followUp.clientNonce || followUp.clientSeq !== undefined) continue
    metadataFreeTextCounts.set(followUp.displayText, (metadataFreeTextCounts.get(followUp.displayText) ?? 0) + 1)
  }

  for (const message of Object.values(state.optimisticOutbox)) {
    if (message.clientSeq === undefined) continue
    if (message.clientNonce && representedNonces.has(message.clientNonce)) continue
    if (representedClientSeqs.has(message.clientSeq)) continue
    const text = optimisticText(message)
    const metadataFreeTextCount = metadataFreeTextCounts.get(text) ?? 0
    if (metadataFreeTextCount > 0) {
      metadataFreeTextCounts.set(text, metadataFreeTextCount - 1)
      continue
    }
    followUps.push({
      id: `optimistic:${message.clientNonce}`,
      kind: 'followup',
      displayText: text,
      clientNonce: message.clientNonce,
      clientSeq: message.clientSeq,
    })
  }
  return followUps
}

export function selectRuntimeNotices(state: PiChatState): PiChatRuntimeNotice[] {
  const notices = [...state.notices]
  if (state.connection.state === 'reconnecting') {
    notices.push({ id: 'connection-reconnecting', level: 'warning', text: 'Reconnecting to the agent session…' })
  }
  if (state.retryNotice) {
    notices.push({
      id: 'auto-retry',
      level: 'info',
      text: `Retrying agent request (${state.retryNotice.attempt}/${state.retryNotice.maxAttempts})…`,
    })
  }
  if (state.error && !notices.some((notice) => notice.id.startsWith('turn-error:') || notice.id === 'protocol-error')) {
    notices.push({ id: 'chat-error', level: 'error', text: state.error.message, dismissible: true })
  }
  return notices
}

function optimisticText(message: BoringChatMessage): string {
  const text = message.parts
    .filter((part): part is Extract<BoringChatPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
  return text
}

function insertOptimisticPrompt(messages: BoringChatMessage[], optimistic: BoringChatMessage, afterMessageId?: string): void {
  // Preferred: position by the message that was last committed when the prompt
  // was submitted. This is sequence-based, so client/server clock skew can't
  // float a just-sent prompt above the previous reply.
  if (afterMessageId !== undefined) {
    const anchorIndex = messages.findIndex((message) => message.id === afterMessageId)
    if (anchorIndex >= 0) {
      messages.splice(anchorIndex + 1, 0, optimistic)
      return
    }
  }

  // Fallback (e.g. recovered placeholder whose anchor isn't in view): order by
  // creation time, then append.
  const optimisticTime = messageCreatedAtMs(optimistic)
  if (optimisticTime === undefined) {
    messages.push(optimistic)
    return
  }

  const insertAt = messages.findIndex((message) => {
    const messageTime = messageCreatedAtMs(message)
    return messageTime !== undefined && messageTime > optimisticTime
  })
  if (insertAt === -1) messages.push(optimistic)
  else messages.splice(insertAt, 0, optimistic)
}

function foldRenderableAssistantMessages(source: BoringChatMessage[]): BoringChatMessage[] {
  const messages: BoringChatMessage[] = []
  for (const message of source) {
    if (message.role !== 'assistant') {
      messages.push(message)
      continue
    }
    const mergeIndex = findRenderableAssistantMergeIndex(messages, message)
    if (mergeIndex < 0) {
      messages.push(message)
      continue
    }
    messages[mergeIndex] = mergeRenderableAssistantMessage(messages[mergeIndex]!, message)
  }
  return messages
}

function upsertRenderableStreamingMessage(messages: BoringChatMessage[], streamingMessage: BoringChatMessage): void {
  const mergeIndex = findRenderableAssistantMergeIndex(messages, streamingMessage)
  if (mergeIndex < 0) {
    messages.push(streamingMessage)
    return
  }
  messages[mergeIndex] = mergeRenderableAssistantMessage(messages[mergeIndex]!, streamingMessage)
}

function findRenderableAssistantMergeIndex(messages: BoringChatMessage[], message: BoringChatMessage): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]
    if (!candidate) continue
    if (candidate.id === message.id && candidate.role === message.role) {
      if (isDifferentAssistantTurn(candidate, message)) continue
      return index
    }
    if (candidate.role === 'assistant' && message.role === 'assistant' && candidate.turnId && candidate.turnId === message.turnId) {
      return index
    }
    // Stop at a user turn: Pi keeps the agent loop (and turnId) open while it
    // drains a queued follow-up, so the follow-up's assistant reply shares the
    // previous reply's turnId. Merging across the intervening user message would
    // fold the new reply into the old one and push the queued prompt out of order.
    if (candidate.role === 'user') break
  }
  return -1
}

function isDifferentAssistantTurn(left: BoringChatMessage, right: BoringChatMessage): boolean {
  return Boolean(
    left.role === 'assistant' &&
    right.role === 'assistant' &&
    left.turnId &&
    right.turnId &&
    left.turnId !== right.turnId,
  )
}

function mergeRenderableAssistantMessage(previous: BoringChatMessage, next: BoringChatMessage): BoringChatMessage {
  if (previous.role !== 'assistant' || next.role !== 'assistant') return next
  const parts = mergeFinalMessageParts(previous.parts, next.parts)
  return {
    ...previous,
    ...next,
    createdAt: earliestCreatedAt(previous.createdAt, next.createdAt),
    parts,
    status: preservedFinalMessageStatus(next, previous, parts),
  }
}

function messageCreatedAtMs(message: BoringChatMessage): number | undefined {
  if (!message.createdAt) return undefined
  const timestamp = Date.parse(message.createdAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}
