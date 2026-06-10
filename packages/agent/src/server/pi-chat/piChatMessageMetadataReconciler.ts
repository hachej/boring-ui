import type {
  BoringChatMessage,
  FollowUpPayload,
  PiChatEvent,
  PiChatSnapshot,
  PromptPayload,
  QueuedUserMessage,
  QueueClearPayload,
} from '../../shared/chat'
import { buildPiChatQueuedFollowUps } from './piChatSnapshot'

interface FollowUpMetadata {
  displayText: string
  serverText?: string
  clientNonce?: string
  clientSeq?: number
  recordedAt?: number
}

export class PiChatMessageMetadataReconciler {
  private readonly promptMetadata = new Map<string, FollowUpMetadata[]>()
  private readonly followUpMetadata = new Map<string, FollowUpMetadata[]>()
  private readonly consumingFollowUpMetadata = new Map<string, FollowUpMetadata[]>()

  clearSession(sessionId: string): void {
    this.promptMetadata.delete(sessionId)
    this.followUpMetadata.delete(sessionId)
    this.consumingFollowUpMetadata.delete(sessionId)
  }

  clearFollowUps(sessionId: string): void {
    this.followUpMetadata.delete(sessionId)
  }

  recordPrompt(sessionId: string, payload: PromptPayload): void {
    const metadata = this.promptMetadata.get(sessionId) ?? []
    const displayText = payload.displayMessage ?? payload.message
    metadata.push({
      displayText,
      ...(displayText !== payload.message ? { serverText: payload.message } : {}),
      clientNonce: payload.clientNonce,
      recordedAt: Date.now(),
    })
    this.promptMetadata.set(sessionId, metadata)
  }

  removePrompt(sessionId: string, selector: { clientNonce?: string; displayText?: string }): void {
    const metadata = this.promptMetadata.get(sessionId)
    if (!metadata) return
    const index = selector.clientNonce
      ? metadata.findIndex((entry) => entry.clientNonce === selector.clientNonce)
      : metadata.findIndex((entry) => matchesMetadataText(entry, selector.displayText))
    if (index < 0) return
    metadata.splice(index, 1)
    if (metadata.length > 0) this.promptMetadata.set(sessionId, metadata)
    else this.promptMetadata.delete(sessionId)
  }

  hasPrompt(sessionId: string, selector: { clientNonce?: string; displayText?: string }): boolean {
    const metadata = this.promptMetadata.get(sessionId)
    if (!metadata) return false
    if (selector.clientNonce) return metadata.some((entry) => entry.clientNonce === selector.clientNonce)
    return metadata.some((entry) => matchesMetadataText(entry, selector.displayText))
  }

  recordFollowUp(sessionId: string, payload: FollowUpPayload): void {
    const metadata = this.followUpMetadata.get(sessionId) ?? []
    const displayText = payload.displayMessage ?? payload.message
    metadata.push({
      displayText,
      ...(displayText !== payload.message ? { serverText: payload.message } : {}),
      clientNonce: payload.clientNonce,
      clientSeq: payload.clientSeq,
      recordedAt: Date.now(),
    })
    this.followUpMetadata.set(sessionId, metadata)
  }

  removeFollowUp(sessionId: string, selector: QueueClearPayload): void {
    this.removeFollowUpFrom(this.consumingFollowUpMetadata, sessionId, selector)
    this.removeFollowUpFrom(this.followUpMetadata, sessionId, selector)
  }

  recordConsumingFollowUp(sessionId: string, followUp: QueuedUserMessage, serverText?: string): void {
    const metadata = this.consumingFollowUpMetadata.get(sessionId) ?? []
    metadata.push({
      displayText: followUp.displayText,
      ...(serverText && serverText !== followUp.displayText ? { serverText } : {}),
      clientNonce: followUp.clientNonce,
      clientSeq: followUp.clientSeq,
      recordedAt: Date.now(),
    })
    this.consumingFollowUpMetadata.set(sessionId, metadata)
  }

  findFollowUpForQueueItem(sessionId: string, followUp: QueuedUserMessage): FollowUpMetadata | undefined {
    const entries = [
      ...(this.consumingFollowUpMetadata.get(sessionId) ?? []),
      ...(this.followUpMetadata.get(sessionId) ?? []),
    ]
    return entries.find((entry) => matchesFollowUpSelector(entry, followUp))
      ?? entries.find((entry) => matchesMetadataText(entry, followUp.displayText))
  }

  enrichSnapshot(sessionId: string, snapshot: PiChatSnapshot): PiChatSnapshot {
    const messages = this.enrichSnapshotMessages(sessionId, snapshot.messages)
    const followUps = this.enrichQueuedFollowUps(sessionId, snapshot.queue.followUps)
    this.syncFromQueue(sessionId, followUps)
    return { ...snapshot, messages, queue: { followUps } }
  }

