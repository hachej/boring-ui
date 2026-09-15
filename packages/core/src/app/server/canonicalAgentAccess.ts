import type {
  AgentAccessDecision,
  AgentAccessOperation,
} from '@hachej/boring-agent/server'
import type { WorkspaceStore } from '../../server/app/index.js'

export type ResolveCoreAgentEntitlement = (input: {
  readonly workspaceId: string
  readonly userId: string
  readonly agentTypeId: string
  readonly operation: AgentAccessOperation
}) => Promise<AgentAccessDecision>

/** Resolves access while keeping product entitlement as policy, never Seat identity. */
export async function resolveCanonicalAgentAccess(input: {
  readonly workspaceStore: Pick<WorkspaceStore, 'listAgentSeats'>
  readonly workspaceId: string
  readonly userId: string
  readonly agentTypeId: string
  readonly operation: AgentAccessOperation
  readonly resolveAgentEntitlement?: ResolveCoreAgentEntitlement
}): Promise<AgentAccessDecision> {
  const seat = (await input.workspaceStore.listAgentSeats(input.workspaceId))
    .find((candidate) => candidate.agentTypeId === input.agentTypeId)
  if (!seat) return { state: 'not-available', reason: 'not-seated' }

  const entitlement = input.resolveAgentEntitlement
    ? await input.resolveAgentEntitlement({
        workspaceId: input.workspaceId,
        userId: input.userId,
        agentTypeId: input.agentTypeId,
        operation: input.operation,
      })
    : { state: 'allowed' as const }

  return entitlement.state === 'allowed'
    ? { state: 'allowed', seatId: seat.seatId }
    : entitlement
}
