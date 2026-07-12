import { D1HostError, D1HostErrorCode, strictD1Ref } from './d1Plan.js'

export interface D1CliCommandIdentity { readonly kind: 'plan' | 'apply' | 'rollback'; readonly hostId: string }

function invalid(field: string): never { throw new D1HostError(D1HostErrorCode.PLAN_INVALID, { field }) }

export function parseD1CliInput(bytes: Uint8Array): { readonly raw: unknown; readonly identity: D1CliCommandIdentity } {
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown } catch { invalid('command') }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) invalid('command')
  const command = raw as Record<string, unknown>
  if (command.kind === 'rollback') return { raw, identity: { kind: command.kind, hostId: strictD1Ref(command.hostId, 'hostId') } }
  if (command.kind !== 'plan' && command.kind !== 'apply') invalid('kind')
  if (typeof command.plan !== 'object' || command.plan === null || Array.isArray(command.plan)) invalid('plan')
  return { raw, identity: { kind: command.kind, hostId: strictD1Ref((command.plan as Record<string, unknown>).hostId, 'plan.hostId') } }
}
