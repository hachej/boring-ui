import { AgentGatewayError, AgentGatewayErrorCode, type JsonValue } from '../../shared/index'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import {
  defineAcceptedExternalEffectTool,
  createAcceptedToolEffectExecutor,
  type AcceptedExternalEffectInvocation,
} from '../agent-host/acceptedWork'
import type { AgentHostRuntime } from '../agent-host/createAgentHost'
import { projectStableServiceError } from '../agent-host/stableServiceError'
import type { AgentRequestFailure } from '../agent-host/types'
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
  readonly runtime: AgentHostRuntime
  readonly leases: SandboxLeaseService
  readonly workspaceScopeId: string
  readonly agentTypeId: string
  /** Explicit deterministic-test escape hatch; production requires a durable ledger. */
  readonly allowInMemoryLedgerForTests?: boolean
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

const SAFE_SANDBOX_SERVICE_ERRORS = Object.freeze({
  [SANDBOX_LEASE_ERROR_CODES.INVALID_LEASE_REQUEST]: {
    statusCode: 409,
    message: 'sandbox management request is invalid',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_NOT_FOUND]: {
    statusCode: 409,
    message: 'sandbox lease is unavailable',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_EXPIRED]: {
    statusCode: 409,
    message: 'sandbox lease has expired',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAINING]: {
    statusCode: 409,
    message: 'sandbox lease is unavailable',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_QUOTA_EXCEEDED]: {
    statusCode: 429,
    message: 'sandbox lease quota exceeded',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_CREATION_ABORTED]: {
    statusCode: 409,
    message: 'sandbox creation was aborted',
  },
  [SANDBOX_LEASE_ERROR_CODES.LEASE_DRAIN_TIMEOUT]: {
    statusCode: 409,
    message: 'sandbox operations did not drain',
  },
  [SANDBOX_LEASE_ERROR_CODES.SERVICE_CLOSED]: {
    statusCode: 409,
    message: 'sandbox lease service is closed',
  },
} as const)

type SafeSandboxServiceErrorCode = keyof typeof SAFE_SANDBOX_SERVICE_ERRORS

function safeSandboxServiceError(code: string): typeof SAFE_SANDBOX_SERVICE_ERRORS[SafeSandboxServiceErrorCode] | undefined {
  if (!Object.prototype.hasOwnProperty.call(SAFE_SANDBOX_SERVICE_ERRORS, code)) return undefined
  return SAFE_SANDBOX_SERVICE_ERRORS[code as SafeSandboxServiceErrorCode]
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof AgentGatewayError) {
    const details = { code: error.code, retryable: error.code === AgentGatewayErrorCode.AGENT_REQUEST_IN_PROGRESS }
    return { content: [{ type: 'text', text: error.message }], details, isError: true }
  }
  if (error instanceof SandboxLeaseError) {
    const details = { code: error.code, retryable: error.retryable }
    return {
      content: [{ type: 'text', text: error.message }],
      details,
      isError: true,
    }
  }
  const stable = projectStableServiceError(error)
  const service = stable ? safeSandboxServiceError(stable.error.code) : undefined
  if (stable && service && stable.statusCode === service.statusCode) {
    const details = { code: stable.error.code, retryable: stable.error.retryable ?? false }
    return {
      // Replayed service failures are reconstructed as plain coded Errors. Use
      // the canonical public message rather than trusting their message field.
      content: [{ type: 'text', text: service.message }],
      details,
      isError: true,
    }
  }
  return {
    content: [{ type: 'text', text: 'sandbox operation failed' }],
    details: { code: SANDBOX_LEASE_ERROR_CODES.LEASE_CLEANUP_FAILED, retryable: true },
    isError: true,
  }
}

function safeFailure(error: unknown): AgentRequestFailure | undefined {
  if (!(error instanceof SandboxLeaseError)) return undefined
  const service = safeSandboxServiceError(error.code)
  if (!service) return undefined
  return {
    kind: 'service',
    error: {
      statusCode: service.statusCode,
      error: { code: error.code, message: service.message, retryable: error.retryable },
    },
  }
}

async function executeManagement(
  options: SandboxManagementToolOptions,
  params: Record<string, unknown>,
  ctx: ToolExecContext,
  invocation?: AcceptedExternalEffectInvocation,
): Promise<ToolResult> {
  try {
    const input = parseInput(params)
    const owner = sandboxLeaseOwnerId(options, ctx)
    if (input.op === 'list') {
      return result({ op: 'list', sandboxes: options.leases.listOwn(owner).map(publicStatus) })
    }
    if (input.op === 'status') {
      return result({ op: 'status', ...publicStatus(options.leases.status(owner, input.sandbox)) })
    }
    if (!invocation) {
      throw new AgentGatewayError(
        AgentGatewayErrorCode.AGENT_ACCEPTED_WORK_UNAVAILABLE,
        'accepted work is unavailable for this tool invocation',
      )
    }
    const executeAccepted = createAcceptedToolEffectExecutor({
      runtime: options.runtime,
      workspaceScopeId: options.workspaceScopeId,
      agentTypeId: options.agentTypeId,
      sessionId: ctx.sessionId!,
      allowInMemoryLedgerForTests: options.allowInMemoryLedgerForTests,
    })
    const receipt = await executeAccepted({
      provenance: invocation.provenance,
      toolCallId: invocation.toolCallId,
      tool: 'sandbox',
      op: input.op,
      ...(input.op === 'release' ? { sandbox: input.sandbox } : {}),
      classifySafeActionFailure: safeFailure,
      action: async (): Promise<JsonValue> => {
        if (input.op === 'create') {
          const lease = await options.leases.acquire(owner, ctx.abortSignal)
          return { op: 'create', sandbox: lease.handle, expiresAt: lease.expiresAt }
        }
        await options.leases.release(owner, input.sandbox)
        return { op: 'release', sandbox: input.sandbox, released: true }
      },
    })
    return result(receipt as Record<string, unknown>)
  } catch (error) {
    return errorResult(error)
  }
}

export function createSandboxManagementTool(options: SandboxManagementToolOptions): AgentTool {
  const base: AgentTool = {
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
  return defineAcceptedExternalEffectTool(
    base,
    async (params, ctx, invocation) => await executeManagement(options, params, ctx, invocation),
    (params) => params.op === 'create' || params.op === 'release',
  )
}
