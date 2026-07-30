import { ErrorCode } from '../error-codes'
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
  if (!isRecord(value)) return false
  if (typeof value.clientNonce !== 'string' || typeof value.nativeSessionId !== 'string') return false
  if (!isSessionSummary(value.session) || value.session.id !== value.nativeSessionId) return false

  if (value.accepted === true) {
    return typeof value.cursor === 'number'
      && Number.isInteger(value.cursor)
      && value.cursor >= 0
      && isOptionalBoolean(value, 'duplicate')
  }
  if (value.accepted === false) return isChatError(value.error)
  return false
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && typeof value.turnCount === 'number'
    && Number.isFinite(value.turnCount)
    && Number.isInteger(value.turnCount)
    && value.turnCount >= 0
    && isOptionalString(value, 'nativeSessionId')
    && isOptionalBoolean(value, 'hasAssistantReply')
}

function isChatError(value: unknown): value is ChatError {
  if (!isRecord(value)) return false
  return ErrorCode.safeParse(value.code).success
    && typeof value.message === 'string'
    && isOptionalBoolean(value, 'retryable')
}

function isOptionalString(record: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || typeof record[key] === 'string'
}

function isOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || typeof record[key] === 'boolean'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
