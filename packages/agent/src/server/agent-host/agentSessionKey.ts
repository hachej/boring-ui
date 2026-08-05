import type { AgentSessionRef } from '../../shared/index'

export function agentSessionKey(workspaceScopeId: string, ref: AgentSessionRef): string {
  return JSON.stringify([workspaceScopeId, ref.agentTypeId, ref.sessionId])
}
