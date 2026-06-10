import type { BoringChatMessage } from '../../../shared/chat'
import { earliestCreatedAt } from './piChatMessageMetadata'

export function replaceOrAppendMessage(messages: BoringChatMessage[], message: BoringChatMessage): BoringChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id || sameUserClientNonce(candidate, message))
  if (index < 0) return [...messages, message]
  const next = [...messages]
  const existing = next[index]
  next[index] = existing ? { ...message, createdAt: earliestCreatedAt(existing.createdAt, message.createdAt) } : message
  return next
}

function sameUserClientNonce(candidate: BoringChatMessage, message: BoringChatMessage): boolean {
  return (
    candidate.role === 'user' &&
    message.role === 'user' &&
    candidate.clientNonce !== undefined &&
    candidate.clientNonce === message.clientNonce
  )
}
