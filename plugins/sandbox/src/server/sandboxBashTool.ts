import type { AgentTool, ToolExecContext, ToolResult } from '@hachej/boring-agent/shared'
import { buildHarnessAgentTools, type RuntimeBundle } from '@hachej/boring-bash/agent'
import type { WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'

import { SandboxLeaseError, type SandboxLeaseService } from './leaseService'
import { sandboxLeaseOwnerId } from './leaseOwner'

const HANDLE_PATTERN = '^[A-Za-z0-9_-]{16,128}$'

export interface SandboxBashToolOptions {
  readonly leases: SandboxLeaseService
  readonly workspaceScopeId: string
  readonly agentTypeId: string
}

function leasedBundle(pair: WorkspaceSandboxPairV1): RuntimeBundle {
  return {
    workspace: pair.workspace,
    sandbox: pair.sandbox,
    fileSearch: { async search() { return [] } },
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
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
    content: [{ type: 'text', text: 'sandbox bash failed' }],
    isError: true,
    details: { code: 'SANDBOX_BASH_FAILED', retryable: true },
  }
}

export function createSandboxBashTool(options: SandboxBashToolOptions): AgentTool {
  const delegates = new WeakMap<WorkspaceSandboxPairV1, AgentTool>()
  const delegateFor = (pair: WorkspaceSandboxPairV1): AgentTool => {
    const existing = delegates.get(pair)
    if (existing) return existing
    const created = buildHarnessAgentTools(leasedBundle(pair)).find((tool) => tool.name === 'bash')
    if (!created) throw new TypeError('canonical bash delegate is unavailable')
    delegates.set(pair, created)
    return created
  }
  // Tool construction reads only these immutable contract fields. Execution
  // always uses a real leased pair through delegateFor above.
  const contractBundle = {
    workspace: { root: '/workspace' },
    sandbox: { placement: 'remote', capabilities: [] },
    fileSearch: { async search() { return [] } },
    bash: { kind: 'remote' },
    filesystem: { kind: 'remote-workspace' },
  } as unknown as RuntimeBundle
  const parameterDelegate = buildHarnessAgentTools(contractBundle).find((tool) => tool.name === 'bash')
  if (!parameterDelegate) throw new TypeError('canonical bash contract is unavailable')

  return {
    ...parameterDelegate,
    name: 'sandbox_bash',
    description: 'Run a shell command inside an owned disposable sandbox lease.',
    parameters: {
      ...parameterDelegate.parameters,
      properties: {
        ...(parameterDelegate.parameters.properties as Record<string, unknown> | undefined),
        sandbox: {
          type: 'string',
          pattern: HANDLE_PATTERN,
          description: 'Opaque handle returned by sandbox create.',
        },
      },
      required: [
        ...new Set([
          ...((parameterDelegate.parameters.required as string[] | undefined) ?? []),
          'sandbox',
        ]),
      ],
    },
    async execute(params: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult> {
      const sandbox = params.sandbox
      if (typeof sandbox !== 'string' || !new RegExp(HANDLE_PATTERN).test(sandbox)) {
        return {
          content: [{ type: 'text', text: 'sandbox lease is invalid' }],
          isError: true,
          details: { code: 'SANDBOX_LEASE_INVALID', retryable: false },
        }
      }
      const { sandbox: _sandbox, ...bashParams } = params
      try {
        const owner = sandboxLeaseOwnerId(options, ctx)
        return await options.leases.withPair(owner, sandbox, async (pair) =>
          await delegateFor(pair).execute(bashParams, ctx))
      } catch (error) {
        return errorResult(error)
      }
    },
  }
}
