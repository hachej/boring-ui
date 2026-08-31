import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
  withSandboxTarget,
  type RuntimeBundle,
} from '@hachej/boring-bash/agent'

import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import { createServerFileSearch } from '../runtime/createServerFileSearch'
import {
  SandboxLeaseError,
  type SandboxLeaseService,
} from '../sandbox/leases/sandboxLease'
import { sandboxLeaseOwnerId } from './sandboxManagement'

const TARGETABLE_NAMES = new Set(['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'upload_file'])

const SANDBOX_ALWAYS_RESERVED_TOOL_NAMES = Object.freeze([
  'sandbox', 'bash', 'read', 'write', 'edit', 'find', 'grep', 'ls',
] as const)

export function sandboxReservedToolNames(includeUploadTools: boolean): readonly string[] {
  return includeUploadTools
    ? [...SANDBOX_ALWAYS_RESERVED_TOOL_NAMES, 'upload_file']
    : SANDBOX_ALWAYS_RESERVED_TOOL_NAMES
}

export interface SandboxTargetingOptions {
  readonly leases: SandboxLeaseService
  readonly workspaceScopeId: string
  readonly agentTypeId: string
  readonly includeFilesystemTools: boolean
  readonly includeUploadTools: boolean
}

function leasedBundle(pair: WorkspaceSandboxPairV1): RuntimeBundle {
  return {
    workspace: pair.workspace,
    sandbox: pair.sandbox,
    fileSearch: createServerFileSearch(pair.workspace, pair.sandbox),
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
  }
}

function toolsForBundle(bundle: RuntimeBundle, options: SandboxTargetingOptions): AgentTool[] {
  return [
    ...buildHarnessAgentTools(bundle).filter((tool) => tool.name === 'bash'),
    ...(options.includeFilesystemTools ? buildFilesystemAgentTools(bundle) : []),
    ...(options.includeUploadTools ? buildUploadAgentTools(bundle) : []),
  ]
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof SandboxLeaseError) {
    return {
      content: [{ type: 'text', text: error.message }],
      isError: true,
      details: { code: error.code, retryable: error.retryable },
    }
  }
  return {
    content: [{ type: 'text', text: 'sandbox target failed' }],
    isError: true,
    details: { code: ErrorCode.enum.SANDBOX_TARGET_FAILED, retryable: true },
  }
}

function owner(options: SandboxTargetingOptions, ctx: ToolExecContext): string {
  return sandboxLeaseOwnerId(options, ctx)
}

/**
 * Pure authority preflight shared by Host binding resolution and composition.
 * Keeping the stable failure and reserved-name policy here prevents an early
 * Host check from drifting from the composition defense in depth.
 */
export function assertSandboxToolCatalogAuthority(input: {
  readonly sandboxTools?: unknown
  readonly extraTools?: readonly AgentTool[]
  readonly includeUploadTools?: boolean
}): void {
  if (!input.sandboxTools) return
  const reserved = new Set(sandboxReservedToolNames(input.includeUploadTools === true))
  const collision = input.extraTools?.find((tool) => reserved.has(tool.name))
  if (!collision) return
  throw Object.assign(
    new Error(`sandbox capability reserves tool name: ${collision.name}`),
    {
      code: ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION,
      statusCode: 409,
      retryable: false,
    },
  )
}

export function addSandboxTargeting(
  primaryTools: readonly AgentTool[],
  options: SandboxTargetingOptions,
): AgentTool[] {
  const delegatesByPair = new WeakMap<WorkspaceSandboxPairV1, ReadonlyMap<string, AgentTool>>()
  const delegatesFor = (pair: WorkspaceSandboxPairV1): ReadonlyMap<string, AgentTool> => {
    const existing = delegatesByPair.get(pair)
    if (existing) return existing
    const created = new Map(toolsForBundle(leasedBundle(pair), options).map((tool) => [tool.name, tool]))
    delegatesByPair.set(pair, created)
    return created
  }

  return primaryTools.map((primary) => {
    if (!TARGETABLE_NAMES.has(primary.name)) return primary
    return withSandboxTarget(primary, {
      async executeTargeted(sandbox, params, ctx) {
        try {
          return await options.leases.withPair(owner(options, ctx), sandbox, async (pair) => {
            const target = delegatesFor(pair).get(primary.name)
            if (!target) {
              return {
                content: [{ type: 'text', text: 'tool is not available in the leased sandbox' }],
                isError: true,
                details: { code: ErrorCode.enum.TOOL_NOT_FOUND, retryable: false },
              }
            }
            return await target.execute(params, ctx)
          })
        } catch (error) {
          return errorResult(error)
        }
      },
    })
  })
}
