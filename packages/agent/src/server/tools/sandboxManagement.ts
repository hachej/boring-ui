import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import {
  SANDBOX_LEASE_ERROR_CODES,
  SandboxLeaseError,
  type SandboxLeaseService,
  type SandboxLeaseStatus,
} from '../sandbox/leases/sandboxLease'
import { sandboxLeaseOwnerId } from '../sandbox/leases/sandboxLeaseOwner'
export { sandboxLeaseOwnerId } from '../sandbox/leases/sandboxLeaseOwner'

const HANDLE_PATTERN = '^[A-Za-z0-9_-]{16,128}$'

export interface SandboxManagementToolOptions {
  readonly leases: SandboxLeaseService
  readonly workspaceScopeId: string
  readonly agentTypeId: string
}

type ManagementInput =
  | { op: 'create' }
  | { op: 'list' }
  | { op: 'status'; sandbox: string }
  | { op: 'release'; sandbox: string }

function parseInput(input: Record<string, unknown>): ManagementInput {
  const op = input.op
  const keys = Object.keys(input).sort()
  if (op === 'create' || op === 'list') {
    if (keys.length !== 1) throw invalid()
    return { op }
  }
  if (op === 'status' || op === 'release') {
    if (keys.length !== 2 || keys[0] !== 'op' || keys[1] !== 'sandbox') throw invalid()
    if (typeof input.sandbox !== 'string' || !new RegExp(HANDLE_PATTERN).test(input.sandbox)) throw invalid()
    return { op, sandbox: input.sandbox }
  }
  throw invalid()
}

function invalid(): SandboxLeaseError {
  return new SandboxLeaseError(SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST, 'sandbox management request is invalid')
}

function publicStatus(status: SandboxLeaseStatus) {
  return { sandbox: status.handle, expiresAt: status.expiresAt, state: status.state }
}

function result(details: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(details) }],
    details,
    isError: false,
  }
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof SandboxLeaseError) {
    return {
      content: [{ type: 'text', text: error.message }],
      details: { code: error.code, retryable: error.retryable },
      isError: true,
    }
  }
  return {
    content: [{ type: 'text', text: 'sandbox operation failed' }],
    details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, retryable: true },
    isError: true,
  }
}

async function executeManagement(
  options: SandboxManagementToolOptions,
  params: Record<string, unknown>,
  ctx: ToolExecContext,
): Promise<ToolResult> {
  try {
    const input = parseInput(params)
    const owner = sandboxLeaseOwnerId(options, ctx)
    if (input.op === 'create') {
      const lease = await options.leases.acquire(owner, ctx.abortSignal)
      return result({ op: 'create', sandbox: lease.handle, expiresAt: lease.expiresAt })
    }
    if (input.op === 'list') {
      return result({ op: 'list', sandboxes: options.leases.listOwn(owner).map(publicStatus) })
    }
    if (input.op === 'status') {
      return result({ op: 'status', ...publicStatus(options.leases.status(owner, input.sandbox)) })
    }
    await options.leases.release(owner, input.sandbox)
    return result({ op: 'release', sandbox: input.sandbox, released: true })
  } catch (error) {
    return errorResult(error)
  }
}

export function createSandboxManagementTool(options: SandboxManagementToolOptions): AgentTool {
  return {
    name: 'sandbox',
    description: 'Create, inspect, list, or release disposable remote coding sandboxes. Use the returned sandbox handle with ordinary bash and file tools.',
    parameters: {
      type: 'object',
      oneOf: [
        { properties: { op: { const: 'create' } }, required: ['op'], additionalProperties: false },
        { properties: { op: { const: 'list' } }, required: ['op'], additionalProperties: false },
        {
          properties: { op: { const: 'status' }, sandbox: { type: 'string', pattern: HANDLE_PATTERN } },
          required: ['op', 'sandbox'],
          additionalProperties: false,
        },
        {
          properties: { op: { const: 'release' }, sandbox: { type: 'string', pattern: HANDLE_PATTERN } },
          required: ['op', 'sandbox'],
          additionalProperties: false,
        },
      ],
    },
    async execute(params, ctx) {
      return await executeManagement(options, params, ctx)
    },
  }
}