  enrichEvent(sessionId: string, event: PiChatEvent): PiChatEvent {
    if (event.type === 'queue-updated') {
      const followUps = this.enrichQueuedFollowUps(sessionId, event.queue.followUps)
      this.syncFromQueue(sessionId, followUps)
      return { ...event, queue: { followUps } }
    }
    if (event.type === 'message-start' && event.role === 'user' && !hasFollowUpSelector(event)) {
      const promptMetadata = this.findPrompt(sessionId, event.text)
      if (promptMetadata) return { ...event, text: promptMetadata.displayText, clientNonce: promptMetadata.clientNonce }
      const metadata = this.findFollowUp(sessionId, event.text)
      if (metadata) return { ...event, text: metadata.displayText, clientNonce: metadata.clientNonce, clientSeq: metadata.clientSeq }
    }
    return event
  }

  consumeEvent(sessionId: string, event: PiChatEvent): void {
    this.consumeFollowUpFromEvent(sessionId, event)
    this.consumePromptFromEvent(sessionId, event)
  }

  enrichQueuedFollowUps(sessionId: string, followUps: QueuedUserMessage[]): QueuedUserMessage[] {
    const metadata = this.followUpMetadata.get(sessionId) ?? []
    if (metadata.length === 0) return followUps
    const followUpTextCounts = countTexts(followUps.map((followUp) => followUp.displayText))
    const metadataTextCounts = countMetadataTexts(metadata)
    return followUps.map((followUp, index) => {
      if (hasFollowUpSelector(followUp)) return followUp
      const indexed = metadata[index]
      if (matchesMetadataText(indexed, followUp.displayText)) return withQueuedSelector(followUp, indexed)
      if ((followUpTextCounts.get(followUp.displayText) ?? 0) !== 1) return followUp
      if ((metadataTextCounts.get(followUp.displayText) ?? 0) !== 1) return followUp
      const matched = metadata.find((entry) => matchesMetadataText(entry, followUp.displayText))
      return matched ? withQueuedSelector(followUp, matched) : followUp
    })
  }

  syncFromTexts(sessionId: string, followUps: readonly string[]): void {
    if (followUps.length === 0) {
      this.followUpMetadata.delete(sessionId)
      return
    }
    const metadata = this.enrichQueuedFollowUps(sessionId, buildPiChatQueuedFollowUps(sessionId, followUps))
    this.syncFromQueue(sessionId, metadata)
  }

  private enrichSnapshotMessages(sessionId: string, messages: BoringChatMessage[]): BoringChatMessage[] {
    const followUpMetadata = [
      ...(this.consumingFollowUpMetadata.get(sessionId) ?? []),
      ...(this.followUpMetadata.get(sessionId) ?? []),
    ]
    const promptMetadata = [...(this.promptMetadata.get(sessionId) ?? [])]
    if (followUpMetadata.length === 0 && promptMetadata.length === 0) return messages
    return messages.map((message) => {
      if (message.role !== 'user' || hasMessageSelector(message)) return message
      const text = messageText(message)
      const prompt = takeFirstMessageMetadata(promptMetadata, text, message)
      if (prompt) return withMessageSelector(message, prompt)
      const followUp = takeFirstMessageMetadata(followUpMetadata, text, message)
      return followUp ? withMessageSelector(message, followUp) : message
    })
  }

  private removeFollowUpFrom(source: Map<string, FollowUpMetadata[]>, sessionId: string, selector: QueueClearPayload): void {
    const metadata = source.get(sessionId)
    if (!metadata) return
    const index = metadata.findIndex((entry) => matchesFollowUpSelector(entry, selector))
    if (index < 0) return
    metadata.splice(index, 1)
    if (metadata.length > 0) source.set(sessionId, metadata)
    else source.delete(sessionId)
  }

  private consumeFollowUpFromEvent(sessionId: string, event: PiChatEvent): void {
    if (event.type === 'followup-consumed') {
      this.removeFollowUp(sessionId, event)
      return
    }
    if (event.type !== 'message-start' || event.role !== 'user') return
    if (hasFollowUpSelector(event)) {
      this.removeFollowUp(sessionId, event)
      return
    }
    this.removeFirstFollowUpByText(sessionId, event.text)
  }

  private findFollowUp(sessionId: string, text: string | undefined): FollowUpMetadata | undefined {
    if (!text) return undefined
    const consuming = this.consumingFollowUpMetadata.get(sessionId)?.find((entry) => matchesMetadataText(entry, text))
    if (consuming) return consuming
    return this.followUpMetadata.get(sessionId)?.find((entry) => matchesMetadataText(entry, text))
  }

  private findPrompt(sessionId: string, text: string | undefined): FollowUpMetadata | undefined {
    if (!text) return undefined
    return this.promptMetadata.get(sessionId)?.find((entry) => matchesMetadataText(entry, text))
  }

  private consumePromptFromEvent(sessionId: string, event: PiChatEvent): void {
    if (event.type !== 'message-start' || event.role !== 'user') return
    if (event.clientSeq !== undefined) return
    if (event.clientNonce) {
      this.removePrompt(sessionId, { clientNonce: event.clientNonce })
      return
    }
    this.removePrompt(sessionId, { displayText: event.text })
  }

  private removeFirstFollowUpByText(sessionId: string, text: string | undefined): void {
    if (!text) return
    if (this.removeFirstFollowUpByTextFrom(this.consumingFollowUpMetadata, sessionId, text)) return
    this.removeFirstFollowUpByTextFrom(this.followUpMetadata, sessionId, text)
  }

