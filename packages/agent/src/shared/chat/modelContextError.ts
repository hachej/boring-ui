import { ErrorCode } from '../error-codes'
import type { ChatError } from './chatError'

export const MODEL_CONTEXT_RECOVERY_MESSAGE =
  'This conversation exceeded the model context window. Compact the conversation and retry, or start a new chat with less context.'

const CONTEXT_WINDOW_ERROR_PATTERN =
  /context[_ ]length[_ ]exceeded|exceeds the context window|input exceeds the context window/i

function errorMessage(value: unknown): string | undefined {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined

  const record = value as Record<string, unknown>
  if (typeof record.code === 'string' && CONTEXT_WINDOW_ERROR_PATTERN.test(record.code)) return record.code
  if (typeof record.message === 'string') return record.message
  return errorMessage(record.error)
}

export function isModelContextWindowError(value: unknown): boolean {
  const message = errorMessage(value)
  return message !== undefined && CONTEXT_WINDOW_ERROR_PATTERN.test(message)
}

export function chatErrorFromUnknown(value: unknown, fallbackMessage: string): ChatError {
  if (isModelContextWindowError(value)) {
    return {
      code: ErrorCode.enum.MODEL_CONTEXT_WINDOW_EXCEEDED,
      message: MODEL_CONTEXT_RECOVERY_MESSAGE,
      retryable: true,
    }
  }

  const message = errorMessage(value)
  return {
    code: ErrorCode.enum.INTERNAL_ERROR,
    message: message || fallbackMessage,
    retryable: false,
  }
}
