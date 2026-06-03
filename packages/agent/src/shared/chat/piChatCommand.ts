import type { ChatSubmitPayload } from './chatSubmitPayload'
import type { QueuedUserMessage } from './piChatSnapshot'

export type PromptPayload = ChatSubmitPayload

export interface FollowUpPayload {
  message: string
  clientNonce: string
  clientSeq: number
}

export type QueueClearPayload = Record<string, never>
export type InterruptPayload = Record<string, never>
export type StopPayload = Record<string, never>

export interface CommandReceipt {
  accepted: true
  cursor: number
}

export type PromptReceipt = CommandReceipt & { clientNonce: string; duplicate?: boolean }

export type FollowUpReceipt = CommandReceipt & {
  clientNonce: string
  clientSeq: number
  queued: true
  duplicate?: boolean
}

export type QueueClearReceipt = CommandReceipt & { cleared: number }

export type InterruptReceipt = CommandReceipt

export type StopReceipt = CommandReceipt & { stopped: boolean; clearedQueue: QueuedUserMessage[] }
