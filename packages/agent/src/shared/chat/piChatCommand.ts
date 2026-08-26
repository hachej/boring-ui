import type { ChatSubmitPayload } from './chatSubmitPayload'
import type { QueuedUserMessage } from './piChatSnapshot'

export type PromptPayload = ChatSubmitPayload

export interface FollowUpPayload {
  message: string
  displayMessage?: string
  clientNonce: string
  clientSeq: number
}

export interface QueueClearPayload {
  clientNonce?: string
  clientSeq?: number
}
export type InterruptPayload = Record<string, never>
export type StopPayload = Record<string, never>

export interface CommandReceipt {
  readonly accepted: true
  readonly cursor: number
}

export type PromptReceipt = CommandReceipt & { readonly clientNonce: string; readonly duplicate?: boolean }

export type FollowUpReceipt = CommandReceipt & {
  readonly clientNonce: string
  readonly clientSeq: number
  readonly queued: true
  readonly duplicate?: boolean
}

export type QueueClearReceipt = CommandReceipt & { readonly cleared: number }

export type InterruptReceipt = CommandReceipt

export type StopReceipt = CommandReceipt & { readonly stopped: boolean; readonly clearedQueue: readonly QueuedUserMessage[] }
