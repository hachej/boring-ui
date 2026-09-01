import { createHash } from 'node:crypto'

import type { ToolExecContext } from '@hachej/boring-agent/shared'
import { SANDBOX_LEASE_ERROR_CODES, SandboxLeaseError } from './leaseService'

export interface SandboxLeaseOwnerScope {
  readonly workspaceScopeId: string
  readonly agentTypeId: string
}

export function sandboxLeaseOwnerIdForSession(
  scope: SandboxLeaseOwnerScope,
  sessionId: string,
): string {
  if (!sessionId.trim()) {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'sandbox requires an Agent session')
  }
  return createHash('sha256')
    .update(JSON.stringify([scope.workspaceScopeId, scope.agentTypeId, sessionId]))
    .digest('hex')
}

export function sandboxLeaseOwnerId(
  scope: SandboxLeaseOwnerScope,
  ctx: ToolExecContext,
): string {
  if (ctx.workspaceId !== scope.workspaceScopeId) {
    throw new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'sandbox management request is invalid')
  }
  return sandboxLeaseOwnerIdForSession(scope, ctx.sessionId ?? '')
}
