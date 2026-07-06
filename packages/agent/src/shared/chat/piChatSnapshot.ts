import type { BoringChatMessage } from './boringChatMessage'
import type { ChatError } from './chatError'

export type PiChatStatus = 'idle' | 'hydrating' | 'submitted' | 'streaming' | 'waiting' | 'aborting' | 'error'

export interface QueuedUserMessage {
  id: string
  kind: 'followup'
  clientNonce?: string
  clientSeq?: number
  displayText: string
  createdAt?: string
}

export interface PiChatSnapshot {
  protocolVersion: 1
  sessionId: string
  seq: number
  status: PiChatStatus
  activeTurnId?: string
  messages: BoringChatMessage[]
  queue: { followUps: QueuedUserMessage[] }
  followUpMode: 'one-at-a-time'
  error?: ChatError
}
