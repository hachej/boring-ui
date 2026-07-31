import { ErrorCode } from '../../shared/error-codes'
import {
  AGENT_GATEWAY_ERROR_CODES,
  AgentGatewayErrorCode,
  type AgentGatewayErrorCode as AgentGatewayErrorCodeValue,
} from '../../shared/gateway/errors'
import type { JsonValue } from '../../shared/gateway/types'

export const RUNTIME_SCOPE_MISMATCH_MESSAGE = 'This chat belongs to a previous runtime configuration and can no longer be changed.'

export type GatewayResponseErrorCode = AgentGatewayErrorCodeValue | ErrorCode

export class GatewayResponseError extends Error {
  readonly errorCode?: GatewayResponseErrorCode

  constructor(
    readonly status: number,
    message: string,
    readonly code?: GatewayResponseErrorCode,
    readonly details?: JsonValue,
    readonly body?: unknown,
    readonly operation?: string,
  ) {
    super(message)
    this.name = 'GatewayResponseError'
    this.errorCode = code
  }
}

export async function gatewayResponseError(
  response: Response,
  fallbackMessage: string,
  operation?: string,
): Promise<GatewayResponseError> {
  const body = await safeReadJson(response)
  return gatewayResponseErrorFromBody(response.status, body, fallbackMessage, operation)
}

export function gatewayResponseErrorFromBody(
  status: number,
  body: unknown,
  fallbackMessage: string,
  operation?: string,
): GatewayResponseError {
  const payload = errorPayload(body)
  const code = gatewayResponseErrorCode(payload?.code)
  const serverMessage = typeof payload?.message === 'string' && payload.message.trim().length > 0
    ? payload.message
    : fallbackMessage
  const message = code === AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH
    ? RUNTIME_SCOPE_MISMATCH_MESSAGE
    : serverMessage
  const details = isJsonValue(payload?.details) ? payload.details : undefined
  return new GatewayResponseError(status, message, code, details, body, operation)
}

export function gatewayResponseErrorCode(value: unknown): GatewayResponseErrorCode | undefined {
  const sharedCode = ErrorCode.safeParse(value)
  if (sharedCode.success) return sharedCode.data
  return typeof value === 'string' && (AGENT_GATEWAY_ERROR_CODES as readonly string[]).includes(value)
    ? value as AgentGatewayErrorCodeValue
    : undefined
}

export function errorResponseCode(error: unknown): GatewayResponseErrorCode | undefined {
  if (error instanceof GatewayResponseError) return error.code
  const record = typeof error === 'object' && error !== null
    ? error as { code?: unknown; errorCode?: unknown }
    : undefined
  return gatewayResponseErrorCode(record?.code ?? record?.errorCode)
}

export function isRuntimeScopeMismatchError(error: unknown): boolean {
  return errorResponseCode(error) === AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function errorPayload(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  return typeof record.error === 'object' && record.error !== null
    ? record.error as Record<string, unknown>
    : record
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return typeof value === 'object'
    && value !== null
    && Object.values(value as Record<string, unknown>).every(isJsonValue)
}
