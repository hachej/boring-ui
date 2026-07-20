import type { ChatError } from './chatError'
import type { PromptPayload, PromptReceipt } from './piChatCommand'
import type { SessionSummary } from '../session'

/** Request identity for one browser-local first-send attempt. */
export interface NativeSessionStart {
  idempotencyKey: string
  retry: boolean
}

export type NativePromptRequest = PromptPayload & {
  nativeSessionStart: NativeSessionStart
}

export type NativePromptReceipt =
  | (PromptReceipt & { nativeSessionId: string; session: SessionSummary })
  | {
      accepted: false
      clientNonce: string
      nativeSessionId: string
      session: SessionSummary
      error: ChatError
    }

export function isNativePromptReceipt(value: unknown): value is NativePromptReceipt {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.accepted !== 'boolean' || typeof record.clientNonce !== 'string' || typeof record.nativeSessionId !== 'string') return false
  const session = record.session as Record<string, unknown> | undefined
  return Boolean(session && typeof session.id === 'string' && session.id === record.nativeSessionId)
}
