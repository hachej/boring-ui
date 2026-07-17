import type { BoringChatMessage, BoringChatPart } from './boringChatMessage'
import type { QueuedUserMessage } from './piChatSnapshot'
import type { ChatError } from './chatError'
import type { ToolUiMetadata } from '../tool-ui'

export type PiChatEvent =
  | { type: 'agent-start'; seq: number; turnId: string }
  // willRetry=true marks a NON-terminal end (pi will auto-retry this turn). Consumers
  // that act once-per-settle (e.g. a host's onTurnComplete) must ignore those.
  | { type: 'agent-end'; seq: number; turnId: string; status: 'ok' | 'aborted' | 'error'; willRetry?: boolean }
  | {
      type: 'message-start'
      seq: number
      messageId: string
      role: 'user' | 'assistant'
      clientNonce?: string
      clientSeq?: number
      createdAt?: string
      text?: string
      files?: BoringChatPart[]
    }
  | { type: 'message-delta'; seq: number; messageId: string; partId: string; kind: 'text' | 'reasoning'; delta: string }
  | { type: 'message-part-end'; seq: number; messageId: string; partId: string; kind: 'text' | 'reasoning'; text: string }
  | { type: 'message-end'; seq: number; messageId: string; final: BoringChatMessage }
  | { type: 'tool-call'; seq: number; messageId: string; toolCallId: string; toolName: string; input: unknown; ui?: ToolUiMetadata }
  | {
      type: 'tool-result'
      seq: number
      messageId: string
      toolCallId: string
      output: unknown
      isError?: boolean
      errorText?: string
      ui?: ToolUiMetadata
    }
  | { type: 'queue-updated'; seq: number; queue: { followUps: QueuedUserMessage[] } }
  | { type: 'followup-consumed'; seq: number; clientNonce?: string; clientSeq?: number; messageId: string }
  | { type: 'file-changed'; seq: number; path: string; changeType: string; filesystem?: string }
  | { type: 'ui-command'; seq: number; command: unknown; displayOnly: true }
  | { type: 'usage'; seq: number; usage: unknown }
  | { type: 'auto-retry-start'; seq: number; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: 'auto-retry-end'; seq: number; success: boolean; attempt: number; finalError?: string }
  | { type: 'error'; seq: number; turnId?: string; retryable?: boolean; error: ChatError }

export interface PiChatHeartbeatFrame {
  type: 'heartbeat'
  now: string
}

export type PiChatStreamFrame = PiChatEvent | PiChatHeartbeatFrame
