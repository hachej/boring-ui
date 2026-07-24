import type { JsonValue } from './types'

export const AgentGatewayErrorCode = {
  AGENT_TYPE_UNKNOWN: 'AGENT_TYPE_UNKNOWN',
  AGENT_SESSION_NOT_FOUND: 'AGENT_SESSION_NOT_FOUND',
  AGENT_SCOPE_DENIED: 'AGENT_SCOPE_DENIED',
  AGENT_SESSION_REPLAY_GAP: 'AGENT_SESSION_REPLAY_GAP',
  AGENT_SESSION_CURSOR_AHEAD: 'AGENT_SESSION_CURSOR_AHEAD',
  AGENT_SESSION_CURSOR_EXPIRED: 'AGENT_SESSION_CURSOR_EXPIRED',
  AGENT_SESSION_CURSOR_INVALID: 'AGENT_SESSION_CURSOR_INVALID',
  AGENT_REQUEST_CONFLICT: 'AGENT_REQUEST_CONFLICT',
  AGENT_REQUEST_OUTCOME_UNKNOWN: 'AGENT_REQUEST_OUTCOME_UNKNOWN',
  AGENT_COMMAND_INVALID_STATE: 'AGENT_COMMAND_INVALID_STATE',
  AGENT_SESSION_RUNTIME_SCOPE_MISMATCH: 'AGENT_SESSION_RUNTIME_SCOPE_MISMATCH',
  AGENT_SHARED_ENVIRONMENT_UNAVAILABLE: 'AGENT_SHARED_ENVIRONMENT_UNAVAILABLE',
  AGENT_GATEWAY_CLOSED: 'AGENT_GATEWAY_CLOSED',
} as const

export type AgentGatewayErrorCode =
  (typeof AgentGatewayErrorCode)[keyof typeof AgentGatewayErrorCode]

export const AGENT_GATEWAY_ERROR_CODES = [
  AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN,
  AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND,
  AgentGatewayErrorCode.AGENT_SCOPE_DENIED,
  AgentGatewayErrorCode.AGENT_SESSION_REPLAY_GAP,
  AgentGatewayErrorCode.AGENT_SESSION_CURSOR_AHEAD,
  AgentGatewayErrorCode.AGENT_SESSION_CURSOR_EXPIRED,
  AgentGatewayErrorCode.AGENT_SESSION_CURSOR_INVALID,
  AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT,
  AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN,
  AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
  AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH,
  AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE,
  AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED,
] as const

export interface AgentGatewayErrorDTO {
  readonly code: AgentGatewayErrorCode
  readonly message: string
  readonly details?: JsonValue
}

export class AgentGatewayError extends Error {
  readonly code: AgentGatewayErrorCode
  readonly details?: JsonValue

  constructor(code: AgentGatewayErrorCode, message: string, details?: JsonValue) {
    super(message)
    this.name = 'AgentGatewayError'
    this.code = code
    this.details = details
  }

  toJSON(): AgentGatewayErrorDTO {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}
