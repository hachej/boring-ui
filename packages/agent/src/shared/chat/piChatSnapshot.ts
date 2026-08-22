import type { BoringChatMessage } from './boringChatMessage'
import type { ChatError } from './chatError'
import type { ChatModelSelection } from './chatSubmitPayload'

export type PiChatStatus = 'idle' | 'hydrating' | 'submitted' | 'streaming' | 'aborting' | 'error'

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
  currentModel?: ChatModelSelection
  messages: BoringChatMessage[]
  queue: { followUps: QueuedUserMessage[] }
  followUpMode: 'one-at-a-time'
  error?: ChatError
}
