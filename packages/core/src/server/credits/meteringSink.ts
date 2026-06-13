import type {
  AgentMeteringSink,
  MeteringReleaseInput,
  MeteringReservationResult,
  MeteringReserveInput,
  MeteringSettleInput,
  MeteringUsageInput,
} from '@hachej/boring-agent/server'
import type { CreditsService } from './creditsService.js'

function authRequiredError(): Error {
  return Object.assign(new Error('authentication required'), { statusCode: 401, code: 'AUTH_REQUIRED' })
}

/**
 * Adapt the credit policy to boring-agent's AgentMeteringSink. The service is
 * resolved lazily because the sink is handed to createCoreWorkspaceAgentServer
 * before the server (and its db) exists.
 *
 * reserveRun fails closed: 402 when credits are exhausted (CreditExhaustedError),
 * 401 when an authenticated run has no user. recordUsage/settle/release are
 * best-effort and skip silently for userless runs.
 */
export function createCreditsMeteringSink(getService: () => CreditsService): AgentMeteringSink {
  return {
    async reserveRun(input: MeteringReserveInput): Promise<MeteringReservationResult> {
      const service = getService()
      if (!service.config.enabled) return {}
      if (!input.userId) throw authRequiredError()
      const reservationId = await service.reserveRun({
        userId: input.userId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.runId,
      })
      return { reservationId }
    },

    async recordUsage(input: MeteringUsageInput): Promise<void> {
      if (!input.userId) return
      await getService().recordUsage({
        usageId: input.usageId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        runId: input.runId,
        messageId: input.messageId,
        reservationId: input.reservationId,
        provider: input.model?.provider,
        model: input.model?.id,
        usage: input.usage,
        stopReason: input.stopReason,
      })
    },

    async settleRun(input: MeteringSettleInput): Promise<void> {
      if (!input.userId) return
      await getService().settleRun(input.userId, input.runId, input.reservationId)
    },

    async releaseRun(input: MeteringReleaseInput): Promise<void> {
      if (!input.userId) return
      await getService().releaseRun(input.userId, input.runId, input.reservationId)
    },
  }
}
