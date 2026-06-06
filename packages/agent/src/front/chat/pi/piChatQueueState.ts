import type {
  BoringChatMessage,
  PiChatEvent,
  QueuedUserMessage,
} from '../../../shared/chat'

export interface OptimisticUserMessage extends BoringChatMessage {
  role: 'user'
  clientNonce: string
  clientSeq?: number
}

export function removeOutboxEntry(outbox: Record<string, OptimisticUserMessage>, clientNonce?: string): Record<string, OptimisticUserMessage> {
  if (!clientNonce || !(clientNonce in outbox)) return outbox
  const next = { ...outbox }
  delete next[clientNonce]
  return next
}

export function removeOutboxForMessageStart(
  outbox: Record<string, OptimisticUserMessage>,
  event: Extract<PiChatEvent, { type: 'message-start' }>,
): Record<string, OptimisticUserMessage> {
  if (event.clientNonce) return removeOutboxEntry(outbox, event.clientNonce)
  if (event.clientSeq !== undefined) return clearOptimisticFollowUps(outbox, { clientSeq: event.clientSeq })
  return outbox
}

export function removeQueueEntryForMessageStart(
  queue: QueuedUserMessage[],
  event: Extract<PiChatEvent, { type: 'message-start' }>,
): QueuedUserMessage[] {
  if (event.clientNonce) return queue.filter((queued) => queued.clientNonce !== event.clientNonce)
  if (event.clientSeq !== undefined) return queue.filter((queued) => queued.clientSeq !== event.clientSeq)
  return queue
}

export function clearOptimisticFollowUps(
  outbox: Record<string, OptimisticUserMessage>,
  selector: { clientNonce?: string; clientSeq?: number },
): Record<string, OptimisticUserMessage> {
  if (selector.clientNonce) return removeOutboxEntry(outbox, selector.clientNonce)
  let next = outbox
  for (const message of Object.values(outbox)) {
    if (message.clientSeq === undefined) continue
    if (selector.clientSeq !== undefined && message.clientSeq !== selector.clientSeq) continue
    next = removeOutboxEntry(next, message.clientNonce)
  }
  return next
}

export function clearQueuedFollowUps(
  queue: QueuedUserMessage[],
  selector: { clientNonce?: string; clientSeq?: number },
): QueuedUserMessage[] {
  if (!selector.clientNonce && selector.clientSeq === undefined) return []
  return queue.filter((queued) => {
    if (selector.clientNonce) return queued.clientNonce !== selector.clientNonce
    return queued.clientSeq !== selector.clientSeq
  })
}

export function removeOutboxMatchingQueue(
  outbox: Record<string, OptimisticUserMessage>,
  queue: QueuedUserMessage[],
): Record<string, OptimisticUserMessage> {
  const metadataFreeTextCounts = countMetadataFreeQueueTexts(queue)
  let next = outbox
  for (const queued of queue) {
    if (queued.clientNonce) {
      next = removeOutboxEntry(next, queued.clientNonce)
      continue
    }
    if (queued.clientSeq !== undefined) {
      const match = Object.values(next).find((message) => message.clientSeq === queued.clientSeq)
      if (match) next = removeOutboxEntry(next, match.clientNonce)
      continue
    }
    if ((metadataFreeTextCounts.get(queued.displayText) ?? 0) !== 1) continue
    const matches = Object.values(next).filter((message) => (
      message.clientSeq !== undefined && optimisticText(message) === queued.displayText
    ))
    if (matches.length === 1) next = removeOutboxEntry(next, matches[0].clientNonce)
  }
  return next
}

export function enrichQueueWithKnownMetadata(
  queue: QueuedUserMessage[],
  outbox: Record<string, OptimisticUserMessage>,
  previousQueue: QueuedUserMessage[] = [],
): QueuedUserMessage[] {
  const metadataFreeTextCounts = countMetadataFreeQueueTexts(queue)
  const previousById = new Map(previousQueue.filter(hasQueuedSelector).map((queued) => [queued.id, queued]))
  return queue.map((queued) => {
    if (queued.clientNonce || queued.clientSeq !== undefined) return queued
    const previousBySameId = previousById.get(queued.id)
    if (previousBySameId) return copyQueuedSelector(queued, previousBySameId)
    if ((metadataFreeTextCounts.get(queued.displayText) ?? 0) !== 1) return queued
    const matches = Object.values(outbox).filter((message) => (
      message.clientSeq !== undefined && optimisticText(message) === queued.displayText
    ))
    const match = matches[0]
    if (matches.length === 1 && match) return { ...queued, clientNonce: match.clientNonce, clientSeq: match.clientSeq }
    const previousMatches = previousQueue.filter((previous) => hasQueuedSelector(previous) && previous.displayText === queued.displayText)
    const previousMatch = previousMatches[0]
    if (previousMatches.length === 1 && previousMatch) return copyQueuedSelector(queued, previousMatch)
    return queued
  })
}

function hasQueuedSelector(queued: QueuedUserMessage): boolean {
  return Boolean(queued.clientNonce) || queued.clientSeq !== undefined
}

function copyQueuedSelector(queued: QueuedUserMessage, source: QueuedUserMessage): QueuedUserMessage {
  return {
    ...queued,
    ...(source.clientNonce ? { clientNonce: source.clientNonce } : {}),
    ...(source.clientSeq !== undefined ? { clientSeq: source.clientSeq } : {}),
  }
}

function countMetadataFreeQueueTexts(queue: QueuedUserMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const queued of queue) {
    if (queued.clientNonce || queued.clientSeq !== undefined) continue
    counts.set(queued.displayText, (counts.get(queued.displayText) ?? 0) + 1)
  }
  return counts
}

function optimisticText(message: OptimisticUserMessage): string | undefined {
  const firstText = message.parts.find((part) => part.type === 'text')
  return firstText?.type === 'text' ? firstText.text : undefined
}