  private removeFirstFollowUpByTextFrom(source: Map<string, FollowUpMetadata[]>, sessionId: string, text: string): boolean {
    const metadata = source.get(sessionId)
    if (!metadata) return false
    const index = metadata.findIndex((entry) => matchesMetadataText(entry, text))
    if (index < 0) return false
    metadata.splice(index, 1)
    if (metadata.length > 0) source.set(sessionId, metadata)
    else source.delete(sessionId)
    return true
  }

  private syncFromQueue(sessionId: string, followUps: QueuedUserMessage[]): void {
    const previous = this.followUpMetadata.get(sessionId) ?? []
    const recordedAt = Date.now()
    const metadata = followUps.filter(hasFollowUpSelector).map((followUp) => {
      const previousMatch = previous.find((entry) => matchesFollowUpSelector(entry, followUp))
      return {
        displayText: followUp.displayText,
        ...(previousMatch?.serverText ? { serverText: previousMatch.serverText } : {}),
        clientNonce: followUp.clientNonce,
        clientSeq: followUp.clientSeq,
        recordedAt: previousMatch?.recordedAt ?? recordedAt,
      }
    })
    if (metadata.length > 0) this.followUpMetadata.set(sessionId, metadata)
    else this.followUpMetadata.delete(sessionId)
  }
}

export function hasFollowUpSelector(payload: QueueClearPayload | QueuedUserMessage | Extract<PiChatEvent, { type: 'message-start' | 'followup-consumed' }>): boolean {
  return Boolean(payload.clientNonce) || payload.clientSeq !== undefined
}

export function followUpSelector(followUp: QueuedUserMessage): QueueClearPayload {
  return {
    ...(followUp.clientNonce ? { clientNonce: followUp.clientNonce } : {}),
    ...(followUp.clientSeq !== undefined ? { clientSeq: followUp.clientSeq } : {}),
  }
}

function hasMessageSelector(message: BoringChatMessage): boolean {
  return Boolean(message.clientNonce) || message.clientSeq !== undefined
}

function matchesFollowUpSelector(entry: FollowUpMetadata, selector: QueueClearPayload | QueuedUserMessage): boolean {
  if (selector.clientNonce) return entry.clientNonce === selector.clientNonce
  return selector.clientSeq !== undefined && entry.clientSeq === selector.clientSeq
}

function matchesMetadataText(entry: FollowUpMetadata | undefined, text: string | undefined): boolean {
  if (!entry || !text) return false
  return entry.displayText === text || entry.serverText === text
}

function withMessageSelector(message: BoringChatMessage, metadata: FollowUpMetadata): BoringChatMessage {
  return {
    ...withMessageDisplayText(message, metadata.displayText),
    ...(metadata.clientNonce ? { clientNonce: metadata.clientNonce } : {}),
    ...(metadata.clientSeq !== undefined ? { clientSeq: metadata.clientSeq } : {}),
  }
}

function withMessageDisplayText(message: BoringChatMessage, displayText: string): BoringChatMessage {
  let replaced = false
  const parts = message.parts.flatMap((part): BoringChatMessage['parts'] => {
    if (part.type !== 'text') return [part]
    if (replaced) return []
    replaced = true
    return [{ ...part, text: displayText }]
  })
  return { ...message, parts }
}

function withQueuedSelector(followUp: QueuedUserMessage, metadata: FollowUpMetadata): QueuedUserMessage {
  return {
    ...followUp,
    displayText: metadata.displayText,
    ...(metadata.clientNonce ? { clientNonce: metadata.clientNonce } : {}),
    ...(metadata.clientSeq !== undefined ? { clientSeq: metadata.clientSeq } : {}),
  }
}

function countTexts(texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1)
  return counts
}

function countMetadataTexts(entries: readonly FollowUpMetadata[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.displayText, (counts.get(entry.displayText) ?? 0) + 1)
    if (entry.serverText) counts.set(entry.serverText, (counts.get(entry.serverText) ?? 0) + 1)
  }
  return counts
}

function messageText(message: BoringChatMessage): string | undefined {
  let text = ''
  for (const part of message.parts) {
    if (part.type !== 'text') continue
    text += text ? `\n${part.text}` : part.text
  }
  return text === '' ? undefined : text
}

function takeFirstMessageMetadata(metadata: FollowUpMetadata[], text: string | undefined, message: BoringChatMessage): FollowUpMetadata | undefined {
  if (!text) return undefined
  const createdAt = messageCreatedAtMs(message)
  if (createdAt === undefined) return undefined
  const index = metadata.findIndex((entry) => {
    if (!matchesMetadataText(entry, text)) return false
    return entry.recordedAt !== undefined && createdAt >= entry.recordedAt
  })
  if (index < 0) return undefined
  const [entry] = metadata.splice(index, 1)
  return entry
}

function messageCreatedAtMs(message: BoringChatMessage): number | undefined {
  if (!message.createdAt) return undefined
  const timestamp = Date.parse(message.createdAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}
