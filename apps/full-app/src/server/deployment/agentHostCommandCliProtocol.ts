import { AgentHostError, AgentHostErrorCode, strictAgentHostId } from './agentHostPlan.js'

export interface AgentHostCliCommandIdentity { readonly kind: 'plan' | 'apply' | 'rollback'; readonly hostId: string }

function invalid(field: string): never { throw new AgentHostError(AgentHostErrorCode.PLAN_INVALID, { field }) }

export function parseAgentHostCliInput(bytes: Uint8Array): { readonly raw: unknown; readonly identity: AgentHostCliCommandIdentity } {
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { invalid('command') }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('command')
  const command = raw as Record<string, unknown>
  if (command.kind === 'rollback') return { raw, identity: { kind: command.kind, hostId: strictAgentHostId(command.hostId, 'hostId') } }
  if (command.kind !== 'plan' && command.kind !== 'apply') invalid('kind')
  if (typeof command.plan !== 'object' || command.plan === null || Array.isArray(command.plan)) invalid('plan')
  return { raw, identity: { kind: command.kind, hostId: strictAgentHostId((command.plan as Record<string, unknown>).hostId, 'plan.hostId') } }
}
