import { AgentGatewayErrorCode } from '../../shared/index'

/** One stable HTTP mapping shared by every Agent Host projection. */
export function statusForGatewayError(code: string): number {
  if (code === AgentGatewayErrorCode.AGENT_ENTITLEMENT_REQUIRED) return 402
  if (
    code === AgentGatewayErrorCode.AGENT_SCOPE_DENIED
    || code === AgentGatewayErrorCode.AGENT_ACCESS_FORBIDDEN
  ) return 403
  if (
    code === AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND
    || code === AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN
  ) return 404
  if (
    code === AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT
    || code === AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS
    || code === AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN
    || code === AgentGatewayErrorCode.AGENT_RUNTIME_RESTART_REQUIRED
    || code === AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE
    || code.includes('CURSOR')
    || code.includes('REPLAY')
  ) return 409
  if (
    code === AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED
    || code === AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE
    || code === AgentGatewayErrorCode.AGENT_ACCESS_POLICY_UNAVAILABLE
  ) return 503
  return 400
}
