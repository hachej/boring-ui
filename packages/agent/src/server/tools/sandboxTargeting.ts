import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
  type RuntimeBundle,
} from '@hachej/boring-bash/agent'

import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolExecContext, ToolResult } from '../../shared/tool'
import { createServerFileSearch } from '../runtime/createServerFileSearch'
import {
  SandboxLeaseError,
  type SandboxLeaseService,
} from '../sandbox/leases/sandboxLease'
import { sandboxLeaseOwnerId } from '../sandbox/leases/sandboxLeaseOwner'

const TARGETABLE_NAMES = new Set(['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'upload_file'])
const SANDBOX_HANDLE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

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

function targetedTool(
  primary: AgentTool,
  executeTargeted: (sandbox: string, params: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>,
): AgentTool {
  const properties = primary.parameters.properties && typeof primary.parameters.properties === 'object'
    ? { ...(primary.parameters.properties as Record<string, unknown>) }
    : {}
  return {
    ...primary,
    description: primary.name === 'upload_file'
      ? 'Copy a workspace file within artifact storage. When sandbox is supplied, both source and returned path remain lease-local and are deleted on release; omit sandbox for stable primary-workspace artifacts.'
      : `${primary.description} When sandbox is supplied, the operation targets that disposable lease; lease-targeted outputs are not durable after release.`,
    promptSnippet: [
      primary.promptSnippet,
      'Optional sandbox targets an explicitly leased disposable remote workspace; omit it for the primary user workspace.',
    ].filter(Boolean).join('\n'),
    parameters: {
      ...primary.parameters,
      properties: {
        ...properties,
        sandbox: {
          type: 'string',
          pattern: SANDBOX_HANDLE_PATTERN.source,
          description: 'Opaque disposable sandbox lease. Omit to use the primary user workspace.',
        },
      },
    },
    async execute(params, ctx) {
      const sandbox = params.sandbox
      if (sandbox === undefined) return await primary.execute(params, ctx)
      if (typeof sandbox !== 'string' || !SANDBOX_HANDLE_PATTERN.test(sandbox)) {
        return invalidTarget('sandbox lease is invalid')
      }
      if (typeof params.filesystem === 'string' && params.filesystem !== '' && params.filesystem !== 'user') {
        return invalidTarget('named filesystems cannot be combined with a sandbox lease')
      }
      const { sandbox: _sandbox, ...targetParams } = params
      return await executeTargeted(sandbox, targetParams, ctx)
    },
  }
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

function invalidTarget(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    details: { code: ErrorCode.enum.SANDBOX_TARGET_INVALID, retryable: false },
  }
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
    return targetedTool(primary, async (sandbox, params, ctx) => {
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
    })
  })
}
