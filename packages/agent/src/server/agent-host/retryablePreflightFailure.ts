import { AgentGatewayError, AgentGatewayErrorCode } from '../../shared/gateway/errors'
import type { AgentRequestKey, AgentRequestLedger } from './types'

/**
 * Classifies a runtime/application load failure before an Agent effect begins.
 * No requested mutation can have occurred, so a fresh request id may retry
 * after the dependency recovers instead of receiving outcome-unknown.
 */
export async function rejectRetryablePreflightFailure(
  ledger: AgentRequestLedger,
  key: AgentRequestKey,
): Promise<never> {
  const retryable = new AgentGatewayError(
    AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE,
    'Agent runtime failed to load',
    { retryable: true },
  )
  await ledger.reject(key, { kind: 'gateway', error: retryable.toJSON() }).catch(() => {})
  throw retryable
}
