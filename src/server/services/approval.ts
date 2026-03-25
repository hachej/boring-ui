/**
 * Approval service — transport-independent tool approval workflow.
 * Mirrors Python's approval.py ApprovalStore.
 */
import type { ApprovalRequest } from '../../shared/types.js'

export interface ApprovalStore {
  create(
    requestId: string,
    data: Omit<ApprovalRequest, 'id' | 'status' | 'created_at'>,
  ): Promise<void>
  get(requestId: string): Promise<ApprovalRequest | null>
  update(
    requestId: string,
    decision: 'approve' | 'deny',
    reason?: string,
  ): Promise<void>
  listPending(): Promise<ApprovalRequest[]>
  delete(requestId: string): Promise<boolean>
}

export function createInMemoryApprovalStore(): ApprovalStore {
  throw new Error(
    'Not implemented — see bd-1wkce.2 (Phase 4: Approval workflow)',
  )
}
